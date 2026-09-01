-- Phase D: stock count / adjustment - correcting the system balance to
-- match a physical count (shrinkage, damage, data-entry errors, theft).
--
-- Restricted to pm/admin, not foreman - the same segregation-of-duties
-- reasoning as updateMaterialUsageEntry's isPrivileged check: the role that
-- withdraws stock shouldn't also be the one who can freely correct the
-- balance without any check, since that combination could silently absorb
-- a real loss. No approval workflow beyond that (same "no gate, direct
-- write, audit via the ledger" policy as withdrawals) - just a narrower set
-- of roles allowed to write at all.
--
-- Reuses the existing 'in'/'out' movement types (direction is implied by
-- whether the count came in above or below the system balance) rather than
-- adding a third type - only source_type needs a new value.

alter table public.stock_movements drop constraint stock_movements_source_type_check;
alter table public.stock_movements add constraint stock_movements_source_type_check
  check (source_type = any (array['goods_receipt', 'manual_request', 'opening_balance', 'count_adjustment']));

create or replace function public.stock_adjustment_create(
  p_material_type_id bigint,
  p_counted_qty numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_material_name text;
  v_current_qty numeric;
  v_delta numeric;
  v_row public.stock_movements;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm', 'admin') then
    raise exception 'No permission to adjust stock' using errcode = '42501';
  end if;
  if p_counted_qty is null or p_counted_qty < 0 then
    raise exception 'Counted quantity must be zero or more' using errcode = '22023';
  end if;

  select name into v_material_name from public.material_types where id = p_material_type_id;
  if v_material_name is null then
    raise exception 'Material not found: %', p_material_type_id using errcode = 'P0002';
  end if;

  select quantity_on_hand into v_current_qty
  from public.stock_balances where material_type_id = p_material_type_id;
  v_current_qty := coalesce(v_current_qty, 0);

  v_delta := p_counted_qty - v_current_qty;

  if v_delta = 0 then
    return jsonb_build_object(
      'material_type_id', p_material_type_id,
      'prev_qty', v_current_qty,
      'new_qty', p_counted_qty,
      'delta', 0
    );
  end if;

  v_row := public._stock_movement_post(
    p_material_type_id => p_material_type_id,
    p_project_id        => null,
    p_type              => case when v_delta > 0 then 'in' else 'out' end,
    p_source_type       => 'count_adjustment',
    p_source_id         => gen_random_uuid(),
    p_quantity          => abs(v_delta),
    p_requested_by      => v_uid,
    p_note              => p_note
  );

  return jsonb_build_object(
    'material_type_id', p_material_type_id,
    'prev_qty', v_row.prev_qty,
    'new_qty', v_row.new_qty,
    'delta', v_delta
  );
end;
$$;

revoke all on function public.stock_adjustment_create(bigint, numeric, text) from public;
revoke all on function public.stock_adjustment_create(bigint, numeric, text) from anon;
grant execute on function public.stock_adjustment_create(bigint, numeric, text) to authenticated;
grant execute on function public.stock_adjustment_create(bigint, numeric, text) to service_role;
