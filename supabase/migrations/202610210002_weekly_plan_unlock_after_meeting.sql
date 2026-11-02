-- Weekly plan: agreeing the plan in the meeting no longer locks it.
-- After "ประชุมตกลงแผนแล้ว" the PM and foremen can still add work, remove work
-- and change crews (June, 2026-10-21); the app tags anything created after the
-- agreed time (weekly_plan_meetings.agreed_at vs weekly_plan_items.created_at),
-- so no new column is needed.
--
-- The trigger stays attached; only the function body changes, so this has no
-- DROP. It becomes a pass-through. Reopening a week (removing the agreement
-- row) keeps working as before.
create or replace function public.weekly_plan_enforce_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce(new, old);
end;
$$;

revoke all on function public.weekly_plan_enforce_lock() from public, anon, authenticated;
