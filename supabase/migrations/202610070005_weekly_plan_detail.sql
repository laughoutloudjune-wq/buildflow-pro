-- Weekly plan detail, following the site's Excel weekly report: contractor,
-- carried-over % from last week, PLAN and ACTUAL % per day (Mon..Sun), a note,
-- and a "repair" work kind (งานซ่อม). All additive; existing rows keep working.
alter table public.weekly_plan_items
  add column if not exists contractor_id uuid references public.contractors(id) on delete set null,
  add column if not exists carry_pct numeric,
  add column if not exists plan_pct numeric[],
  add column if not exists actual_pct numeric[],
  add column if not exists note text;

alter table public.weekly_plan_items drop constraint if exists weekly_plan_items_kind_check;
alter table public.weekly_plan_items add constraint weekly_plan_items_kind_check
  check (kind in ('main','dc','other','inspect','repair'));

create index if not exists weekly_plan_items_contractor_idx on public.weekly_plan_items(contractor_id);
