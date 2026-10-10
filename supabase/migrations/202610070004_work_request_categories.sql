-- Sale-request form categories: แจ้งซ่อม / ส่วนกลาง / เก็บงาน / โอนบ้าน.
-- Additive: the five legacy categories stay valid so existing rows (and any
-- code still running the old build) keep working.
alter table public.sales_work_requests drop constraint if exists sales_work_requests_category_check;
alter table public.sales_work_requests add constraint sales_work_requests_category_check
  check (category in ('extra_work','defect','expedite','handover_prep','other',
                      'repair','common_area','punch_list','house_transfer'));

create or replace function public.sales_work_request_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_plot_id uuid := (p_payload->>'plot_id')::uuid;
  v_category text := p_payload->>'category';
  v_title text := nullif(trim(p_payload->>'title'), '');
  v_detail text := nullif(p_payload->>'detail', '');
  v_priority text := coalesce(nullif(p_payload->>'priority', ''), 'normal');
  v_charge_to text := nullif(p_payload->>'charge_to', '');
  v_quoted_amount numeric := nullif(p_payload->>'quoted_amount', '')::numeric;
  v_needed_by date := nullif(p_payload->>'needed_by', '')::date;
  v_plot_sale_id uuid;
  v_seq int;
  v_request_no text;
  v_id uuid;
  v_auto_approve boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('admin','pm','sales','sales_exec') then
    raise exception 'Only sales/PM/admin can file a work request' using errcode = '42501';
  end if;
  if v_plot_id is null then
    raise exception 'plot_id is required' using errcode = '22023';
  end if;
  if v_title is null then
    raise exception 'title is required' using errcode = '22023';
  end if;
  if v_category not in ('extra_work','defect','expedite','handover_prep','other','repair','common_area','punch_list','house_transfer') then
    raise exception 'Unknown category: %', v_category using errcode = '22023';
  end if;
  v_auto_approve := v_role in ('admin','sales_exec');

  select id, coalesce(v_needed_by, inspection_at, transfer_at)
    into v_plot_sale_id, v_needed_by
  from public.plot_sales
  where plot_id = v_plot_id and cancelled_at is null;

  insert into public.sales_work_request_number_counters (request_date, counter)
  values (current_date, 1)
  on conflict (request_date) do update set counter = sales_work_request_number_counters.counter + 1
  returning counter into v_seq;
  v_request_no := 'SR-' || to_char(current_date, 'YYYYMMDD') || lpad(v_seq::text, 3, '0');

  insert into public.sales_work_requests (
    plot_id, plot_sale_id, request_no, category, title, detail, photo_urls,
    priority, needed_by, charge_to, quoted_amount, requested_by,
    status, approved_by, approved_at
  ) values (
    v_plot_id, v_plot_sale_id, v_request_no, v_category, v_title, v_detail,
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_payload->'photo_urls', '[]'::jsonb)) x), '{}'),
    v_priority, v_needed_by, v_charge_to, v_quoted_amount, v_uid,
    case when v_auto_approve then 'new' else 'pending_approval' end,
    case when v_auto_approve then v_uid end,
    case when v_auto_approve then now() end
  )
  returning id into v_id;

  if v_auto_approve then
    insert into public.notifications (recipient_id, sales_work_request_id, type)
    select p.id, v_id, 'work_request_new'
    from public.profiles p
    where p.role in ('admin','pm','foreman');
  else
    insert into public.notifications (recipient_id, sales_work_request_id, type)
    select p.id, v_id, 'work_request_pending'
    from public.profiles p
    where p.role in ('sales_exec','admin');
  end if;

  return jsonb_build_object('id', v_id, 'request_no', v_request_no,
    'status', case when v_auto_approve then 'new' else 'pending_approval' end);
end;
$$;

revoke all on function public.sales_work_request_create(jsonb) from public;
revoke all on function public.sales_work_request_create(jsonb) from anon;
grant execute on function public.sales_work_request_create(jsonb) to authenticated;
