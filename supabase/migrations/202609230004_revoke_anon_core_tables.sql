-- Security fix (audit C-01 step 1): the anon role - the publishable key that
-- ships inside the website bundle - held full table grants (SELECT/INSERT/
-- UPDATE/DELETE) on every core business table. Most of these tables carry a
-- permissive RLS policy scoped to {public}/PUBLIC (roles shown as "-" by
-- has_table_privilege checks), which applies to anon too, so anon could read,
-- change or delete projects, plots, BOQs, jobs, payments, contractors,
-- procurement and stock data without logging in - no session required.
--
-- This revokes anon's table grants only. It does not touch the RLS policies
-- themselves (still permissive for `authenticated`) - that's Phase 6 of the
-- handover plan (per-table rules). Nothing here changes app behavior:
--   - Every screen lives under /dashboard, which middleware.ts redirects to
--     /login when there's no session, and every query in actions/* runs
--     through the cookie-backed client (lib/supabase/server.ts) as role
--     `authenticated`, which keeps all of its existing grants.
--   - No API route, RPC caller or service-role path uses anon for any of
--     these tables.
--
-- Also fixes two tables that had RLS disabled entirely (advisor:
-- rls_disabled_in_public) and two SECURITY DEFINER RPCs callable by anon
-- (advisor: anon_security_definer_function_executable).
--
-- Rollback, if this ever turns out to break something:
--   grant select, insert, update, delete on public.projects, public.plots,
--     public.plot_groups, public.plot_group_members, public.house_models,
--     public.boq_master, public.boq_material_items, public.job_assignments,
--     public.payments, public.contractors, public.contractor_types,
--     public.material_types, public.inspections, public.settings,
--     public.document_signature_slots, public.goods_receipt_number_counters,
--     public.purchase_orders, public.purchase_order_items,
--     public.purchase_order_plots, public.purchase_requests,
--     public.purchase_request_items, public.purchase_request_plots,
--     public.purchase_request_item_settlements, public.goods_receipts,
--     public.goods_receipt_items, public.payment_vouchers,
--     public.payment_voucher_receipts, public.stock_balances,
--     public.stock_movements, public.suppliers, public.companies,
--     public.notifications to anon;
--   grant execute on function public.payment_voucher_create(jsonb),
--     public.payment_voucher_void(uuid) to anon, public;
--   alter table public.goods_receipt_number_counters disable row level security;
--   alter table public.document_signature_slots disable row level security;

revoke all on table
  public.projects,
  public.plots,
  public.plot_groups,
  public.plot_group_members,
  public.house_models,
  public.boq_master,
  public.boq_material_items,
  public.job_assignments,
  public.payments,
  public.contractors,
  public.contractor_types,
  public.material_types,
  public.inspections,
  public.settings,
  public.document_signature_slots,
  public.goods_receipt_number_counters,
  public.purchase_orders,
  public.purchase_order_items,
  public.purchase_order_plots,
  public.purchase_requests,
  public.purchase_request_items,
  public.purchase_request_plots,
  public.purchase_request_item_settlements,
  public.goods_receipts,
  public.goods_receipt_items,
  public.payment_vouchers,
  public.payment_voucher_receipts,
  public.stock_balances,
  public.stock_movements,
  public.suppliers,
  public.companies,
  public.notifications
from anon;

revoke execute on function public.payment_voucher_create(jsonb), public.payment_voucher_void(uuid)
  from anon, public;
grant execute on function public.payment_voucher_create(jsonb), public.payment_voucher_void(uuid)
  to authenticated;

-- goods_receipt_number_counters: no app code reads or writes this table
-- directly - only the SECURITY DEFINER function goods_receipt_create() does,
-- which runs with the function owner's privileges regardless of grants to
-- `authenticated`. So it gets RLS enabled with zero policies (default deny)
-- and its `authenticated` grants revoked too.
alter table public.goods_receipt_number_counters enable row level security;
revoke all on table public.goods_receipt_number_counters from authenticated;

-- document_signature_slots: read by any logged-in user (label/image metadata
-- only, no document contents - see the comment on getSignatureSlots in
-- actions/signature-slots-actions.ts), written only by replaceSignatureSlots,
-- which already gates on requireAuthRole(['admin']) before touching the
-- table. The RLS policy backs that same rule at the database layer.
alter table public.document_signature_slots enable row level security;

create policy document_signature_slots_select on public.document_signature_slots
  for select
  to authenticated
  using (true);

create policy document_signature_slots_write on public.document_signature_slots
  for insert
  to authenticated
  with check (public._billing_current_role() = 'admin');

create policy document_signature_slots_update on public.document_signature_slots
  for update
  to authenticated
  using (public._billing_current_role() = 'admin')
  with check (public._billing_current_role() = 'admin');

create policy document_signature_slots_delete on public.document_signature_slots
  for delete
  to authenticated
  using (public._billing_current_role() = 'admin');
