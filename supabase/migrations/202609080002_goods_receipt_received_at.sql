-- goods_receipt_create always stamped the receipt with now() - there was no
-- way to backdate it to when the delivery actually happened (e.g. recording
-- yesterday's delivery today). Accepts an optional received_at in the
-- payload now, defaulting to now() when omitted so existing callers are
-- unaffected; the parent PO's own received_at (set only once every line is
-- fully received) uses the same chosen date instead of current_date, so it
-- stays consistent with what the receipt itself says.
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

  insert into public.goods_receipts (purchase_order_id, delivery_note_no, received_by, note, received_at)
  values (v_po_id, p_payload->>'delivery_note_no', v_uid, p_payload->>'note', v_received_at)
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
      received_at = case when v_new_po_status = 'received' then v_received_at::date else received_at end,
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
