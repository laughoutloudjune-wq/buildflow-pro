-- Two fixes to purchase_orders:
--   1. po_no becomes a proper document number (PO-YYYYMMDD###, reset daily)
--      instead of a bare cross-order sequential integer.
--   2. payment_terms is snapshotted onto the order at creation time (same
--      reasoning as material_usage_log.unit_price_at_use - if the supplier's
--      terms change later, past POs must keep showing what was agreed then).
--
-- Only 1 test row exists in purchase_orders at the time of this migration
-- (no real business data yet), but the conversion below handles any number
-- of existing rows safely rather than assuming the table is empty.

create table if not exists public.purchase_order_number_counters (
  order_date date primary key,
  counter int not null default 0
);

alter table public.purchase_orders add column if not exists payment_terms text;

-- Convert po_no from integer (serial) to the formatted text doc number.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_orders'
      and column_name = 'po_no' and data_type <> 'text'
  ) then
    alter table public.purchase_orders add column po_no_text text;
    update public.purchase_orders
      set po_no_text = 'PO-' || to_char(order_date, 'YYYYMMDD') || lpad(po_no::text, 3, '0');
    alter table public.purchase_orders drop column po_no;
    alter table public.purchase_orders rename column po_no_text to po_no;
    alter table public.purchase_orders alter column po_no set not null;
    alter table public.purchase_orders add constraint purchase_orders_po_no_key unique (po_no);
  end if;
end $$;

-- Seed the daily counters from whatever already exists so new POs created
-- on the same order_date as a converted row don't collide with it.
insert into public.purchase_order_number_counters (order_date, counter)
select order_date, count(*) from public.purchase_orders group by order_date
on conflict (order_date) do update set counter = greatest(purchase_order_number_counters.counter, excluded.counter);

-- ---------------------------------------------------------------------------
-- po_create: regenerate to produce the PO-YYYYMMDD### number atomically via
-- the counter table (INSERT ... ON CONFLICT DO UPDATE on a single row is
-- race-safe under concurrent same-day inserts) and to store payment_terms.
-- ---------------------------------------------------------------------------
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
    'draft'
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
