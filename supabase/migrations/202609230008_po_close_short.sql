-- Handover plan Phase 4.6 (M-04): a partly delivered PO had no way out
-- besides waiting for the rest to arrive - it stayed "รับของบางส่วน" forever,
-- clutters the open-orders list, and its shortfall keeps counting as "on
-- order" in BOQ control. po_close_short sets every short line's ordered
-- quantity down to what actually arrived, recomputes the PO totals the same
-- way po_update does (each shrunk line's discount_amount is recomputed for
-- its new quantity too, not left priced for the cancelled remainder),
-- returns the un-ordered remainder to the linked purchase request (same
-- give-back po_cancel/po_delete already do), and closes the PO as
-- 'received' with the reason appended to its note.

create or replace function public.po_close_short(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_pr_id uuid;
  v_po_discount_type text;
  v_po_discount_value numeric;
  v_vat_percent numeric;
  v_vat_type text;
  v_subtotal numeric;
  v_line_discount_total numeric;
  v_after_line_discounts numeric;
  v_po_discount_amount numeric;
  v_net_of_discounts numeric;
  v_taxable numeric;
  v_vat_amount numeric;
  v_total numeric;
  v_trimmed_reason text := nullif(trim(both from coalesce(p_reason, '')), '');
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can close a purchase order' using errcode = '42501';
  end if;
  if v_trimmed_reason is null then
    raise exception 'A reason is required to close a purchase order short' using errcode = '22023';
  end if;

  select status, purchase_request_id, discount_type, discount_value, vat_percent, vat_type
  into v_status, v_pr_id, v_po_discount_type, v_po_discount_value, v_vat_percent, v_vat_type
  from public.purchase_orders where id = p_id;

  if v_status is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if v_status <> 'partially_received' then
    raise exception 'Can only close short a partially received purchase order' using errcode = '42501';
  end if;

  -- Give back the un-ordered remainder to the linked PR line (like
  -- po_cancel/po_delete), computed before the lines themselves shrink.
  if v_pr_id is not null then
    update public.purchase_request_items pri
    set quantity_requested = pri.quantity_requested + outstanding.qty
    from (
      select poi.purchase_request_item_id, sum(poi.quantity_ordered - poi.quantity_received) as qty
      from public.purchase_order_items poi
      join public.purchase_request_items pri2 on pri2.id = poi.purchase_request_item_id
      join public.material_types mt on mt.id = poi.material_type_id
      where poi.purchase_order_id = p_id
        and poi.purchase_request_item_id is not null
        and poi.quantity_ordered > poi.quantity_received
        and coalesce(poi.unit, mt.unit) is not distinct from coalesce(pri2.unit, mt.unit)
      group by poi.purchase_request_item_id
    ) outstanding
    where pri.id = outstanding.purchase_request_item_id
      and pri.purchase_request_id = v_pr_id;
  end if;

  -- Shrink every short line's ordered quantity down to what arrived, and
  -- recompute its own discount_amount for the new quantity (same formula
  -- po_create/po_update use) rather than leaving it priced for the
  -- cancelled remainder. closes_request_line is cleared too - it means "this
  -- order line satisfies its request line in full," which is no longer true
  -- once part of it was cancelled; leaving it true would make
  -- _pr_recompute_status treat the request as answered instead of the
  -- request line reopening for the remainder just given back above.
  update public.purchase_order_items
  set quantity_ordered = quantity_received,
      closes_request_line = false,
      discount_amount = case discount_type
        when 'percent' then round(quantity_received * unit_price * least(greatest(discount_value, 0), 100) / 100, 2)
        when 'amount' then least(greatest(discount_value, 0), quantity_received * unit_price)
        else 0
      end
  where purchase_order_id = p_id
    and quantity_ordered > quantity_received;

  -- Recompute PO totals from the now-shrunk lines, same math po_update uses.
  select
    coalesce(sum(quantity_ordered * unit_price), 0),
    coalesce(sum(discount_amount), 0)
  into v_subtotal, v_line_discount_total
  from public.purchase_order_items
  where purchase_order_id = p_id;

  v_after_line_discounts := v_subtotal - v_line_discount_total;

  v_po_discount_amount := case
    when v_po_discount_type = 'percent' then round(v_after_line_discounts * least(greatest(coalesce(v_po_discount_value, 0), 0), 100) / 100, 2)
    when v_po_discount_type = 'amount' then least(greatest(coalesce(v_po_discount_value, 0), 0), v_after_line_discounts)
    else 0
  end;

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

  update public.purchase_orders
  set status = 'received',
      discount_amount = v_line_discount_total + v_po_discount_amount,
      subtotal = v_subtotal,
      vat_amount = v_vat_amount,
      total_amount = v_total,
      note = coalesce(note || E'\n', '') || 'ปิดใบสั่งซื้อ (ส่งไม่ครบ): ' || v_trimmed_reason,
      received_at = coalesce(received_at, current_date),
      received_by = coalesce(received_by, v_uid)
  where id = p_id;

  if v_pr_id is not null then
    perform public._pr_recompute_status(v_pr_id);
  end if;

  return jsonb_build_object('id', p_id, 'status', 'received');
end;
$function$;

revoke execute on function public.po_close_short(uuid, text) from anon, public;
grant execute on function public.po_close_short(uuid, text) to authenticated;
