-- Handover plan Phase 6.1 (C-01 step 2): replace the leftover "Allow all
-- access" policies from Phase 1 with per-action rules for `authenticated`,
-- mirroring what the app layer already enforces via requireModuleAccess (see
-- HANDOVER_PLAN.md Phase 6.1). RLS becomes the real security floor instead
-- of a formality - previously any authenticated JWT (any role, including
-- sales) could read or write these tables directly via the REST API
-- regardless of the caller's app-level role.
--
-- Rollback: recreate each dropped policy as
--   create policy "Allow all access" on public.<table> for all to public using (true);

-- Group: projects/plots (requireModuleAccess('projects') = admin, pm, foreman
-- write; read also includes sales, which reaches plot data through its own
-- 'sales' module path - see actions/plot-detail-bundle.ts).
drop policy "Allow all access" on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','sales']));
create policy projects_write on public.projects for all to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']))
  with check (_billing_current_role() = any (array['admin','pm','foreman']));

drop policy "Allow all access" on public.plots;
create policy plots_select on public.plots for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','sales']));
create policy plots_write on public.plots for all to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']))
  with check (_billing_current_role() = any (array['admin','pm','foreman']));

drop policy "Allow all access" on public.plot_groups;
create policy plot_groups_select on public.plot_groups for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','sales']));
create policy plot_groups_write on public.plot_groups for all to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']))
  with check (_billing_current_role() = any (array['admin','pm','foreman']));

drop policy "Allow all access" on public.plot_group_members;
create policy plot_group_members_select on public.plot_group_members for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','sales']));
create policy plot_group_members_write on public.plot_group_members for all to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']))
  with check (_billing_current_role() = any (array['admin','pm','foreman']));

-- Group: BOQ (requireModuleAccess('boq') = admin, pm, foreman for both read
-- and write; sales has no 'boq' module and never reads these tables
-- directly - its plot-detail job list comes from get_plot_jobs_public()
-- below, which is SECURITY DEFINER and returns no price).
drop policy "Allow all access" on public.boq_master;
create policy boq_master_select on public.boq_master for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']));
create policy boq_master_write on public.boq_master for all to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']))
  with check (_billing_current_role() = any (array['admin','pm','foreman']));

drop policy "Allow all access" on public.boq_material_items;
create policy boq_material_items_select on public.boq_material_items for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']));
create policy boq_material_items_write on public.boq_material_items for all to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']))
  with check (_billing_current_role() = any (array['admin','pm','foreman']));

drop policy "Allow all access" on public.house_models;
create policy house_models_select on public.house_models for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']));
create policy house_models_write on public.house_models for all to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']))
  with check (_billing_current_role() = any (array['admin','pm','foreman']));

-- Group: contractors (no cost columns on these two tables themselves - the
-- money lives in billings/payments, gated in the next migration - so read
-- stays open to every real role, including accountant (needs names for the
-- contractor-cycle report) and sales (construction tab's read-only
-- contractor list, phone/name only, D2 - Q-08)).
drop policy "Allow all access" on public.contractors;
create policy contractors_select on public.contractors for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','accountant','sales']));
create policy contractors_write on public.contractors for all to authenticated
  using (_billing_current_role() = any (array['admin','pm']))
  with check (_billing_current_role() = any (array['admin','pm']));

drop policy "Allow all access" on public.contractor_types;
create policy contractor_types_select on public.contractor_types for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','accountant','sales']));
create policy contractor_types_write on public.contractor_types for all to authenticated
  using (_billing_current_role() = 'admin')
  with check (_billing_current_role() = 'admin');

-- Group: job_assignments (carries agreed_price_per_unit, a real cost column
-- - sales must not read this table at all. Its plot-detail construction tab
-- uses the new get_plot_jobs_public() instead, which never returns price).
drop policy "Allow all access" on public.job_assignments;
create policy job_assignments_select on public.job_assignments for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','accountant']));
create policy job_assignments_write on public.job_assignments for all to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']))
  with check (_billing_current_role() = any (array['admin','pm','foreman']));

-- Group: payments (contractor payment ledger - sales has no legitimate read
-- here at all; nothing in the app writes this table directly today, only
-- the billing_* SECURITY DEFINER functions, owned by postgres and so
-- bypassing RLS regardless of this policy).
drop policy "Allow all access" on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','accountant']));

-- Group: materials (requireAuthRole(['admin','pm']) for catalog writes;
-- requireModuleAccess('materials') = admin/pm/foreman for read/stock use).
drop policy "Allow all access" on public.material_types;
create policy material_types_select on public.material_types for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman']));
create policy material_types_write on public.material_types for all to authenticated
  using (_billing_current_role() = any (array['admin','pm']))
  with check (_billing_current_role() = any (array['admin','pm']));

-- New: SECURITY DEFINER function serving the plot-detail construction tab's
-- job list to viewers who must never see price (sales, D2/Q-08) - returns
-- exactly the columns PlotJobRow needs when cost is null, nothing else, so
-- a direct API call can no longer pull agreed_price_per_unit for a plot
-- through the job list the way the old open job_assignments policy allowed.
create or replace function public.get_plot_jobs_public(p_plot_id uuid)
returns table (
  id uuid,
  status text,
  contractor_id uuid,
  quantity numeric,
  item_name text,
  unit text
)
language sql
stable
security definer
set search_path = 'public'
as $$
  select ja.id, ja.status, ja.contractor_id, bm.quantity, bm.item_name, bm.unit
  from public.job_assignments ja
  left join public.boq_master bm on bm.id = ja.boq_item_id
  where ja.plot_id = p_plot_id
  order by ja.created_at asc;
$$;

revoke all on function public.get_plot_jobs_public(uuid) from public;
grant execute on function public.get_plot_jobs_public(uuid) to authenticated;
