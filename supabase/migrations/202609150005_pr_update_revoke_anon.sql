-- pr_update (added in 202609090002_pr_update.sql, after
-- 202608180003_revoke_anon_execute_on_rpcs.sql's one-time batch revoke) was
-- never added to that revoke list, so it has carried anon EXECUTE ever
-- since - the Supabase advisor's anon_security_definer_function_executable
-- lint still flags it. Spotted while restating this function for
-- 202609150004_pr_item_boq_job.sql; fixed here since it's a one-line,
-- zero-risk addition (the function already rejects a caller with no
-- auth.uid() internally, so this only removes an unnecessary grant, not
-- any working path).
--
-- 4 other pre-existing RPCs have the same gap (payment_voucher_create,
-- payment_voucher_void, pr_item_settle, pr_item_settle_undo) - left alone
-- here since this session didn't otherwise touch them; flagged separately
-- as a follow-up task.
revoke all on function public.pr_update(uuid, jsonb) from public;
revoke all on function public.pr_update(uuid, jsonb) from anon;
