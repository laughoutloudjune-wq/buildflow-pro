-- Phase 2.1: link `payments` rows to the `billings` they came from.
--
-- Previously, approve/undo/delete flows matched payments by a free-text `note`
-- string ("เบิกตามใบขอเบิก #<doc_no>"). That was fragile: an edited note or a
-- duplicate doc_no could silently wipe the wrong rows, or leave orphans in
-- place. This migration adds a proper foreign key and backfills existing rows.
--
-- Safe to run multiple times.

-- 1) Add the column + index + FK. All idempotent.
alter table public.payments
  add column if not exists billing_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_billing_id_fkey'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_billing_id_fkey
      foreign key (billing_id) references public.billings(id) on delete set null;
  end if;
end $$;

create index if not exists payments_billing_id_idx
  on public.payments (billing_id);

-- 2) Backfill existing rows.
--
-- Strategy: match by the legacy human-readable note "...#<doc_no>" — both the
-- correctly-encoded Thai prefix and the legacy mojibake prefix that older
-- builds wrote. We only touch rows where `billing_id` is still null.
with resolved as (
  select
    p.id as payment_id,
    b.id as billing_id
  from public.payments p
  join public.billings b
    on b.doc_no is not null
   and (
        p.note = 'เบิกตามใบขอเบิก #' || b.doc_no::text
     or p.note = 'เน€เธเธดเธเธ•เธฒเธกเนเธเธงเธฒเธเธเธดเธฅ #' || b.doc_no::text
   )
  where p.billing_id is null
)
update public.payments p
set billing_id = r.billing_id
from resolved r
where p.id = r.payment_id;

-- 3) Secondary backfill: any remaining rows whose linked `job_assignments`
-- point back to a single, obvious billing via `billing_jobs`. This catches
-- rows whose notes were manually edited or have a doc_no mismatch.
--
-- `billing_jobs` has no `created_at` column, so we tiebreak on `billing_id`
-- purely for determinism when a payment's job+amount matches multiple bills.
with candidates as (
  select
    p.id as payment_id,
    bj.billing_id as billing_id,
    row_number() over (partition by p.id order by bj.billing_id) as rn
  from public.payments p
  join public.billing_jobs bj on bj.job_assignment_id = p.job_assignment_id
  where p.billing_id is null
    and abs(coalesce(p.amount, 0) - coalesce(bj.amount, 0)) < 0.01
)
update public.payments p
set billing_id = c.billing_id
from candidates c
where p.id = c.payment_id
  and c.rn = 1;
