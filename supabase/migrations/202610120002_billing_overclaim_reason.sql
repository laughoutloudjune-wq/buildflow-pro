-- Why a PM approved a billing that claims more progress than the site record
-- shows (weekly plan ACTUAL). Approval is never blocked, but the app asks for a
-- reason and keeps it here so the over-claim stays explainable later.
--
-- Written through a tiny RPC rather than widening billing_approve (restated in
-- several migrations already): only admin/pm, only this one column.

alter table public.billings add column if not exists overclaim_reason text;

create or replace function public.billing_set_overclaim_reason(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._billing_current_role() not in ('admin','pm') then
    raise exception 'ไม่มีสิทธิ์';
  end if;
  update public.billings set overclaim_reason = nullif(btrim(p_reason), '') where id = p_id;
end;
$$;

revoke all on function public.billing_set_overclaim_reason(uuid, text) from public, anon;
grant execute on function public.billing_set_overclaim_reason(uuid, text) to authenticated;
