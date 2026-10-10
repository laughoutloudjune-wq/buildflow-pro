-- Weekly plan Phase 1 (WEEKLY_MONTHLY_PLAN_IMPLEMENTATION.md): link plan items
-- to a plot's BOQ job and lock a week's plan once the meeting has agreed it.
-- Additive: existing rows keep working; null job_assignment_id = manual
-- (non-BOQ) work.
--
-- Decisions (2026-10-07): one row per job per week (job can span weeks);
-- percentages are cumulative; agreement locks the plan until reopened.

alter table public.weekly_plan_items
  add column if not exists job_assignment_id uuid
    references public.job_assignments(id) on delete set null;

-- A job may be scheduled once per week; manual rows are unconstrained.
create unique index if not exists weekly_plan_items_job_week_uniq
  on public.weekly_plan_items(job_assignment_id, week_start)
  where job_assignment_id is not null;

create index if not exists weekly_plan_items_job_idx
  on public.weekly_plan_items(job_assignment_id);

-- Validate the BOQ link and derive the title from the database. Never trust a
-- client-supplied title for a BOQ row. job_assignments.project_id is empty in
-- the live data, so the project is checked through plots.
create or replace function public.weekly_plan_validate_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plot uuid;
  v_project uuid;
  v_title text;
begin
  if new.job_assignment_id is null then
    return new;
  end if;

  if new.plot_id is null then
    raise exception 'งาน BOQ ต้องระบุแปลง';
  end if;

  select ja.plot_id, p.project_id, b.item_name
    into v_plot, v_project, v_title
  from public.job_assignments ja
  join public.plots p on p.id = ja.plot_id
  join public.boq_master b on b.id = ja.boq_item_id
  where ja.id = new.job_assignment_id;

  if v_plot is null then
    raise exception 'ไม่พบงาน BOQ ที่เลือก';
  end if;
  if v_plot is distinct from new.plot_id then
    raise exception 'งาน BOQ นี้ไม่ใช่ของแปลงที่เลือก';
  end if;
  if v_project is distinct from new.project_id then
    raise exception 'งาน BOQ นี้ไม่ใช่ของโครงการที่เลือก';
  end if;

  new.title := v_title;
  return new;
end;
$$;

drop trigger if exists weekly_plan_validate_job on public.weekly_plan_items;
create trigger weekly_plan_validate_job
  before insert or update on public.weekly_plan_items
  for each row execute function public.weekly_plan_validate_job();

-- Once a project-week is agreed in the meeting (weekly_plan_meetings row), the
-- planned rows are locked: no adding, deleting, moving or re-planning. Progress
-- fields (actual %, carry, note, done/planned) stay editable. Reopening = removing
-- the agreement row (existing "unmark agreed" action).
-- Nested trigger depth > 1 means a foreign-key cascade (plot/job/project
-- deleted), which must not be blocked.
create or replace function public.weekly_plan_enforce_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked boolean;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    select exists (select 1 from public.weekly_plan_meetings m
                   where m.project_id = new.project_id and m.week_start = new.week_start)
      into v_locked;
    if v_locked then
      raise exception 'แผนสัปดาห์นี้ถูกยืนยันแล้ว ต้องเปิดแก้ไขก่อนเพิ่มงาน';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    select exists (select 1 from public.weekly_plan_meetings m
                   where m.project_id = old.project_id and m.week_start = old.week_start)
      into v_locked;
    if v_locked then
      raise exception 'แผนสัปดาห์นี้ถูกยืนยันแล้ว ต้องเปิดแก้ไขก่อนลบงาน';
    end if;
    return old;
  end if;

  -- UPDATE: only matters if a planning field changed.
  if (new.project_id, new.plot_id, new.week_start, new.kind, new.title,
      new.owner_id, new.contractor_id, new.plan_pct, new.job_assignment_id)
     is not distinct from
     (old.project_id, old.plot_id, old.week_start, old.kind, old.title,
      old.owner_id, old.contractor_id, old.plan_pct, old.job_assignment_id) then
    return new;
  end if;

  select exists (select 1 from public.weekly_plan_meetings m
                 where (m.project_id = old.project_id and m.week_start = old.week_start)
                    or (m.project_id = new.project_id and m.week_start = new.week_start))
    into v_locked;
  if v_locked then
    raise exception 'แผนสัปดาห์นี้ถูกยืนยันแล้ว ต้องเปิดแก้ไขก่อนแก้แผน';
  end if;
  return new;
end;
$$;

drop trigger if exists weekly_plan_enforce_lock on public.weekly_plan_items;
create trigger weekly_plan_enforce_lock
  before insert or update or delete on public.weekly_plan_items
  for each row execute function public.weekly_plan_enforce_lock();

revoke all on function public.weekly_plan_validate_job() from public, anon, authenticated;
revoke all on function public.weekly_plan_enforce_lock() from public, anon, authenticated;
