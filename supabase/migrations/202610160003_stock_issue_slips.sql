-- Withdrawal slips + plot rule (MATERIAL_TRAIL_PLAN.md - "store stock to plot
-- must be comparable to BOQ").
--
-- 1. Slip numbers. A withdrawal (stock_request_create) posts one 'out' row
--    per material, all sharing source_id = the batch id - but the batch had
--    no number anyone could quote. Every row of a batch now carries the same
--    issue_no, IS-YYYYMMDDNNN like RI/PO numbers, stamped by a trigger, so the
--    RPC needs no change and every list that reads stock_movements shows it.
--    Old batches are numbered by the date they were recorded.
--
-- 2. Plot rule. 734 of 1,313 withdrawals named only a project, so the BOQ
--    comparison (boq_control_rollup), which can only count plot- or
--    batch-tagged rows, silently skipped them. A withdrawal for a project
--    that has plots must now name a plot or a plot group. Projects with no
--    plots (single-building jobs) are unaffected.

alter table public.stock_movements add column if not exists issue_no text;

create index if not exists stock_movements_source_id_idx on public.stock_movements (source_id);
create index if not exists stock_movements_issue_no_idx on public.stock_movements (issue_no) where issue_no is not null;

create table if not exists public.stock_issue_number_counters (
  issue_date date primary key,
  counter integer not null
);
alter table public.stock_issue_number_counters enable row level security;
revoke all on table public.stock_issue_number_counters from anon, authenticated;

-- Backfill: number old batches in the order they were recorded, per Bangkok date.
-- The history trigger (202610160001) would log every one of these rows as an
-- edit - this is not one, so it is paused for the backfill.
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'stock_movements_doc_event') then
    execute 'alter table public.stock_movements disable trigger stock_movements_doc_event';
  end if;
end;
$$;

with batches as (
  select source_id, min(created_at) as first_at
  from public.stock_movements
  where source_type = 'manual_request' and source_id is not null and issue_no is null
  group by source_id
),
numbered as (
  select
    source_id,
    (first_at at time zone 'Asia/Bangkok')::date as issue_date,
    row_number() over (partition by (first_at at time zone 'Asia/Bangkok')::date order by first_at, source_id) as seq
  from batches
)
update public.stock_movements sm
set issue_no = 'IS-' || to_char(n.issue_date, 'YYYYMMDD') || lpad(n.seq::text, 3, '0')
from numbered n
where sm.source_id = n.source_id and sm.source_type = 'manual_request';

do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'stock_movements_doc_event') then
    execute 'alter table public.stock_movements enable trigger stock_movements_doc_event';
  end if;
end;
$$;

insert into public.stock_issue_number_counters (issue_date, counter)
select to_date(substring(issue_no from 4 for 8), 'YYYYMMDD'), max(substring(issue_no from 12)::int)
from public.stock_movements
where issue_no is not null
group by 1
on conflict (issue_date) do update set counter = greatest(stock_issue_number_counters.counter, excluded.counter);

create or replace function public._stock_issue_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
  v_seq integer;
begin
  if new.type <> 'out' or new.source_type <> 'manual_request' then
    return new;
  end if;

  -- Plot rule: only for a project that has plots to choose from.
  if new.plot_id is null and new.plot_group_id is null
     and exists (select 1 from public.plots where project_id = new.project_id) then
    raise exception 'Choose a plot or plot group for this withdrawal' using errcode = '22023';
  end if;

  -- Same batch -> same slip number.
  if new.source_id is not null then
    select issue_no into new.issue_no
    from public.stock_movements
    where source_id = new.source_id and source_type = 'manual_request' and issue_no is not null
    limit 1;
  end if;

  if new.issue_no is null then
    v_date := (coalesce(new.created_at, now()) at time zone 'Asia/Bangkok')::date;
    insert into public.stock_issue_number_counters (issue_date, counter)
    values (v_date, 1)
    on conflict (issue_date) do update set counter = stock_issue_number_counters.counter + 1
    returning counter into v_seq;
    new.issue_no := 'IS-' || to_char(v_date, 'YYYYMMDD') || lpad(v_seq::text, 3, '0');
  end if;

  return new;
end;
$$;

revoke all on function public._stock_issue_before_insert() from public, anon, authenticated;

drop trigger if exists stock_movements_issue_no on public.stock_movements;
create trigger stock_movements_issue_no
  before insert on public.stock_movements
  for each row execute function public._stock_issue_before_insert();
