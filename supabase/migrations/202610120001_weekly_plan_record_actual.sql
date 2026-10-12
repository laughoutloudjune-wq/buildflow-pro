-- Record real (ACTUAL) job progress on a weekly plan row.
--
-- Foremen may edit only the plan rows they created (weekly_plan_items_update),
-- but June wants any foreman or PM/admin to be able to record site progress on
-- any row (2026-10-12) - the figure is shown next to billing requests, so it
-- must not depend on who happened to create the row. Like weekly_plan_set_status
-- this is a security-definer RPC that touches ONE thing only: a single day of
-- actual_pct. It works on an agreed week too (ACTUAL stays editable after the
-- meeting; weekly_plan_enforce_lock only locks the plan fields).

create or replace function public.weekly_plan_record_actual(p_id uuid, p_day int, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old numeric[];
  v_new numeric[] := array_fill(null::numeric, array[7]);
  i int;
begin
  if public._billing_current_role() not in ('admin','pm','foreman') then
    raise exception 'ไม่มีสิทธิ์';
  end if;
  if p_day is null or p_day < 0 or p_day > 6 then
    raise exception 'วันไม่ถูกต้อง';
  end if;
  if p_value is not null and (p_value < 0 or p_value > 100) then
    raise exception 'ความคืบหน้าต้องอยู่ระหว่าง 0-100%%';
  end if;

  select actual_pct into v_old from public.weekly_plan_items where id = p_id for update;
  if not found then
    raise exception 'ไม่พบรายการ';
  end if;

  for i in 1..7 loop
    v_new[i] := case when v_old is null then null else v_old[i] end;
  end loop;
  v_new[p_day + 1] := p_value;

  update public.weekly_plan_items
  set actual_pct = case when v_new = array_fill(null::numeric, array[7]) then null else v_new end
  where id = p_id;
end;
$$;

revoke all on function public.weekly_plan_record_actual(uuid, int, numeric) from public, anon;
grant execute on function public.weekly_plan_record_actual(uuid, int, numeric) to authenticated;
