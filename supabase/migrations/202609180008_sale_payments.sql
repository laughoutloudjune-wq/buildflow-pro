-- Sales module, Phase 7 (SALES_MODULE_PLAN.md §7.7/§7.9, confirmed in scope per D1).
--
-- sale_payments is its own ledger of individual payment lines (booking,
-- contract, down-payment installments, transfer, extra) - separate from
-- plot_sales.booking_amount/contract_amount/down_total, which stay what
-- they always were: the *agreed* terms, editable via updatePlotSaleDetails.
-- This table is the *actual* payment history each of those terms is checked
-- against; the two are related but deliberately not kept in sync
-- automatically, the same way sale_price and an eventual paid total aren't.
create table public.sale_payments (
  id            uuid primary key default gen_random_uuid(),
  plot_sale_id  uuid not null references public.plot_sales(id) on delete cascade,
  kind          text not null check (kind in ('booking','contract','down','transfer','extra')),
  installment_no int,
  due_date      date,
  amount_due    numeric not null default 0,
  paid_at       date,
  amount_paid   numeric,
  method        text,
  receipt_no    text unique,
  note          text,
  created_at    timestamptz not null default now()
);

create index sale_payments_plot_sale_id_idx on public.sale_payments(plot_sale_id);
-- The overdue list's own query shape: unpaid rows with a due date.
create index sale_payments_overdue_idx on public.sale_payments(due_date) where paid_at is null;

alter table public.sale_payments enable row level security;
create policy "sale_payments_all"
  on public.sale_payments for all to authenticated
  using (public._billing_current_role() in ('admin','pm','sales'))
  with check (public._billing_current_role() in ('admin','pm','sales'));
grant select, insert, update, delete on public.sale_payments to authenticated;
revoke all on public.sale_payments from anon;

create table public.sale_receipt_number_counters (
  receipt_date date primary key,
  counter int not null
);
alter table public.sale_receipt_number_counters enable row level security;
create policy "sale_receipt_counter_all"
  on public.sale_receipt_number_counters for all to authenticated
  using (public._billing_current_role() in ('admin','pm','sales'))
  with check (public._billing_current_role() in ('admin','pm','sales'));
grant select, insert, update on public.sale_receipt_number_counters to authenticated;
revoke all on public.sale_receipt_number_counters from anon;

-- document_signature_slots gains a 4th document_type for the receipt print
-- route (mirrors 'billing''s signature-slot setup, per the plan). Slots for
-- it use a custom label with no system_key - 'requester'/'reviewer'/
-- 'preparer'/'supplier' don't fit "ผู้รับเงิน"/"ผู้ชำระเงิน", and system_key
-- is nullable precisely for this case (see lib/types/signatures.ts).
alter table public.document_signature_slots drop constraint document_signature_slots_document_type_check;
alter table public.document_signature_slots add constraint document_signature_slots_document_type_check
  check (document_type = any (array['purchase_request','purchase_order','billing','sale_receipt']));

-- ---------------------------------------------------------------------------
-- sales-docs: a PRIVATE bucket for customer ID cards, signed contracts and
-- (if ever exported as a file rather than reprinted on demand) receipts -
-- unlike 'assets', which is public. The receipt PRINT route itself does NOT
-- use this bucket: it renders the PDF live from plot_sales/sale_payments
-- data on every open, the same way BillingPdf.tsx does for billing - a
-- Next.js route under /dashboard is already unreachable without a login, so
-- "not reachable without a login" doesn't need a signed URL for that part.
-- This bucket exists for the OTHER half of §7.9 (uploaded ID/contract scans),
-- whose upload UI isn't built this phase.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sales-docs', 'sales-docs', false, 10485760, array['application/pdf','image/png','image/jpeg','image/jpg','image/webp'])
on conflict (id) do nothing;

create policy "sales_docs_select" on storage.objects for select to authenticated
  using (bucket_id = 'sales-docs' and public._billing_current_role() in ('admin','pm','sales'));
create policy "sales_docs_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'sales-docs' and public._billing_current_role() in ('admin','pm','sales'));
create policy "sales_docs_update" on storage.objects for update to authenticated
  using (bucket_id = 'sales-docs' and public._billing_current_role() in ('admin','pm','sales'));
create policy "sales_docs_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'sales-docs' and public._billing_current_role() in ('admin','pm','sales'));
