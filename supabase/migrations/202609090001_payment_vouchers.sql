-- Introduces the proper document chain the user's other system (SMEmove)
-- uses: PO -> ใบรับสินค้า (RI, goods receipt) -> ใบสำคัญจ่าย (PP, payment
-- voucher). Until now a "goods receipt" was an invisible audit row (no
-- document number, never listed) and "paid" was a bare status flip on the
-- PO itself (po_mark_paid) with no document behind it at all. This migration:
--   1. Gives goods_receipts a real document number (RI-YYYYMMDD###, same
--      pattern as po_no) so it can be a first-class listed document.
--   2. Adds payment_vouchers + payment_voucher_receipts: a payment bundles
--      one or more UNPAID receipts (same supplier) into one PP-######
--      document. A receipt can belong to at most one voucher (unique FK) -
--      no partial-receipt payments, no double-paying.
--   3. Replaces po_mark_paid/po_unmark_paid entirely - the only way a PO can
--      reach 'paid' now is once every one of its receipts has been paid via
--      a payment_voucher (payment_voucher_create recomputes PO status the
--      same way goods_receipt_create already does for 'received').

-- ---------------------------------------------------------------------------
-- 1. goods_receipts document number
-- ---------------------------------------------------------------------------
create table if not exists public.goods_receipt_number_counters (
  receipt_date date primary key,
  counter int not null default 0
);

alter table public.goods_receipts add column if not exists ri_no text;

with numbered as (
  select id, received_at::date as d,
    row_number() over (partition by received_at::date order by received_at, id) as rn
  from public.goods_receipts
  where ri_no is null
)
update public.goods_receipts gr
set ri_no = 'RI-' || to_char(n.d, 'YYYYMMDD') || lpad(n.rn::text, 3, '0')
from numbered n
where gr.id = n.id;

alter table public.goods_receipts alter column ri_no set not null;
alter table public.goods_receipts drop constraint if exists goods_receipts_ri_no_key;
alter table public.goods_receipts add constraint goods_receipts_ri_no_key unique (ri_no);

insert into public.goods_receipt_number_counters (receipt_date, counter)
select received_at::date, count(*) from public.goods_receipts group by received_at::date
on conflict (receipt_date) do update set counter = greatest(goods_receipt_number_counters.counter, excluded.counter);

-- ---------------------------------------------------------------------------
-- 2. payment_vouchers + payment_voucher_receipts
-- ---------------------------------------------------------------------------
create sequence if not exists public.payment_voucher_no_seq;

