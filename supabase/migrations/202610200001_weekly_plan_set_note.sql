-- Lets any admin/pm/foreman write the note on a weekly plan row, the way
-- weekly_plan_set_status and weekly_plan_record_actual already work (security
-- definer, touches ONE column). The weekly screen stores the reason a promise
-- was missed ("✗ ของไม่มา") in the note; without this a foreman can only set a
-- note on rows they created. The app falls back to a plain update until this
-- is applied. The note is not a planning field, so an agreed week stays
-- editable (weekly_plan_enforce_lock ignores it).

create or replace function public.weekly_plan_set_note(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._billing_current_role() not in ('admin','pm','foreman') then
    raise exception 'ไม่มีสิทธิ์';
  end if;
  update public.weekly_plan_items set note = nullif(btrim(p_note), '') where id = p_id;
end;
$$;

revoke all on function public.weekly_plan_set_note(uuid, text) from public, anon;
grant execute on function public.weekly_plan_set_note(uuid, text) to authenticated;
