-- Removes the separate "send to supplier" status step. There's no real
-- send action (no email integration), so a distinct draft -> sent click was
-- just a confusing extra step. A created PO is now immediately actionable
-- (receivable), matching how the user actually works: build the PO, hand it
-- to the supplier yourself (download the PDF), and go straight to receiving
-- goods when they arrive.
create or replace function public.po_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_po_id uuid;
  v_po_no text;
  v_order_date date := coalesce(nullif(p_payload->>'order_date', '')::date, current_date);
  v_seq int;
  v_pr_id uuid := public._jsonb_to_uuid(p_payload->'purchase_request_id');
  v_vat_percent numeric := coalesce((p_payload->>'vat_percent')::numeric, 0);
  v_subtotal numeric := 0;
  v_vat_amount numeric := 0;
  v_total numeric := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can create a purchase order' using errcode = '42501';
  end if;

  select coalesce(sum(coalesce((i->>'quantity_ordered')::numeric, 0) * coalesce((i->>'unit_price')::numeric, 0)), 0)
  into v_subtotal
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i;

  v_vat_amount := round(v_subtotal * v_vat_percent / 100, 2);
  v_total := v_subtotal + v_vat_amount;

  insert into public.purchase_order_number_counters (order_date, counter)
  values (v_order_date, 1)
  on conflict (order_date) do update set counter = purchase_order_number_counters.counter + 1
  returning counter into v_seq;

  v_po_no := 'PO-' || to_char(v_order_date, 'YYYYMMDD') || lpad(v_seq::text, 3, '0');

  insert into public.purchase_orders (
    po_no, supplier_id, company_id, project_id, purchase_request_id,
    order_date, expected_delivery_date, vat_percent, payment_terms, subtotal, vat_amount, total_amount,
    note, created_by, status
  ) values (
    v_po_no,
    (p_payload->>'supplier_id')::uuid,
    (p_payload->>'company_id')::uuid,
    (p_payload->>'project_id')::uuid,
    v_pr_id,
    v_order_date,
    nullif(p_payload->>'expected_delivery_date', '')::date,
    v_vat_percent,
    p_payload->>'payment_terms',
    v_subtotal,
    v_vat_amount,
    v_total,
    p_payload->>'note',
    v_uid,
    'sent'
  )
  returning id into v_po_id;

  insert into public.purchase_order_items (
    purchase_order_id, material_type_id, purchase_request_item_id, quantity_ordered, unit_price
  )
  select
    v_po_id,
    (i->>'material_type_id')::bigint,
    public._jsonb_to_uuid(i->'purchase_request_item_id'),
    (i->>'quantity_ordered')::numeric,
    coalesce((i->>'unit_price')::numeric, 0)
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where coalesce((i->>'quantity_ordered')::numeric, 0) > 0;

  if v_pr_id is not null then
    update public.purchase_requests set status = 'ordered' where id = v_pr_id and status = 'approved';
  end if;

  return jsonb_build_object('id', v_po_id, 'po_no', v_po_no);
end;
$$;

grant execute on function public.po_create(jsonb) to authenticated;