create table if not exists public.payment_vouchers (
  id uuid primary key default gen_random_uuid(),
  pp_no text not null unique,
  supplier_id uuid not null references public.suppliers(id),
  company_id uuid not null references public.companies(id),
  payment_date date not null default current_date,
  payment_method text not null default 'cash' check (payment_method in ('cash', 'bank_transfer', 'director_loan')),
  subtotal numeric not null default 0,
  vat_amount numeric not null default 0,
  total_amount numeric not null default 0,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- unique(goods_receipt_id): a receipt can be linked to at most one voucher
-- ever, which doubles as the "is this receipt already paid" check.
create table if not exists public.payment_voucher_receipts (
  id uuid primary key default gen_random_uuid(),
  payment_voucher_id uuid not null references public.payment_vouchers(id) on delete cascade,
  goods_receipt_id uuid not null unique references public.goods_receipts(id),
  subtotal numeric not null default 0,
  vat_amount numeric not null default 0,
  amount numeric not null default 0
);
create index if not exists payment_voucher_receipts_voucher_idx on public.payment_voucher_receipts (payment_voucher_id);

alter table public.payment_vouchers enable row level security;
alter table public.payment_voucher_receipts enable row level security;

drop policy if exists "payment_vouchers_select" on public.payment_vouchers;
create policy "payment_vouchers_select" on public.payment_vouchers for select to authenticated using (true);

drop policy if exists "payment_voucher_receipts_select" on public.payment_voucher_receipts;
create policy "payment_voucher_receipts_select" on public.payment_voucher_receipts for select to authenticated using (true);

grant select on public.payment_vouchers, public.payment_voucher_receipts to authenticated;

-- ---------------------------------------------------------------------------
-- goods_receipt_create: unchanged behaviour, plus generating ri_no.
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
  v_received_at timestamptz := coalesce(nullif(p_payload->>'received_at', '')::timestamptz, now());
  v_receipt_id uuid;
  v_ri_no text;
  v_seq int;
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

  return jsonb_build_object('id', v_receipt_id, 'ri_no', v_ri_no, 'po_status', v_new_po_status);
end;
$$;

grant execute on function public.goods_receipt_create(jsonb) to authenticated;
grant execute on function public.goods_receipt_create(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- payment_voucher_create: bundles one or more not-yet-paid goods_receipts
-- (validated same supplier) into one payment voucher. Per receipt, VAT is
-- computed from its own PO's vat_percent/vat_type (same formula as
-- po_create) since a receipt only ever belongs to one PO. Any PO whose
-- receipts are now ALL paid flips to status='paid'.
-- ---------------------------------------------------------------------------
create or replace function public.payment_voucher_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_supplier_id uuid := (p_payload->>'supplier_id')::uuid;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_payment_date date := coalesce(nullif(p_payload->>'payment_date', '')::date, current_date);
  v_payment_method text := coalesce(nullif(p_payload->>'payment_method', ''), 'cash');
  v_receipt_ids uuid[];
  v_pp_no text;
  v_seq bigint;
  v_voucher_id uuid;
  v_subtotal numeric := 0;
  v_vat_amount numeric := 0;
  v_total numeric := 0;
  v_bad_count int;
  v_po record;
  v_all_paid boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can create a payment voucher' using errcode = '42501';
  end if;
  if v_supplier_id is null then
    raise exception 'Supplier is required' using errcode = '22004';
  end if;

  select array_agg(distinct value::uuid) into v_receipt_ids
  from jsonb_array_elements_text(coalesce(p_payload->'receipt_ids', '[]'::jsonb));

  if v_receipt_ids is null or array_length(v_receipt_ids, 1) is null then
    raise exception 'Select at least one receipt to pay' using errcode = '22004';
  end if;

  -- Every receipt must exist, belong to this supplier, and not already be
  -- linked to another payment voucher.
  select count(*) into v_bad_count
  from unnest(v_receipt_ids) rid
  where not exists (
    select 1 from public.goods_receipts gr
    join public.purchase_orders po on po.id = gr.purchase_order_id
    where gr.id = rid and po.supplier_id = v_supplier_id
  ) or exists (
    select 1 from public.payment_voucher_receipts pvr where pvr.goods_receipt_id = rid
  );
  if v_bad_count > 0 then
    raise exception 'One or more selected receipts are invalid, belong to a different supplier, or are already paid' using errcode = '22023';
  end if;

  v_pp_no := 'PP-' || lpad(nextval('public.payment_voucher_no_seq')::text, 9, '0');

  insert into public.payment_vouchers (pp_no, supplier_id, company_id, payment_date, payment_method, note, created_by)
  values (v_pp_no, v_supplier_id, v_company_id, v_payment_date, v_payment_method, nullif(p_payload->>'note', ''), v_uid)
  returning id into v_voucher_id;

  with receipt_totals as (
    select
      gr.id as receipt_id,
      gr.purchase_order_id,
      po.vat_percent,
      po.vat_type,
      coalesce(sum(gri.quantity_received * gri.unit_price_at_receipt), 0) as line_total
    from public.goods_receipts gr
    join public.purchase_orders po on po.id = gr.purchase_order_id
    join public.goods_receipt_items gri on gri.goods_receipt_id = gr.id
    where gr.id = any(v_receipt_ids)
    group by gr.id, gr.purchase_order_id, po.vat_percent, po.vat_type
  ),
  computed as (
    select
      receipt_id,
      case when vat_type = 'inclusive' and vat_percent > 0
        then round(line_total / (1 + vat_percent / 100), 2)
        else line_total
      end as r_subtotal,
      case when vat_type = 'inclusive' and vat_percent > 0
        then line_total - round(line_total / (1 + vat_percent / 100), 2)
        else round(line_total * vat_percent / 100, 2)
      end as r_vat,
      case when vat_type = 'inclusive'
        then line_total
        else line_total + round(line_total * vat_percent / 100, 2)
      end as r_total
    from receipt_totals
  )
  insert into public.payment_voucher_receipts (payment_voucher_id, goods_receipt_id, subtotal, vat_amount, amount)
  select v_voucher_id, receipt_id, r_subtotal, r_vat, r_total from computed;

  select coalesce(sum(subtotal), 0), coalesce(sum(vat_amount), 0), coalesce(sum(amount), 0)
  into v_subtotal, v_vat_amount, v_total
  from public.payment_voucher_receipts where payment_voucher_id = v_voucher_id;

  update public.payment_vouchers
  set subtotal = v_subtotal, vat_amount = v_vat_amount, total_amount = v_total
  where id = v_voucher_id;

  -- A PO becomes 'paid' once every one of its receipts has a voucher.
  for v_po in
    select distinct gr.purchase_order_id as id
    from public.goods_receipts gr
    where gr.id = any(v_receipt_ids)
  loop
    select bool_and(pvr.id is not null) into v_all_paid
    from public.goods_receipts gr
    left join public.payment_voucher_receipts pvr on pvr.goods_receipt_id = gr.id
    where gr.purchase_order_id = v_po.id;

    if v_all_paid then
      update public.purchase_orders
      set status = 'paid', paid_at = v_payment_date, paid_by = v_uid
      where id = v_po.id and status = 'received';
    end if;
  end loop;

  return jsonb_build_object('id', v_voucher_id, 'pp_no', v_pp_no, 'total_amount', v_total);
end;
$$;

grant execute on function public.payment_voucher_create(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- payment_voucher_void: undo - unlinks its receipts and reverts any PO that
-- had been flipped to 'paid' because of this voucher back to 'received'.
-- ---------------------------------------------------------------------------
create or replace function public.payment_voucher_void(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._billing_current_role();
  v_po_ids uuid[];
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can void a payment voucher' using errcode = '42501';
  end if;

  select array_agg(distinct gr.purchase_order_id) into v_po_ids
  from public.payment_voucher_receipts pvr
  join public.goods_receipts gr on gr.id = pvr.goods_receipt_id
  where pvr.payment_voucher_id = p_id;

  if v_po_ids is null then
    raise exception 'Payment voucher not found' using errcode = 'P0002';
  end if;

  delete from public.payment_vouchers where id = p_id;

  update public.purchase_orders
  set status = 'received', paid_at = null, paid_by = null
  where id = any(v_po_ids) and status = 'paid';

  return jsonb_build_object('id', p_id, 'voided', true);
end;
$$;

grant execute on function public.payment_voucher_void(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The manual "mark as paid" shortcut is replaced by payment vouchers - the
-- only way a PO reaches 'paid' now is once every receipt has one.
-- po_mark_received/po_unmark_received are untouched (receiving still has its
-- own manual whole-document shortcut independent of line-level quantities).
-- ---------------------------------------------------------------------------
drop function if exists public.po_mark_paid(uuid[], date);
drop function if exists public.po_unmark_paid(uuid);
