-- Supabase grants full table privileges to anon by default on any new
-- table (same as every table listed in Phase 1's original revoke
-- migration) - RLS policies scoped "to authenticated" already block anon
-- regardless, but this matches the same defense-in-depth revoke every
-- other core table already got.
revoke all on table public.promotions from anon;
