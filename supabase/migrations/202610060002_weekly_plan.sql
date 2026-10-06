-- Weekly plan (WORKFLOW_PLAN.md step 3): per project, per week (week_start =
-- Monday), plan items of kind main / dc / other / inspect, plus a "meeting
-- agreed" marker per project-week.
--
-- Who can do what (June, 2026-10-06):
--   admin, pm : create / edit / delete any item, mark a week agreed
--   foreman   : create items, tick ANY item done/planned (via RPC), edit or
--               delete only items they created themselves
--   sales, sales_exec, accountant : nothing

create table public.weekly_plan_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  plot_id uuid references public.plots(id) on delete set null,
  week_start date not null,
  kind text not null check (kind in ('main','dc','other','inspect')),
  title text not null,
  owner_id uuid references public.profiles(id) on delete set null,
  status text not null default 'planned' check (status in ('planned','done')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index weekly_plan_items_week_idx on public.weekly_plan_items(week_start, project_id);

create table public.weekly_plan_meetings (
  project_id uuid not null references public.projects(id) on delete cascade,
  week_start date not null,
  agreed_by uuid references public.profiles(id),
  agreed_at timestamptz not null default now(),
  primary key (project_id, week_start)
);

alter table public.weekly_plan_items enable row level security;
alter table public.weekly_plan_meetings enable row level security;

create policy weekly_plan_items_select on public.weekly_plan_items for select to authenticated
  using (public._billing_current_role() = any (array['admin','pm','foreman']));

create policy weekly_plan_items_insert on public.weekly_plan_items for insert to authenticated
  with check (
    public._billing_current_role() = any (array['admin','pm','foreman'])
    and created_by = auth.uid()
  );

create policy weekly_plan_items_update on public.weekly_plan_items for update to authenticated
  using (
    public._billing_current_role() = any (array['admin','pm'])
    or (public._billing_current_role() = 'foreman' and created_by = auth.uid())
  )
  with check (
    public._billing_current_role() = any (array['admin','pm'])
    or (public._billing_current_role() = 'foreman' and created_by = auth.uid())
  );

create policy weekly_plan_items_delete on public.weekly_plan_items for delete to authenticated
  using (
    public._billing_current_role() = any (array['admin','pm'])
    or (public._billing_current_role() = 'foreman' and created_by = auth.uid())
  );

create policy weekly_plan_meetings_select on public.weekly_plan_meetings for select to authenticated
  using (public._billing_current_role() = any (array['admin','pm','foreman']));

create policy weekly_plan_meetings_write on public.weekly_plan_meetings for all to authenticated
  using (public._billing_current_role() = any (array['admin','pm']))
  with check (public._billing_current_role() = any (array['admin','pm']));

grant select, insert, update, delete on public.weekly_plan_items to authenticated;
grant select, insert, update, delete on public.weekly_plan_meetings to authenticated;
revoke all on table public.weekly_plan_items from anon;
revoke all on table public.weekly_plan_meetings from anon;

-- Anyone on the construction side may tick an item done / back to planned,
-- not only the creator - changes the status column and nothing else.
create or replace function public.weekly_plan_set_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._billing_current_role() not in ('admin','pm','foreman') then
    raise exception 'ไม่มีสิทธิ์';
  end if;
  if p_status not in ('planned','done') then
    raise exception 'สถานะไม่ถูกต้อง';
  end if;
  update public.weekly_plan_items set status = p_status where id = p_id;
end;
$$;

revoke all on function public.weekly_plan_set_status(uuid, text) from public, anon;
grant execute on function public.weekly_plan_set_status(uuid, text) to authenticated;

-- Sales items that need construction attention: plots whose live deal is
-- awaiting inspection / awaiting transfer. plot_sales is not readable by
-- foreman through RLS, so this exposes only plot + status label (no money).
create or replace function public.weekly_plan_sales_plots()
returns table (
  plot_id uuid,
  plot_name text,
  project_id uuid,
  project_name text,
  status_code text,
  status_label text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public._billing_current_role() not in ('admin','pm','foreman') then
    return;
  end if;
  return query
    select p.id, p.name::text, p.project_id, pr.name::text, ps.status_code, st.label
    from public.plot_sales ps
    join public.plots p on p.id = ps.plot_id
    join public.projects pr on pr.id = p.project_id
    join public.sale_statuses st on st.code = ps.status_code
    where ps.cancelled_at is null
      and ps.status_code in ('awaiting_inspection','awaiting_transfer')
    order by pr.name, p.name;
end;
$$;

revoke all on function public.weekly_plan_sales_plots() from public, anon;
grant execute on function public.weekly_plan_sales_plots() to authenticated;
