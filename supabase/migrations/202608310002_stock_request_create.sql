-- Phase 2 of the Stock Movement integration plan: the contractor
-- quick-withdrawal flow, mirroring Stock Movement's RequestPage.
--
-- Decided policy (no default, this was deliberated): no approval gate.
-- foreman/pm/admin can withdraw stock for a contractor in one step, the same
-- trust level BuildFlow Pro already gives material_usage_log (foreman-logged
-- usage ships with zero approval by design - see
-- 202607140001_material_tracking.sql). Approval gates in this codebase are
-- reserved for actions that commit money (billing, PO creation/payment); a
-- withdrawal from stock already owned isn't one. Accountability comes from
-- requested_by + contractor_id stamped on every row, not from a sign-off.
--
-- The one rule that IS enforced, because it's a data-integrity fact rather
-- than a judgment call: a withdrawal cannot take quantity_on_hand negative.
-- Enforced inside _stock_movement_post itself (a single conditional UPDATE,
-- safe under concurrent withdrawals) so the invariant holds for every future
-- caller of 'out', not just this RPC.
--
-- This also widens type/source_type from the Phase 1 narrowing
-- ('in'/'goods_receipt' only) to add 'out'/'manual_request', the same
-- incremental-constraint-growth pattern used throughout this codebase's
-- procurement migrations.
--
-- Deliberately NOT here: material_usage_log stays separate for now (a real
-- merge is a larger refactor touching working BOQ variance reporting - not
-- required to ship this flow, see the integration plan's open decisions).

alter table public.stock_movements drop constraint stock_movements_type_check;
alter table public.stock_movements add constraint stock_movements_type_check
  check (type in ('in', 'out'));

alter table public.stock_movements drop constraint stock_movements_source_type_check;
alter table public.stock_movements add constraint stock_movements_source_type_check
  check (source_type in ('goods_receipt', 'manual_request'));

-- ---------------------------------------------------------------------------
-- _stock_movement_post: add the 'out' branch. Uses a single conditional
-- UPDATE (quantity_on_hand >= p_quantity in the WHERE clause) rather than a
-- separate check-then-update - Postgres's row lock on the UPDATE makes this
-- atomic, so two concurrent withdrawals against the same material can't both
-- pass a stale check and drive the balance negative.
-- ---------------------------------------------------------------------------

create or replace function public._stock_movement_post(
  p_material_type_id bigint,
  p_project_id uuid,
  p_type text,
  p_source_type text,
  p_source_id uuid,
  p_quantity numeric,
  p_plot_id uuid default null,
  p_contractor_id uuid default null,
  p_requested_by uuid default null,
  p_approved_by uuid default null,
  p_note text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev numeric;
  v_new numeric;
  v_row public.stock_movements;
begin
  if p_type not in ('in', 'out') then
    raise exception 'Stock movement type % is not wired up yet', p_type using errcode = '22023';
  end if;
  if p_quantity <= 0 then
    raise exception 'Stock movement quantity must be positive' using errcode = '22023';
  end if;

  if p_type = 'in' then
    insert into public.stock_balances (material_type_id, quantity_on_hand, updated_at)
    values (p_material_type_id, p_quantity, now())
    on conflict (material_type_id) do update
      set quantity_on_hand = public.stock_balances.quantity_on_hand + p_quantity,
          updated_at = now()
    returning quantity_on_hand - p_quantity, quantity_on_hand into v_prev, v_new;
  else
    update public.stock_balances
    set quantity_on_hand = quantity_on_hand - p_quantity,
        updated_at = now()
    where material_type_id = p_material_type_id
      and quantity_on_hand >= p_quantity
    returning quantity_on_hand + p_quantity, quantity_on_hand into v_prev, v_new;

    if not found then
      raise exception 'Not enough stock on hand to withdraw % of material %', p_quantity, p_material_type_id
        using errcode = '22023';
    end if;
  end if;

  insert into public.stock_movements (
    material_type_id, project_id, plot_id, contractor_id,
    type, source_type, source_id,
    quantity, prev_qty, new_qty,
    requested_by, approved_by, note
  ) values (
    p_material_type_id, p_project_id, p_plot_id, p_contractor_id,
    p_type, p_source_type, p_source_id,
    p_quantity, v_prev, v_new,
    p_requested_by, p_approved_by, p_note
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public._stock_movement_post(
  bigint, uuid, text, text, uuid, numeric, uuid, uuid, uuid, uuid, text
) from public;
revoke all on function public._stock_movement_post(
  bigint, uuid, text, text, uuid, numeric, uuid, uuid, uuid, uuid, text
) from anon;
revoke all on function public._stock_movement_post(
  bigint, uuid, text, text, uuid, numeric, uuid, uuid, uuid, uuid, text
) from authenticated;

-- ---------------------------------------------------------------------------
-- stock_request_create: the client-facing entry point. One call can carry
-- several material lines (mirrors Stock Movement's multi-line request form);
-- all lines share a freshly generated batch id in source_id so a UI can
-- group them, without needing a separate parent "request" table the way
-- purchase_requests has one - this flow has no approval stage to track
-- status for, so there's nothing a header row would add.
-- ---------------------------------------------------------------------------

create or replace function public.stock_request_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_project_id uuid := (p_payload->>'project_id')::uuid;
  v_plot_id uuid := public._jsonb_to_uuid(p_payload->'plot_id');
  v_contractor_id uuid := (p_payload->>'contractor_id')::uuid;
  v_batch_id uuid := gen_random_uuid();
  v_item jsonb;
  v_material_id bigint;
  v_qty numeric;
  v_row public.stock_movements;
  v_results jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('foreman', 'pm', 'admin') then
    raise exception 'No permission to withdraw stock' using errcode = '42501';
  end if;
  if v_project_id is null then
    raise exception 'project_id is required' using errcode = '22023';
  end if;
  if v_contractor_id is null then
    raise exception 'contractor_id is required' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    v_material_id := (v_item->>'material_type_id')::bigint;
    v_qty := (v_item->>'quantity')::numeric;

    if v_material_id is null or coalesce(v_qty, 0) <= 0 then
      continue;
    end if;

    v_row := public._stock_movement_post(
      p_material_type_id => v_material_id,
      p_project_id        => v_project_id,
      p_type              => 'out',
      p_source_type       => 'manual_request',
      p_source_id         => v_batch_id,
      p_quantity          => v_qty,
      p_plot_id           => v_plot_id,
      p_contractor_id     => v_contractor_id,
      p_requested_by      => v_uid,
      p_note              => p_payload->>'note'
    );

    v_results := v_results || jsonb_build_object(
      'material_type_id', v_material_id,
      'quantity', v_qty,
      'new_qty', v_row.new_qty
    );
  end loop;

  if jsonb_array_length(v_results) = 0 then
    raise exception 'No valid items to withdraw' using errcode = '22023';
  end if;

  return jsonb_build_object('batch_id', v_batch_id, 'items', v_results);
end;
$$;

revoke all on function public.stock_request_create(jsonb) from public;
revoke all on function public.stock_request_create(jsonb) from anon;
grant execute on function public.stock_request_create(jsonb) to authenticated;
grant execute on function public.stock_request_create(jsonb) to service_role;
