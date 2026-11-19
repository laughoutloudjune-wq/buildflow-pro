-- Database write rules should follow the role-permission matrix saved in
-- Settings (organization_settings.role_permissions), the same matrix the app
-- uses to open pages. Before this, Settings let a foreman into Contractors
-- but RLS only allowed admin/pm, so saving failed with
-- "new row violates row-level security policy for table contractors".
-- The same gap existed for materials (material_types) and procurement
-- (supplier_branches, purchase_order_quotes).
-- admin and pm keep write access as before; any other role gets it when the
-- module is ticked for that role in Settings. No DROP/DELETE.
create or replace function public._role_has_module(p_module text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public._billing_current_role() in ('admin', 'pm')
    or coalesce(
      (select (os.role_permissions -> public._billing_current_role() ->> p_module)::boolean
         from public.organization_settings os limit 1),
      false);
$$;

grant execute on function public._role_has_module(text) to authenticated;

alter policy contractors_write on public.contractors
  using (public._role_has_module('contractors'))
  with check (public._role_has_module('contractors'));

alter policy material_types_write on public.material_types
  using (public._role_has_module('materials'))
  with check (public._role_has_module('materials'));

alter policy supplier_branches_write on public.supplier_branches
  using (public._role_has_module('procurement'))
  with check (public._role_has_module('procurement'));

alter policy purchase_order_quotes_all on public.purchase_order_quotes
  using (public._role_has_module('procurement'))
  with check (public._role_has_module('procurement'));
