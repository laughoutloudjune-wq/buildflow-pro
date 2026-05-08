-- Fix: ensure billing_jobs supports upsert by (billing_id, job_assignment_id).
--
-- The RPC `billing_approve` uses:
--   ON CONFLICT (billing_id, job_assignment_id) DO UPDATE ...
-- which requires a UNIQUE constraint or UNIQUE index matching those columns.
--
-- Some environments had `billing_jobs` created without that uniqueness, causing:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- This migration deduplicates any existing duplicates and then adds a unique index.
-- Safe to run multiple times.

-- 1) Deduplicate existing rows so the unique index can be created.
-- Keep the row with the highest amount; if tied, keep an arbitrary stable row.
with ranked as (
  select
    ctid,
    row_number() over (
      partition by billing_id, job_assignment_id
      order by coalesce(amount, 0) desc, ctid
    ) as rn
  from public.billing_jobs
)
delete from public.billing_jobs bj
using ranked r
where bj.ctid = r.ctid
  and r.rn > 1;

-- 2) Add unique index to satisfy ON CONFLICT.
create unique index if not exists billing_jobs_billing_id_job_assignment_id_uniq
  on public.billing_jobs (billing_id, job_assignment_id);

