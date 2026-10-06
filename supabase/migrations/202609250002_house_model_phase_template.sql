-- House-model duration template (June, 2026-09-25): duration in days per
-- contractor_type (trade/phase) per house model, plus a sequence_order for
-- chaining. A plot's plot_phase_schedule auto-generates from its house
-- model's template on "ดึง BOQ" (see generatePlotPhaseScheduleFromTemplate in
-- actions/plot-phase-schedule.ts) instead of PMs hand-entering two dates per
-- trade per plot.
create table public.house_model_phase_template (
  id uuid primary key default gen_random_uuid(),
  house_model_id uuid not null references public.house_models(id) on delete cascade,
  contractor_type_id int not null references public.contractor_types(id),
  sequence_order int not null,
  duration_days int not null check (duration_days > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (house_model_id, contractor_type_id)
);

alter table public.house_model_phase_template enable row level security;

-- Same as boq_master/house_models (BOQ-setup domain, not cost/billing): read
-- and write both admin/pm/foreman, no accountant/sales.
create policy house_model_phase_template_select on public.house_model_phase_template for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']));
create policy house_model_phase_template_write on public.house_model_phase_template for all to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']))
  with check (_billing_current_role() = any (array['admin','pm','foreman']));
