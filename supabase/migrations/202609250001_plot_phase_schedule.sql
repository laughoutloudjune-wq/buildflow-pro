-- Per-phase construction baseline (June, 2026-09-25): planned start/end date
-- per contractor_type (trade/category) per plot, so the progress curve's
-- planned line becomes a real piecewise schedule instead of one straight
-- ramp from job-start to plots.target_completion_date. See
-- actions/plot-progress-curve.ts for how this is consumed.
create table public.plot_phase_schedule (
  id uuid primary key default gen_random_uuid(),
  plot_id uuid not null references public.plots(id) on delete cascade,
  contractor_type_id int not null references public.contractor_types(id),
  planned_start_date date not null,
  planned_end_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plot_id, contractor_type_id)
);

alter table public.plot_phase_schedule enable row level security;

-- Same construction-only pattern as job_assignments (cost/schedule-adjacent -
-- sales never reads this): select admin/pm/foreman/accountant, write
-- admin/pm/foreman. See 202609240001_rls_projects_boq_contractors_materials.sql.
create policy plot_phase_schedule_select on public.plot_phase_schedule for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','accountant']));
create policy plot_phase_schedule_write on public.plot_phase_schedule for all to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']))
  with check (_billing_current_role() = any (array['admin','pm','foreman']));
