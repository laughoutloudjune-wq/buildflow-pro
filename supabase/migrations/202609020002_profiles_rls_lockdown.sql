-- Security fix: public.profiles has RLS disabled AND the anon role holds
-- full CRUD grants (confirmed via information_schema.role_table_grants
-- against project ovgtetlvzoremixrjoob) - an unauthenticated caller with only
-- the anon key can read, modify, or delete ANY row, including `role`, which
-- every RPC/server action in this app (_billing_current_role(),
-- requireAuthRole()) treats as the source of truth for authorization.
--
-- Fix:
--   1) Enable RLS. SELECT stays broad ("for select to authenticated using
--      (true)") to match this codebase's existing convention (suppliers,
--      companies, purchase_orders, stock_movements, etc. - see
--      202608170001_procurement.sql / 202608220001_stock_movements.sql) -
--      required because dashboard-actions.ts, billing/reports.ts,
--      stock-actions.ts, and procurement/orders.ts|requests.ts all embed
--      profiles joins to show OTHER users' names (creator/receiver/payer/
--      requester/submitted_by/approved_by), not just the caller's own row.
--   2) INSERT/UPDATE are scoped to the caller's own row (or any row, for an
--      admin). Unlike most other tables in this app, writes here can't be
--      purely TS-gated: actions/settings-actions.ts's updateUserRole/
--      updateUserFullName run as the calling user's own session (plain anon
--      key + cookies, no service role, no security-definer RPC), so without
--      a DB-level check, any logged-in user could bypass the
--      `role !== 'admin'` guard in settings-actions.ts with a raw PostgREST
--      call carrying their own valid JWT and self-promote to admin.
--   3) A BEFORE UPDATE trigger blocks any change to the `role` column unless
--      the caller is currently an admin (checked via the existing
--      _billing_current_role() security-definer helper from
--      202604240001_billing_rpcs.sql). This is what actually keeps role
--      changes admin-gated at the database level - the RLS policy alone
--      can't distinguish "update my own name" from "update my own role"
--      since both target the same row.
--   4) Anon's grants (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
--      TRIGGER) are revoked outright. Nothing legitimate needs them: the
--      signup flow's handle_auth_user_created/updated triggers run
--      `security definer` and write to profiles regardless of the calling
--      role's grants (same reasoning 202608180003_revoke_anon_execute_on_rpcs.sql
--      documented for trigger execution), and every other read/write in the
--      app goes through an authenticated Supabase session.
--
-- Safe to re-run: policies/trigger are dropped before re-creation.

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- SELECT - broad, matches this codebase's convention for reference-ish data
-- that many pages need to join across users they don't own.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- INSERT - only the signup fallback in settings-actions.ts's
-- ensureCurrentUserProfile, always for the caller's own id.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- UPDATE - caller's own row, or any row if the caller is currently an admin
-- (mirrors updateUserRole/updateUserFullName's app-level admin check).
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public._billing_current_role() = 'admin')
  with check (id = auth.uid() or public._billing_current_role() = 'admin');

-- No DELETE policy: nothing in the app deletes profile rows directly - the
-- `on delete cascade` FK from auth.users handles account deletion, which runs
-- through the Admin API's service_role (bypasses RLS entirely).

-- ---------------------------------------------------------------------------
-- Role-change guard: the RLS policy above can't tell "update my own name"
-- from "update my own role" apart since they're the same row - a trigger can.
-- ---------------------------------------------------------------------------
create or replace function public._profiles_guard_role_change()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role and public._billing_current_role() <> 'admin' then
    raise exception 'Only admin can change user role' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role_change on public.profiles;
create trigger profiles_guard_role_change
before update on public.profiles
for each row execute function public._profiles_guard_role_change();

-- ---------------------------------------------------------------------------
-- Revoke anon's table-level grants entirely.
-- ---------------------------------------------------------------------------
revoke all on public.profiles from anon;
