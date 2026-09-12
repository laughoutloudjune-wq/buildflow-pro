-- po_partial_fulfillment (202609090004) rewrote po_update from scratch to add
-- the purchase-request quantity resync, and in doing so silently reverted
-- two earlier fixes it wasn't touching on purpose: it went back to blindly
-- `delete`-then-`insert`ing every line (losing quantity_received and the
-- goods_receipt_items FK on any line already received, instead of updating
-- existing rows in place by id), and it narrowed the editable statuses back
-- down to draft/sent only, dropping partially_received. Net effect: editing
-- a PO that had ANY goods received on it - even one line, even one unit -
-- was completely blocked, contradicting the "revise a PO after a short
-- shipment" feature that had just shipped the day before.
--
-- This restores the update-in-place + per-line guard behaviour (a line that
-- already has a received quantity can be reduced no lower than what was
-- received, and can't be dropped from the payload at all - both would leave
-- the PO disagreeing with real, already-posted stock movements) alongside
-- the PR resync, and goes one step further: a *fully* received PO can now be
-- edited too, not just a partially received one. Real deliveries often need
-- a correction after the fact (fixing a price, reassigning the plot, a typo
-- in a note) with nothing left to receive, and there's no reason that should
-- be impossible when a partially-received PO already allows it under the
-- same guard. If the edit raises quantity_ordered back above what's already
-- been received, status correctly drops back to partially_received - the
-- same recompute goods_receipt_create itself uses.
create or replace function public.po_update(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_po_no text;
  v_pr_id uuid;
  v_plot_ids_count int := jsonb_array_length(coalesce(p_payload->'plot_ids', '[]'::jsonb));
  v_plot_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_id') end;
  v_plot_group_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_group_id') end;
  v_vat_percent numeric := coalesce((p_payload->>'vat_percent')::numeric, 0);
  v_vat_type text := case when p_payload->>'vat_type' = 'inclusive' then 'inclusive' else 'exclusive' end;
  v_po_discount_type text := coalesce(nullif(p_payload->>'discount_type', ''), 'none');
  v_po_discount_value numeric := coalesce((p_payload->>'discount_value')::numeric, 0);
  v_subtotal numeric := 0;
  v_line_discount_total numeric := 0;
  v_after_line_discounts numeric;
  v_po_discount_amount numeric := 0;
  v_combined_discount numeric;
  v_net_of_discounts numeric;
  v_taxable numeric;
  v_vat_amount numeric;
  v_total numeric;
  v_line record;
  v_incoming_qty numeric;
  v_all_received boolean;
  v_any_received boolean;
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can edit a purchase order' using errcode = '42501';
  end if;
  if v_plot_id is not null and v_plot_group_id is not null then
    raise exception 'Choose either a single plot or a plot group, not both' using errcode = '22023';
  end if;

  select status, po_no, purchase_request_id into v_status, v_po_no, v_pr_id from public.purchase_orders where id = p_id;
  if v_status is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if v_status not in ('draft', 'sent', 'partially_received', 'received') then
    raise exception 'Cannot edit a purchase order that has already been paid or cancelled' using errcode = '42501';
  end if;

  for v_line in
    select id, quantity_received
    from public.purchase_order_items
    where purchase_order_id = p_id and quantity_received > 0
  loop
    select (i->>'quantity_ordered')::numeric into v_incoming_qty
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    where public._jsonb_to_uuid(i->'id') = v_line.id;

    if v_incoming_qty is null then
      raise exception 'Cannot remove a line that already has goods received - reduce its quantity instead' using errcode = '42501';
    end if;
    if v_incoming_qty < v_line.quantity_received then
      raise exception 'Cannot set ordered quantity below the quantity already received' using errcode = '42501';
    end if;
  end loop;

  select
    coalesce(sum(coalesce((i->>'quantity_ordered')::numeric, 0) * coalesce((i->>'unit_price')::numeric, 0)), 0),
    coalesce(sum(
      case coalesce(nullif(i->>'discount_type', ''), 'none')
        when 'percent' then round(
          coalesce((i->>'quantity_ordered')::numeric, 0) * coalesce((i->>'unit_price')::numeric, 0)
            * least(greatest(coalesce((i->>'discount_value')::numeric, 0), 0), 100) / 100, 2)
        when 'amount' then least(
          greatest(coalesce((i->>'discount_value')::numeric, 0), 0),
          coalesce((i->>'quantity_ordered')::numeric, 0) * coalesce((i->>'unit_price')::numeric, 0))
        else 0
      end
    ), 0)
  into v_subtotal, v_line_discount_total
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i;

  v_after_line_discounts := v_subtotal - v_line_discount_total;

  v_po_discount_amount := case
    when v_po_discount_type = 'percent' then round(v_after_line_discounts * least(greatest(v_po_discount_value, 0), 100) / 100, 2)
    when v_po_discount_type = 'amount' then least(greatest(v_po_discount_value, 0), v_after_line_discounts)
    else 0
  end;

  v_combined_discount := v_line_discount_total + v_po_discount_amount;
  v_net_of_discounts := v_after_line_discounts - v_po_discount_amount;

  if v_vat_type = 'inclusive' and v_vat_percent > 0 then
    v_taxable := round(v_net_of_discounts / (1 + v_vat_percent / 100), 2);
    v_vat_amount := v_net_of_discounts - v_taxable;
    v_total := v_net_of_discounts;
  else
    v_taxable := v_net_of_discounts;
    v_vat_amount := round(v_taxable * v_vat_percent / 100, 2);
    v_total := v_taxable + v_vat_amount;
  end if;

  update public.purchase_orders set
    supplier_id = (p_payload->>'supplier_id')::uuid,
    company_id = (p_payload->>'company_id')::uuid,
    project_id = (p_payload->>'project_id')::uuid,
    plot_id = v_plot_id,
    plot_group_id = v_plot_group_id,
    order_date = coalesce(nullif(p_payload->>'order_date', '')::date, order_date),
    expected_delivery_date = nullif(p_payload->>'expected_delivery_date', '')::date,
    delivery_address = nullif(p_payload->>'delivery_address', ''),
    vat_percent = v_vat_percent,
    vat_type = v_vat_type,
    payment_terms = p_payload->>'payment_terms',
    discount_type = v_po_discount_type,
    discount_value = v_po_discount_value,
    discount_amount = v_combined_discount,
    subtotal = v_subtotal,
    vat_amount = v_vat_amount,
    total_amount = v_total,
    note = p_payload->>'note'
  where id = p_id;

  -- Give back whatever this PO's current lines had consumed from the source
  -- request before those lines are replaced below (same idea as po_delete) -
  -- otherwise the re-consume pass further down would double-count the old
  -- and new amounts.
  if v_pr_id is not null then
    update public.purchase_request_items pri
    set quantity_requested = pri.quantity_requested + old_ordered.qty
    from (
      select purchase_request_item_id, sum(quantity_ordered) as qty
      from public.purchase_order_items
      where purchase_order_id = p_id and purchase_request_item_id is not null
      group by purchase_request_item_id
    ) old_ordered
    where pri.id = old_ordered.purchase_request_item_id
      and pri.purchase_request_id = v_pr_id;
  end if;

  -- Existing unreceived lines dropped from the payload: safe to delete
  -- outright (nothing references them).
  delete from public.purchase_order_items
  where purchase_order_id = p_id
    and quantity_received = 0
    and id not in (
      select public._jsonb_to_uuid(i->'id')
      from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
      where public._jsonb_to_uuid(i->'id') is not null
    );

  -- Existing lines (received or not) present in the payload: update in
  -- place so the row's id - and therefore quantity_received and any
  -- goods_receipt_items FK pointing at it - survives untouched.
  update public.purchase_order_items poi set
    material_type_id = (i->>'material_type_id')::bigint,
    purchase_request_item_id = public._jsonb_to_uuid(i->'purchase_request_item_id'),
    quantity_ordered = (i->>'quantity_ordered')::numeric,
    unit_price = coalesce((i->>'unit_price')::numeric, 0),
    description = nullif(i->>'description', ''),
    discount_type = coalesce(nullif(i->>'discount_type', ''), 'none'),
    discount_value = coalesce((i->>'discount_value')::numeric, 0),
    discount_amount = case coalesce(nullif(i->>'discount_type', ''), 'none')
      when 'percent' then round(
        (i->>'quantity_ordered')::numeric * coalesce((i->>'unit_price')::numeric, 0)
          * least(greatest(coalesce((i->>'discount_value')::numeric, 0), 0), 100) / 100, 2)
      when 'amount' then least(
        greatest(coalesce((i->>'discount_value')::numeric, 0), 0),
        (i->>'quantity_ordered')::numeric * coalesce((i->>'unit_price')::numeric, 0))
      else 0
    end
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where poi.purchase_order_id = p_id
    and public._jsonb_to_uuid(i->'id') = poi.id;

  -- Brand-new lines (no id): insert fresh.
  insert into public.purchase_order_items (
    purchase_order_id, material_type_id, purchase_request_item_id, quantity_ordered, unit_price, description,
    discount_type, discount_value, discount_amount
  )
  select
    p_id,
    (i->>'material_type_id')::bigint,
    public._jsonb_to_uuid(i->'purchase_request_item_id'),
    (i->>'quantity_ordered')::numeric,
    coalesce((i->>'unit_price')::numeric, 0),
    nullif(i->>'description', ''),
    coalesce(nullif(i->>'discount_type', ''), 'none'),
    coalesce((i->>'discount_value')::numeric, 0),
    case coalesce(nullif(i->>'discount_type', ''), 'none')
      when 'percent' then round(
        (i->>'quantity_ordered')::numeric * coalesce((i->>'unit_price')::numeric, 0)
          * least(greatest(coalesce((i->>'discount_value')::numeric, 0), 0), 100) / 100, 2)
      when 'amount' then least(
        greatest(coalesce((i->>'discount_value')::numeric, 0), 0),
        (i->>'quantity_ordered')::numeric * coalesce((i->>'unit_price')::numeric, 0))
      else 0
    end
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where coalesce((i->>'quantity_ordered')::numeric, 0) > 0
    and public._jsonb_to_uuid(i->'id') is null;

  delete from public.purchase_order_plots where purchase_order_id = p_id;

  insert into public.purchase_order_plots (purchase_order_id, plot_id)
  select p_id, elem::uuid
  from jsonb_array_elements_text(coalesce(p_payload->'plot_ids', '[]'::jsonb)) as elem
  where elem <> '';

  -- Re-consume based on the now-current lines.
  if v_pr_id is not null then
    update public.purchase_request_items pri
    set quantity_requested = greatest(0, pri.quantity_requested - new_ordered.qty)
    from (
      select purchase_request_item_id, sum(quantity_ordered) as qty
      from public.purchase_order_items
      where purchase_order_id = p_id and purchase_request_item_id is not null
      group by purchase_request_item_id
    ) new_ordered
    where pri.id = new_ordered.purchase_request_item_id
      and pri.purchase_request_id = v_pr_id;

    update public.purchase_requests
    set status = case
      when exists (
        select 1 from public.purchase_request_items
        where purchase_request_id = v_pr_id and quantity_requested > 0
      ) then 'approved'
      else 'ordered'
    end
    where id = v_pr_id and status in ('approved', 'ordered');
  end if;

  select
    bool_and(quantity_received >= quantity_ordered),
    bool_or(quantity_received > 0)
  into v_all_received, v_any_received
  from public.purchase_order_items
  where purchase_order_id = p_id;

  update public.purchase_orders set
    status = case
      when v_all_received then 'received'
      when v_any_received then 'partially_received'
      else status
    end,
    received_at = case when v_all_received and status <> 'received' then current_date else received_at end,
    received_by = case when v_all_received and status <> 'received' then v_uid else received_by end
  where id = p_id;

  return jsonb_build_object('id', p_id, 'po_no', v_po_no);
end;
$$;

grant execute on function public.po_update(uuid, jsonb) to authenticated;
