-- Correct stock_balances to one shared pool per material, not per-project.
--
-- Confirmed with the user: materials sit in one central yard/store and get
-- handed out to whichever project needs them - Stock Movement's own live
-- data already reflects exactly this (one running `stock` number per
-- material, no per-project split). 202608220001 assumed per-project stock
-- as a placeholder pending that confirmation. Fixing it now, while
-- stock_balances still has zero rows, before Phase 2 builds withdrawals on
-- top of the wrong key - this is a pure schema correction, not a data
-- migration.
--
-- stock_movements keeps project_id - that's still real attribution (which
-- job a receipt or withdrawal was for) - only the balance itself stops
-- being split by project.

alter table public.stock_balances drop constraint stock_balances_pkey;
alter table public.stock_balances drop column project_id;
alter table public.stock_balances add primary key (material_type_id);

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
  if p_type <> 'in' then
    raise exception 'Stock movement type % is not wired up yet', p_type using errcode = '22023';
  end if;
  if p_quantity <= 0 then
    raise exception 'Stock movement quantity must be positive' using errcode = '22023';
  end if;

  insert into public.stock_balances (material_type_id, quantity_on_hand, updated_at)
  values (p_material_type_id, p_quantity, now())
  on conflict (material_type_id) do update
    set quantity_on_hand = public.stock_balances.quantity_on_hand + p_quantity,
        updated_at = now()
  returning quantity_on_hand - p_quantity, quantity_on_hand into v_prev, v_new;

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
