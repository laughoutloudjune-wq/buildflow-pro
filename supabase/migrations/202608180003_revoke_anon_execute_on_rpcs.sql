-- Remove anonymous EXECUTE access from every SECURITY DEFINER function.
-- Clears Supabase advisor lint 0028 (anon_security_definer_function_executable).
--
-- Two separate grants have to go, not one. Inspecting pg_proc.proacl shows
-- each function carries BOTH:
--     =X/postgres        -> the PUBLIC grant Postgres adds on CREATE FUNCTION
--     anon=X/postgres    -> an explicit grant from Supabase's default privileges
-- so revoking from PUBLIC alone would leave the explicit anon grant in place
-- and the lint would not clear.
--
-- Safety checks done before writing this (all clear):
--   * No RLS policy calls any of these functions, so revoking cannot turn a
--     silent "no rows" into a hard permission error for anonymous visitors.
--   * handle_auth_user_created/updated are triggers on auth.users. Trigger
--     execution does not consult the calling role's EXECUTE privilege, so
--     signup keeps working with no grants at all.
--   * _billing_current_role is called directly from app code in four places
--     (lib/auth/route-access.ts, actions/auth-actions.ts x2,
--     actions/_shared/user-role.ts) - every call site returns early when
--     there is no authenticated user, so anon never reaches the RPC. It
--     keeps its `authenticated` grant below.
--
-- These functions already reject unauthorized callers internally, so this is
-- defense in depth: it moves the rejection from application logic down to the
-- database's own privilege system.

-- ---------------------------------------------------------------------------
-- Client-callable RPCs: revoke PUBLIC + anon, keep authenticated.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
  fns text[] := array[
    '_billing_current_role()',
    'billing_approve(p_id uuid, p_payload jsonb)',
    'billing_create_request(p_payload jsonb)',
    'billing_delete(p_id uuid)',
    'billing_reject(p_id uuid, p_note text)',
    'billing_undo_approve(p_id uuid)',
    'billing_update_request(p_id uuid, p_payload jsonb)',
    'goods_receipt_create(p_payload jsonb)',
    'po_cancel(p_id uuid, p_reason text)',
    'po_create(p_payload jsonb)',
    'po_mark_paid(p_ids uuid[], p_paid_at date)',
    'po_mark_received(p_id uuid, p_received_at date)',
    'po_send(p_id uuid)',
    'po_set_status(p_id uuid, p_status text)',
    'po_unmark_paid(p_id uuid)',
    'po_unmark_received(p_id uuid)',
    'po_update(p_id uuid, p_payload jsonb)',
    'pr_approve(p_id uuid)',
    'pr_create(p_payload jsonb)',
    'pr_reject(p_id uuid, p_note text)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Trigger functions: nothing calls these directly, so they need no role
-- grants at all. The trigger on auth.users invokes them regardless.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
  fns text[] := array[
    'handle_auth_user_created()',
    'handle_auth_user_updated()'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon', fn);
    execute format('revoke all on function public.%s from authenticated', fn);
  end loop;
end
$$;
