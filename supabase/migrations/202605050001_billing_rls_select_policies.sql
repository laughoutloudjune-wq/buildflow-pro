-- Phase 2.5: add SELECT RLS policies for billing tables.
--
-- All billing writes go through `security definer` RPCs (migration
-- 202604240001_billing_rpcs.sql) which bypass RLS. But the plain Supabase
-- client queries used by the report/list pages run as the authenticated user
-- and ARE subject to RLS.
--
-- Without explicit SELECT policies, a table with RLS enabled returns zero rows
-- to every query — which is why newly-created billings never appear in the
-- foreman history or PM billing list despite being successfully inserted by
-- the RPC.
--
-- Policy rules:
--   billings        – foreman sees rows they created/submitted; PM/admin see all
--   billing_jobs    – visible when the parent billing is visible
--   billing_adjustments – visible when the parent billing is visible
--
-- Safe to re-run: policies are dropped before re-creation.

-- ---------------------------------------------------------------------------
-- billings
-- ---------------------------------------------------------------------------
alter table public.billings enable row level security;

drop policy if exists "billings_select" on public.billings;
create policy "billings_select" on public.billings
  for select to authenticated
  using (
    created_by = auth.uid()
    or submitted_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('pm', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- billing_jobs
-- ---------------------------------------------------------------------------
alter table public.billing_jobs enable row level security;

drop policy if exists "billing_jobs_select" on public.billing_jobs;
create policy "billing_jobs_select" on public.billing_jobs
  for select to authenticated
  using (
    exists (
      select 1 from public.billings b
      where b.id = billing_jobs.billing_id
        and (
          b.created_by = auth.uid()
          or b.submitted_by = auth.uid()
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role in ('pm', 'admin')
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- billing_adjustments
-- ---------------------------------------------------------------------------
alter table public.billing_adjustments enable row level security;

drop policy if exists "billing_adjustments_select" on public.billing_adjustments;
create policy "billing_adjustments_select" on public.billing_adjustments
  for select to authenticated
  using (
    exists (
      select 1 from public.billings b
      where b.id = billing_adjustments.billing_id
        and (
          b.created_by = auth.uid()
          or b.submitted_by = auth.uid()
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role in ('pm', 'admin')
          )
        )
    )
  );
