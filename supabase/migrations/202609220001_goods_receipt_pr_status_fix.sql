-- goods_receipt_create marked the whole purchase_request 'received' the
-- instant ANY ONE of its purchase orders finished receiving, never checking
-- whether the request had other orders still outstanding. A request answered
-- by two POs (PR-0023: PO-20260915002 still 'sent', PO-20260916002 received)
-- got closed out the moment the second PO's goods receipt landed, even though
-- the first PO's lines - the request's own first two materials - had never
-- been received. Restated in full per this repo's convention (Postgres has
-- no partial function replace); only the two lines flagged below change.
--
-- Also corrects the one row this already put in the wrong state: PR-0023
-- back from 'received' to 'ordered' (every line is already fully covered by
-- a PO - that part was correct - it's just not all received yet).

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
  v_received_at timestamptz := coalesce(nullif(p_payload->>'received_at', '')::timestamptz, now());
  v_receipt_id uuid;
  v_ri_no text;
  v_seq int;
  v_pr_id uuid;
  v_project_id uuid;
  v_plot_id uuid;
  v_order_date date;
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

  select purchase_request_id, project_id, plot_id, order_date
  into v_pr_id, v_project_id, v_plot_id, v_order_date
  from public.purchase_orders where id = v_po_id;

  if not found then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;

  insert into public.goods_receipt_number_counters (receipt_date, counter)
  values (v_received_at::date, 1)
  on conflict (receipt_date) do update set counter = goods_receipt_number_counters.counter + 1
  returning counter into v_seq;

  v_ri_no := 'RI-' || to_char(v_received_at::date, 'YYYYMMDD') || lpad(v_seq::text, 3, '0');

  insert into public.goods_receipts (purchase_order_id, ri_no, delivery_note_no, received_by, note, received_at)
  values (v_po_id, v_ri_no, p_payload->>'delivery_note_no', v_uid, p_payload->>'note', v_received_at)
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

  -- Actual lead time for this delivery: days from when the PO was placed to
  -- when it showed up. Overwrites every material received on this RI, even
  -- if it never had an estimate before.
  if v_order_date is not null then
    update public.material_types mt
    set lead_time_days = greatest(0, (v_received_at::date - v_order_date))
    from public.purchase_order_items poi
    join public.goods_receipt_items gri on gri.purchase_order_item_id = poi.id
    where gri.goods_receipt_id = v_receipt_id
      and poi.material_type_id = mt.id;
  end if;

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
      received_at = case when v_new_po_status = 'received' then v_received_at::date else received_at end,
      received_by = case when v_new_po_status = 'received' then v_uid else received_by end
  where id = v_po_id;

  -- Fixed: only close out the request once every non-cancelled PO raised
  -- against it - not just the one this receipt touched - is fully received.
  if v_new_po_status = 'received' and v_pr_id is not null then
    update public.purchase_requests pr
    set status = 'received'
    where pr.id = v_pr_id
      and not exists (
        select 1 from public.purchase_orders po2
        where po2.purchase_request_id = v_pr_id
          and po2.status <> 'cancelled'
          and po2.status <> 'received'
      );
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

  return jsonb_build_object('id', v_receipt_id, 'ri_no', v_ri_no, 'po_status', v_new_po_status);
end;
$$;

grant execute on function public.goods_receipt_create(jsonb) to authenticated;
grant execute on function public.goods_receipt_create(jsonb) to service_role;

-- One-time correction: PR-0023 was wrongly closed out by the bug above when
-- its second PO (PO-20260916002) was received, while its first PO
-- (PO-20260915002, holding its first two materials) was still 'sent'. Every
-- line on it is already fully covered by a PO, so 'ordered' - not 'approved'
-- - is the correct state to fall back to.
update public.purchase_requests pr
set status = 'ordered'
where pr.status = 'received'
  and exists (
    select 1 from public.purchase_orders po
    where po.purchase_request_id = pr.id
      and po.status <> 'cancelled'
      and po.status <> 'received'
  );
