-- Contractor writes should follow the role-permission matrix saved in
-- Settings (organization_settings.role_permissions), the same matrix the app
-- uses to open the page. Before this, the page let a foreman in (June ticked
-- "contractors" for foreman) but RLS only allowed admin/pm, so saving failed
-- with "new row violates row-level security policy for table contractors".
create or replace function public._can_manage_contractors()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select (os.role_permissions -> public._billing_current_role() ->> 'contractors')::boolean
       from public.organization_settings os limit 1),
    false
  ) or public._billing_current_role() in ('admin', 'pm');
$$;

grant execute on function public._can_manage_contractors() to authenticated;

alter policy contractors_write on public.contractors
  using (public._can_manage_contractors())
  with check (public._can_manage_contractors());
