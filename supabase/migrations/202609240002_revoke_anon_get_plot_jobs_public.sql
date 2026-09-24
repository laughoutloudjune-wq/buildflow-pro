-- Supabase grants EXECUTE on new functions to anon directly (not via
-- `public`), so the earlier "revoke all ... from public" in
-- 202609240001 didn't actually remove anon's access. This function
-- reveals no money, but it should still only be reachable by a logged-in
-- session, matching every other table/RPC in this app after Phase 1.
revoke execute on function public.get_plot_jobs_public(uuid) from anon;
