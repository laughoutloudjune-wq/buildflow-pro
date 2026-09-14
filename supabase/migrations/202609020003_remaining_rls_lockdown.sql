-- Security fix: the advisor flagged "RLS disabled" on 6 more public-schema
-- tables, same issue as public.profiles (202609020002_profiles_rls_lockdown.sql).
-- A follow-up check confirmed anon (and authenticated) hold identical full
-- CRUD grants (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) on
-- every one of them, confirmed via information_schema.role_table_grants
-- against project ovgtetlvzoremixrjoob.
--
-- organization_settings (1 row, live) - holds role_permissions, the app's
-- entire per-role module-access matrix (read by every dashboard page via
-- lib/auth/route-access.ts's getDashboardSession, and by lib/permissions.ts's
-- canRoleAccessModule/getPermissionsForRole), plus billing defaults and the
-- company signature/tax info printed on PDFs. Writes in
-- actions/settings-actions.ts (updateBillingInfo, updateFinancialDefaults,
-- updateRolePermissions) are plain-client updates gated only by
-- requireAuthRole(['admin']) or a TS-side role check - the same pattern
-- profiles had - so without a DB-level admin check, any authenticated
-- non-admin could rewrite role_permissions (granting themselves access to
-- admin-only modules) via a raw REST call carrying their own valid JWT.
-- SELECT stays broad because getDashboardSession reads role_permissions for
-- every logged-in user on every navigation, regardless of role.
--
-- purchase_order_number_counters (2 rows, live) - not referenced anywhere in
-- the TS codebase; only ever written by public.po_create(), which is
-- `security definer` and owned by postgres (confirmed via pg_proc/pg_roles),
-- so it bypasses RLS and table grants entirely regardless of what anon/
-- authenticated hold. Locked down to deny-all: nothing legitimate needs
-- direct client access, and unrestricted access here could let anyone
-- corrupt the PO numbering sequence.
--
-- invoices, invoice_items, progress_logs, master_data (0 rows each, zero
-- references in actions/**, app/**, components/**, lib/**, or any migration)
-- - dead schema superseded by the live billings/billing_jobs tables. Locked
-- down to deny-all rather than dropped, per user decision, to keep this fix
-- minimal and reversible.
--
-- Safe to re-run: policies are dropped before re-creation.

-- ---------------------------------------------------------------------------
-- organization_settings
-- ---------------------------------------------------------------------------
alter table public.organization_settings enable row level security;

drop policy if exists "organization_settings_select" on public.organization_settings;
create policy "organization_settings_select" on public.organization_settings
  for select to authenticated
  using (true);

drop policy if exists "organization_settings_insert_admin" on public.organization_settings;
create policy "organization_settings_insert_admin" on public.organization_settings
  for insert to authenticated
  with check (public._billing_current_role() = 'admin');

drop policy if exists "organization_settings_update_admin" on public.organization_settings;
create policy "organization_settings_update_admin" on public.organization_settings
  for update to authenticated
  using (public._billing_current_role() = 'admin')
  with check (public._billing_current_role() = 'admin');

-- No DELETE policy: nothing in the app deletes this row.

revoke all on public.organization_settings from anon;

-- ---------------------------------------------------------------------------
-- purchase_order_number_counters - deny-all, RPC-only access.
-- ---------------------------------------------------------------------------
alter table public.purchase_order_number_counters enable row level security;

-- ---------------------------------------------------------------------------
-- Dead tables (0 rows, unreferenced) - deny-all.
-- ---------------------------------------------------------------------------
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.progress_logs enable row level security;
alter table public.master_data enable row level security;

revoke all on public.purchase_order_number_counters, public.invoices,
  public.invoice_items, public.progress_logs, public.master_data
  from anon, authenticated;
