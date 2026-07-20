-- Restructures grouped material logging around explicit plot groups.
--
-- Previous design: logging a purchase across N plots inserted N duplicated
-- rows sharing a group_id. That stored the *view* instead of the *fact* -
-- each plot's variance showed the full purchase total against a single
-- plot's budget (phantom overspending), and every rollup needed dedup logic.
--
-- New design: a purchase is stored ONCE. Its scope is either one plot's job
-- (plot_group_id null) or a whole plot group (plot_group_id set). Groups are
-- defined by the team in plot management (e.g. "98-102" - a batch of plots
-- built together), not re-picked per purchase. Per-plot numbers are derived
-- at query time (group total / member count, labeled as averaged), never
-- stored.

-- ===========================================================================
-- plot_groups + members
-- ===========================================================================
create table if not exists public.plot_groups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.plot_group_members (
  group_id uuid not null references public.plot_groups(id) on delete cascade,
  plot_id uuid not null references public.plots(id) on delete cascade,
  primary key (group_id, plot_id)
);

-- A plot belongs to at most one group.
create unique index if not exists plot_group_members_plot_unique
  on public.plot_group_members(plot_id);

-- Same RLS model as the rest of the schema: enforcement lives in the
-- TypeScript action layer, RLS stays permissive for consistency.
alter table public.plot_groups enable row level security;
drop policy if exists "Allow all access" on public.plot_groups;
create policy "Allow all access" on public.plot_groups
  for all to public using (true) with check (true);

alter table public.plot_group_members enable row level security;
drop policy if exists "Allow all access" on public.plot_group_members;
create policy "Allow all access" on public.plot_group_members
  for all to public using (true) with check (true);

-- ===========================================================================
-- material_usage_log: scope column
-- ===========================================================================
alter table public.material_usage_log
  add column if not exists plot_group_id uuid references public.plot_groups(id) on delete set null;

create index if not exists material_usage_log_plot_group_id_idx
  on public.material_usage_log(plot_group_id);

-- ===========================================================================
-- Migrate legacy duplicated rows (old group_id design)
-- ===========================================================================
-- For each legacy cluster: create a plot group spanning the plots the rows
-- covered, keep the earliest row as the single purchase (the old design
-- stored the FULL quantity on every duplicate, so one surviving row already
-- carries the correct total), link it to the group, delete the duplicates.
do $$
declare
  legacy record;
  v_group_id uuid;
  v_project_id uuid;
  v_name text;
  v_anchor uuid;
begin
  for legacy in (
    select distinct group_id from public.material_usage_log where group_id is not null
  ) loop
    select p.project_id into v_project_id
    from public.material_usage_log mul
    join public.job_assignments ja on ja.id = mul.job_assignment_id
    join public.plots p on p.id = ja.plot_id
    where mul.group_id = legacy.group_id
    limit 1;

    select string_agg(distinct p.name, ', ' order by p.name) into v_name
    from public.material_usage_log mul
    join public.job_assignments ja on ja.id = mul.job_assignment_id
    join public.plots p on p.id = ja.plot_id
    where mul.group_id = legacy.group_id;

    insert into public.plot_groups (project_id, name)
    values (v_project_id, 'กลุ่มแปลง ' || coalesce(v_name, '?'))
    returning id into v_group_id;

    insert into public.plot_group_members (group_id, plot_id)
    select distinct v_group_id, ja.plot_id
    from public.material_usage_log mul
    join public.job_assignments ja on ja.id = mul.job_assignment_id
    where mul.group_id = legacy.group_id
    on conflict do nothing;

    select id into v_anchor
    from public.material_usage_log
    where group_id = legacy.group_id
    order by created_at, id
    limit 1;

    update public.material_usage_log set plot_group_id = v_group_id where id = v_anchor;
    delete from public.material_usage_log where group_id = legacy.group_id and id <> v_anchor;
  end loop;
end $$;

-- The legacy column is fully superseded by plot_group_id.
drop index if exists public.material_usage_log_group_id_idx;
alter table public.material_usage_log drop column if exists group_id;
