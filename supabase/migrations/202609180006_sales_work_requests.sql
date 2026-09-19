-- Sales module, Phase 6 (SALES_MODULE_PLAN.md §7.6, §8.4).
--
-- Sales files a request against a plot (customer extras, defect fixes,
-- "must be ready before the 15th") and construction works it as a queue
-- instead of a LINE message. Creation and the notified status transitions go
-- through security-definer RPCs, not direct table writes - same reason
-- billing_create_request/billing_approve do (202607230001_notifications.sql):
-- notifications has no INSERT grant for authenticated at all, so writing one
-- on someone else's behalf is only possible from a function that runs as
-- its owner. Simple field updates that don't need a notification
-- (assigning a contractor, linking a DC afterward) go through plain
-- column-level grants instead - no need for a function just for those.

create table public.sales_work_requests (
  id           uuid primary key default gen_random_uuid(),
  plot_id      uuid not null references public.plots(id) on delete cascade,
  plot_sale_id uuid references public.plot_sales(id) on delete set null,
  request_no   text unique,
  category     text not null check (category in ('extra_work','defect','expedite','handover_prep','other')),
  title        text not null,
  detail       text,
  photo_urls   text[],
  priority     text not null default 'normal' check (priority in ('low','normal','urgent')),
  needed_by    date,
  status       text not null default 'new' check (status in ('new','accepted','in_progress','done','rejected')),
  charge_to    text check (charge_to in ('customer','company')),
  quoted_amount numeric,
  assigned_contractor_id uuid references public.contractors(id),
  billing_id   uuid references public.billings(id),
  requested_by uuid references public.profiles(id),
  accepted_by  uuid references public.profiles(id),
  reject_reason text,
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);

create index sales_work_requests_plot_id_idx on public.sales_work_requests(plot_id);
create index sales_work_requests_status_idx on public.sales_work_requests(status) where status in ('new','accepted','in_progress');

alter table public.sales_work_requests enable row level security;

-- Read: everyone the sidebar entry is visible to (sales files them, the
-- construction side - admin/pm/foreman - works the queue).
create policy "swr_select"
  on public.sales_work_requests for select to authenticated
  using (public._billing_current_role() in ('admin','pm','sales','foreman'));

-- No insert grant, same reasoning as notifications - creation always goes
-- through sales_work_request_create() so numbering and the new-request
-- notification can never be skipped.
-- Only the two fields a plain client update legitimately needs to touch
-- without a status transition or notification attached.
grant select on public.sales_work_requests to authenticated;
grant update (assigned_contractor_id, billing_id) on public.sales_work_requests to authenticated;
create policy "swr_update"
  on public.sales_work_requests for update to authenticated
  using (public._billing_current_role() in ('admin','pm','sales','foreman'))
  with check (public._billing_current_role() in ('admin','pm','sales','foreman'));
revoke all on public.sales_work_requests from anon;

create table public.sales_work_request_number_counters (
  request_date date primary key,
  counter int not null
);
alter table public.sales_work_request_number_counters enable row level security;
create policy "swr_counter_all"
  on public.sales_work_request_number_counters for all to authenticated
  using (true) with check (true);
grant select, insert, update on public.sales_work_request_number_counters to authenticated;
revoke all on public.sales_work_request_number_counters from anon;

-- notifications gains a third entity kind alongside billing_id/purchase_request_id.
alter table public.notifications
  add column if not exists sales_work_request_id uuid references public.sales_work_requests(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- sales_work_request_create: numbers the request, defaults needed_by from
-- the plot's live deal (inspection_at, then transfer_at) when not given -
-- that default is the whole point of linking the request to the sale
-- (§7.6) - and notifies every admin/pm/foreman of the new item.
-- ---------------------------------------------------------------------------
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
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('admin','pm','sales') then
    raise exception 'Only sales/PM/admin can file a work request' using errcode = '42501';
  end if;
  if v_plot_id is null then
    raise exception 'plot_id is required' using errcode = '22023';
  end if;
  if v_title is null then
    raise exception 'title is required' using errcode = '22023';
  end if;
  if v_category not in ('extra_work','defect','expedite','handover_prep','other') then
    raise exception 'Unknown category: %', v_category using errcode = '22023';
  end if;

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
    priority, needed_by, charge_to, quoted_amount, requested_by
  ) values (
    v_plot_id, v_plot_sale_id, v_request_no, v_category, v_title, v_detail,
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_payload->'photo_urls', '[]'::jsonb)) x), '{}'),
    v_priority, v_needed_by, v_charge_to, v_quoted_amount, v_uid
  )
  returning id into v_id;

  insert into public.notifications (recipient_id, sales_work_request_id, type)
  select p.id, v_id, 'work_request_new'
  from public.profiles p
  where p.role in ('admin','pm','foreman');

  return jsonb_build_object('id', v_id, 'request_no', v_request_no);
end;
$$;

revoke all on function public.sales_work_request_create(jsonb) from public;
revoke all on function public.sales_work_request_create(jsonb) from anon;
grant execute on function public.sales_work_request_create(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- sales_work_request_set_status: accept/reject/in_progress/done in one
-- place, so accepted_by/reject_reason/completed_at are always stamped
-- consistently with the status change that caused them - and 'done'
-- notifies whoever originally filed the request.
-- ---------------------------------------------------------------------------
create or replace function public.sales_work_request_set_status(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text := p_payload->>'status';
  v_reject_reason text := nullif(p_payload->>'reject_reason', '');
  v_requested_by uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('admin','pm','foreman') then
    raise exception 'Only construction (admin/pm/foreman) can update a work request''s status' using errcode = '42501';
  end if;
  if v_status not in ('accepted','in_progress','done','rejected') then
    raise exception 'Unknown status: %', v_status using errcode = '22023';
  end if;
  if v_status = 'rejected' and v_reject_reason is null then
    raise exception 'reject_reason is required to reject a request' using errcode = '22023';
  end if;

  update public.sales_work_requests set
    status = v_status,
    accepted_by = case when v_status = 'accepted' and accepted_by is null then v_uid else accepted_by end,
    reject_reason = case when v_status = 'rejected' then v_reject_reason else reject_reason end,
    completed_at = case when v_status = 'done' then now() else completed_at end
  where id = p_id
  returning requested_by into v_requested_by;

  if not found then
    raise exception 'Work request not found' using errcode = '22023';
  end if;

  if v_status = 'done' and v_requested_by is not null then
    insert into public.notifications (recipient_id, sales_work_request_id, type)
    values (v_requested_by, p_id, 'work_request_done');
  end if;

  return jsonb_build_object('id', p_id, 'status', v_status);
end;
$$;

revoke all on function public.sales_work_request_set_status(uuid, jsonb) from public;
revoke all on function public.sales_work_request_set_status(uuid, jsonb) from anon;
grant execute on function public.sales_work_request_set_status(uuid, jsonb) to authenticated;
