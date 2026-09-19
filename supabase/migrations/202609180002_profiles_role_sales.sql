-- Sales module, Phase 1 (SALES_MODULE_PLAN.md §6/Phase 1).
--
-- Allows profiles.role = 'sales'. 'accountant' is already in this constraint
-- (added earlier, ahead of any app code that recognises it) - this migration
-- only adds the one new value.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['admin', 'pm', 'foreman', 'accountant', 'sales']));
