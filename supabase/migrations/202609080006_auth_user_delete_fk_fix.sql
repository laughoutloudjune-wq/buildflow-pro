-- Deleting an auth user (e.g. to re-invite after a typo'd email) currently
-- fails with a foreign key violation: profiles.id -> auth.users(id) has no
-- ON DELETE action, so Supabase's admin "delete user" 500s every time.
-- profiles is a 1:1 identity extension, so it should go with the user.
-- billings.paid_out_by is just a "who processed this" reference on a
-- financial record that must survive the user being removed, so it's
-- cleared instead of cascading.

alter table public.profiles
  drop constraint profiles_id_fkey,
  add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;

alter table public.billings
  drop constraint billings_paid_out_by_fkey,
  add constraint billings_paid_out_by_fkey foreign key (paid_out_by) references auth.users(id) on delete set null;
