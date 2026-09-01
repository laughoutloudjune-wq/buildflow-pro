-- Adds discount (type + value, snapshotted amount) to purchase_orders, and
-- an optional free-text description per line item.
alter table public.purchase_orders add column if not exists discount_type text not null default 'none'
  check (discount_type in ('none', 'percent', 'amount'));
alter table public.purchase_orders add column if not exists discount_value numeric not null default 0;
alter table public.purchase_orders add column if not exists discount_amount numeric not null default 0;

alter table public.purchase_order_items add column if not exists description text;

-- po_create: subtract the discount from the subtotal before computing VAT,
-- and persist each item's optional description.
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
  v_discount_type text := coalesce(nullif(p_payload->>'discount_type', ''), 'none');
  v_discount_value numeric := coalesce((p_payload->>'discount_value')::numeric, 0);
  v_discount_amount numeric := 0;
  v_subtotal numeric := 0;
  v_taxable numeric := 0;
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

  v_discount_amount := case
    when v_discount_type = 'percent' then round(v_subtotal * least(greatest(v_discount_value, 0), 100) / 100, 2)
    when v_discount_type = 'amount' then least(greatest(v_discount_value, 0), v_subtotal)
    else 0
  end;

  v_taxable := v_subtotal - v_discount_amount;
  v_vat_amount := round(v_taxable * v_vat_percent / 100, 2);
  v_total := v_taxable + v_vat_amount;

  insert into public.purchase_order_number_counters (order_date, counter)
  values (v_order_date, 1)
  on conflict (order_date) do update set counter = purchase_order_number_counters.counter + 1
  returning counter into v_seq;

  v_po_no := 'PO-' || to_char(v_order_date, 'YYYYMMDD') || lpad(v_seq::text, 3, '0');

  insert into public.purchase_orders (
    po_no, supplier_id, company_id, project_id, purchase_request_id,
    order_date, expected_delivery_date, vat_percent, payment_terms,
    discount_type, discount_value, discount_amount,
    subtotal, vat_amount, total_amount,
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
    v_discount_type,
    v_discount_value,
    v_discount_amount,
    v_subtotal,
    v_vat_amount,
    v_total,
    p_payload->>'note',
    v_uid,
    'sent'
  )
  returning id into v_po_id;

  insert into public.purchase_order_items (
    purchase_order_id, material_type_id, purchase_request_item_id, quantity_ordered, unit_price, description
  )
  select
    v_po_id,
    (i->>'material_type_id')::bigint,
    public._jsonb_to_uuid(i->'purchase_request_item_id'),
    (i->>'quantity_ordered')::numeric,
    coalesce((i->>'unit_price')::numeric, 0),
    nullif(i->>'description', '')
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where coalesce((i->>'quantity_ordered')::numeric, 0) > 0;

  if v_pr_id is not null then
    update public.purchase_requests set status = 'ordered' where id = v_pr_id and status = 'approved';
  end if;

  return jsonb_build_object('id', v_po_id, 'po_no', v_po_no);
end;
$$;

grant execute on function public.po_create(jsonb) to authenticated;
