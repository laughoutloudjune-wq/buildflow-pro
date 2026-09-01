-- _stock_movement_post has no auth/role checks of its own - it trusts its
-- caller completely, which is fine when the only caller is goods_receipt_create
-- (already role-gated), but the advisor flagged that `authenticated` could
-- call it directly via /rest/v1/rpc/_stock_movement_post and write arbitrary
-- stock movements. Supabase grants EXECUTE to authenticated by default on new
-- functions (same mechanism 202608180003_revoke_anon_execute_on_rpcs.sql
-- documented for anon) - revoking from public/anon alone in
-- 202608220001_stock_movements.sql wasn't enough. Lock it down the same way
-- the trigger functions at the bottom of 202608180003 are locked down: no
-- grants at all, callable only from within another security-definer
-- function's context (which runs as the owner, so no explicit grant is
-- needed for that internal call to succeed).

revoke all on function public._stock_movement_post(
  bigint, uuid, text, text, uuid, numeric, uuid, uuid, uuid, uuid, text
) from authenticated;
