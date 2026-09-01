-- The stock withdrawal flow (Phase B) launched with only project + contractor -
-- no way to say which plot, or which batch of plots, the material was for.
-- BuildFlow Pro already solved exactly this for BOQ material usage logging
-- (material_usage_log.plot_group_id, "log for the whole group") - this
-- brings stock_movements to the same shape rather than inventing a second
-- way to represent the same idea.
--
-- plot_id (single plot) and plot_group_id (a named batch, e.g. "98-102")
-- are mutually exclusive - a movement is either for one specific plot or
-- for a whole batch, never both. Both stay nullable: plenty of real
-- withdrawals (site-wide supplies, fencing, shared infrastructure) aren't
-- tied to any one house.
--
-- Unlike material_usage_log's group handling, a withdrawal doesn't divide
-- the entered quantity by member count - there's no per-plot BOQ budget to
-- compare a withdrawal against, so the quantity recorded is simply the
-- total for whatever scope (one plot, or the whole batch) was chosen.

alter table public.stock_movements add column if not exists plot_group_id uuid references public.plot_groups(id);

alter table public.stock_movements drop constraint if exists stock_movements_plot_xor_group;
alter table public.stock_movements add constraint stock_movements_plot_xor_group
  check (plot_id is null or plot_group_id is null);

-- ---------------------------------------------------------------------------
-- _stock_movement_post: add p_plot_group_id, store it alongside plot_id.
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
  p_note text default null,
  p_plot_group_id uuid default null
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
  if p_plot_id is not null and p_plot_group_id is not null then
    raise exception 'A movement cannot be scoped to both a plot and a plot group' using errcode = '22023';
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
    material_type_id, project_id, plot_id, plot_group_id, contractor_id,
    type, source_type, source_id,
    quantity, prev_qty, new_qty,
    requested_by, approved_by, note
  ) values (
    p_material_type_id, p_project_id, p_plot_id, p_plot_group_id, p_contractor_id,
    p_type, p_source_type, p_source_id,
    p_quantity, v_prev, v_new,
    p_requested_by, p_approved_by, p_note
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public._stock_movement_post(
  bigint, uuid, text, text, uuid, numeric, uuid, uuid, uuid, uuid, text, uuid
) from public;
revoke all on function public._stock_movement_post(
  bigint, uuid, text, text, uuid, numeric, uuid, uuid, uuid, uuid, text, uuid
) from anon;
revoke all on function public._stock_movement_post(
  bigint, uuid, text, text, uuid, numeric, uuid, uuid, uuid, uuid, text, uuid
) from authenticated;

-- The old 11-arg signature is now shadowed by nothing (Postgres treats
-- different argument lists as different functions) - drop it explicitly so
-- there isn't a dead, still-nullable-safe-but-orphaned overload left behind
-- that a future migration might accidentally call.
drop function if exists public._stock_movement_post(
  bigint, uuid, text, text, uuid, numeric, uuid, uuid, uuid, uuid, text
);

-- ---------------------------------------------------------------------------
-- goods_receipt_create: no behavior change, just passes the new (unused)
-- parameter's default through - a receipt is never plot-group-scoped today.
-- Redefined only because it calls _stock_movement_post positionally-by-name
-- and must resolve to the new signature now that the old one is gone.
-- ---------------------------------------------------------------------------
create or replace function public.goods_receipt_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_po_id uuid := (p_payload->>'purchase_order_id')::uuid;
  v_receipt_id uuid;
  v_pr_id uuid;
  v_project_id uuid;
  v_plot_id uuid;
  v_all_received boolean;
  v_any_received boolean;
  v_new_po_status text;
  v_line record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can record a goods receipt' using errcode = '42501';
  end if;

  select purchase_request_id, project_id, plot_id
  into v_pr_id, v_project_id, v_plot_id
  from public.purchase_orders where id = v_po_id;

  if not found then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;

  insert into public.goods_receipts (purchase_order_id, delivery_note_no, received_by, note)
  values (v_po_id, p_payload->>'delivery_note_no', v_uid, p_payload->>'note')
  returning id into v_receipt_id;

  insert into public.goods_receipt_items (goods_receipt_id, purchase_order_item_id, quantity_received, unit_price_at_receipt)
  select
    v_receipt_id,
    (i->>'purchase_order_item_id')::uuid,
    (i->>'quantity_received')::numeric,
    coalesce((i->>'unit_price_at_receipt')::numeric, 0)
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where coalesce((i->>'quantity_received')::numeric, 0) > 0;

  update public.purchase_order_items poi
  set quantity_received = poi.quantity_received + gri.quantity_received
  from public.goods_receipt_items gri
  where gri.goods_receipt_id = v_receipt_id
    and gri.purchase_order_item_id = poi.id
    and poi.purchase_order_id = v_po_id;

  select
    bool_and(quantity_received >= quantity_ordered),
    bool_or(quantity_received > 0)
  into v_all_received, v_any_received
  from public.purchase_order_items
  where purchase_order_id = v_po_id;

  v_new_po_status := case
    when v_all_received then 'received'
    when v_any_received then 'partially_received'
    else 'sent'
  end;

  update public.purchase_orders
  set status = v_new_po_status,
      received_at = case when v_new_po_status = 'received' then current_date else received_at end,
      received_by = case when v_new_po_status = 'received' then v_uid else received_by end
  where id = v_po_id;

  if v_new_po_status = 'received' and v_pr_id is not null then
    update public.purchase_requests set status = 'received' where id = v_pr_id;
  end if;

  for v_line in
    select gri.id as receipt_item_id, poi.material_type_id, gri.quantity_received
    from public.goods_receipt_items gri
    join public.purchase_order_items poi on poi.id = gri.purchase_order_item_id
    where gri.goods_receipt_id = v_receipt_id
  loop
    perform public._stock_movement_post(
      p_material_type_id => v_line.material_type_id,
      p_project_id        => v_project_id,
      p_type              => 'in',
      p_source_type       => 'goods_receipt',
      p_source_id         => v_line.receipt_item_id,
      p_quantity          => v_line.quantity_received,
      p_plot_id           => v_plot_id,
      p_approved_by       => v_uid,
      p_note              => 'Goods receipt' || case
        when coalesce(p_payload->>'delivery_note_no', '') <> '' then ' (' || (p_payload->>'delivery_note_no') || ')'
        else ''
      end
    );
  end loop;

  return jsonb_build_object('id', v_receipt_id, 'po_status', v_new_po_status);
end;
$$;

grant execute on function public.goods_receipt_create(jsonb) to authenticated;
grant execute on function public.goods_receipt_create(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- stock_request_create: accept plot_id OR plot_group_id from the payload.
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
  v_plot_group_id uuid := public._jsonb_to_uuid(p_payload->'plot_group_id');
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
  if v_plot_id is not null and v_plot_group_id is not null then
    raise exception 'Choose either a single plot or a plot group, not both' using errcode = '22023';
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
      p_note              => p_payload->>'note',
      p_plot_group_id     => v_plot_group_id
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
