-- WORKFLOW_PLAN.md step 2: Sales exec role, TR (transfer request), SR approval,
-- commission settings (sales side only - never construction money).
--
-- Contents:
--   A. New role 'sales_exec' (above sales). Everything that allowed 'sales'
--      now allows 'sales_exec' too (policies and functions restated in full).
--   B. Commission: commission_settings (project default + optional per-plot
--      override), _commission_for_plot(), set/clear RPCs.
--   C. TR: transfer_requests + number counter + create/update/set_status RPCs.
--   D. SR approval: sales_work_requests gains 'pending_approval'; new requests
--      wait for a sales exec/admin, construction (pm/foreman) cannot see them
--      until approved.
--   E. Notifications: new types + transfer_request_id column.
--
-- Ship together with the matching code (HANDOVER_PLAN.md section 0, rule 2):
-- the app writes status 'pending_approval' and role 'sales_exec'.

-- ---------------------------------------------------------------------------
-- A. Role
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['admin', 'pm', 'foreman', 'accountant', 'sales', 'sales_exec']));

-- sale_statuses (read)
drop policy if exists "sale_statuses_select" on public.sale_statuses;
create policy "sale_statuses_select"
  on public.sale_statuses for select to authenticated
  using (public._billing_current_role() in ('admin','pm','sales','sales_exec'));

-- customers
drop policy if exists "customers_select" on public.customers;
create policy "customers_select"
  on public.customers for select to authenticated
  using (public._billing_current_role() in ('admin','pm','sales','sales_exec'));
drop policy if exists "customers_write" on public.customers;
create policy "customers_write"
  on public.customers for all to authenticated
  using (public._billing_current_role() in ('admin','pm','sales','sales_exec'))
  with check (public._billing_current_role() in ('admin','pm','sales','sales_exec'));

-- plot_sales
drop policy if exists "plot_sales_select" on public.plot_sales;
create policy "plot_sales_select"
  on public.plot_sales for select to authenticated
  using (public._billing_current_role() in ('admin','pm','sales','sales_exec'));
drop policy if exists "plot_sales_write" on public.plot_sales;
create policy "plot_sales_write"
  on public.plot_sales for all to authenticated
  using (public._billing_current_role() in ('admin','pm','sales','sales_exec'))
  with check (public._billing_current_role() in ('admin','pm','sales','sales_exec'));

-- plot_sale_events
drop policy if exists "plot_sale_events_select" on public.plot_sale_events;
create policy "plot_sale_events_select"
  on public.plot_sale_events for select to authenticated
  using (public._billing_current_role() in ('admin','pm','sales','sales_exec'));
drop policy if exists "plot_sale_events_insert" on public.plot_sale_events;
create policy "plot_sale_events_insert"
  on public.plot_sale_events for insert to authenticated
  with check (public._billing_current_role() in ('admin','pm','sales','sales_exec'));

-- sale_payments + receipt counter
drop policy if exists "sale_payments_all" on public.sale_payments;
create policy "sale_payments_all"
  on public.sale_payments for all to authenticated
  using (public._billing_current_role() in ('admin','pm','sales','sales_exec'))
  with check (public._billing_current_role() in ('admin','pm','sales','sales_exec'));
drop policy if exists "sale_receipt_counter_all" on public.sale_receipt_number_counters;
create policy "sale_receipt_counter_all"
  on public.sale_receipt_number_counters for all to authenticated
  using (public._billing_current_role() in ('admin','pm','sales','sales_exec'))
  with check (public._billing_current_role() in ('admin','pm','sales','sales_exec'));

-- sales-docs storage bucket
drop policy if exists "sales_docs_select" on storage.objects;
create policy "sales_docs_select" on storage.objects for select to authenticated
  using (bucket_id = 'sales-docs' and public._billing_current_role() in ('admin','pm','sales','sales_exec'));
drop policy if exists "sales_docs_insert" on storage.objects;
create policy "sales_docs_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'sales-docs' and public._billing_current_role() in ('admin','pm','sales','sales_exec'));
drop policy if exists "sales_docs_update" on storage.objects;
create policy "sales_docs_update" on storage.objects for update to authenticated
  using (bucket_id = 'sales-docs' and public._billing_current_role() in ('admin','pm','sales','sales_exec'));
drop policy if exists "sales_docs_delete" on storage.objects;
create policy "sales_docs_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'sales-docs' and public._billing_current_role() in ('admin','pm','sales','sales_exec'));

-- Read-only access to plot/contractor data the plot page needs (no money).
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','sales','sales_exec']));
drop policy if exists plots_select on public.plots;
create policy plots_select on public.plots for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','sales','sales_exec']));
drop policy if exists plot_groups_select on public.plot_groups;
create policy plot_groups_select on public.plot_groups for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','sales','sales_exec']));
drop policy if exists plot_group_members_select on public.plot_group_members;
create policy plot_group_members_select on public.plot_group_members for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','sales','sales_exec']));
drop policy if exists contractors_select on public.contractors;
create policy contractors_select on public.contractors for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','accountant','sales','sales_exec']));
drop policy if exists contractor_types_select on public.contractor_types;
create policy contractor_types_select on public.contractor_types for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','foreman','accountant','sales','sales_exec']));

-- Promotions catalog and per-deal items
drop policy if exists promotions_select on public.promotions;
create policy promotions_select on public.promotions for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','sales','sales_exec']));
drop policy if exists promotions_write on public.promotions;
create policy promotions_write on public.promotions for all to authenticated
  using (_billing_current_role() = any (array['admin','sales','sales_exec']))
  with check (_billing_current_role() = any (array['admin','sales','sales_exec']));
drop policy if exists promotion_items_select on public.promotion_items;
create policy promotion_items_select on public.promotion_items for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','sales','sales_exec']));
drop policy if exists promotion_items_write on public.promotion_items;
create policy promotion_items_write on public.promotion_items for all to authenticated
  using (_billing_current_role() = any (array['admin','sales','sales_exec']))
  with check (_billing_current_role() = any (array['admin','sales','sales_exec']));
drop policy if exists plot_sale_promotion_items_select on public.plot_sale_promotion_items;
create policy plot_sale_promotion_items_select on public.plot_sale_promotion_items for select to authenticated
  using (_billing_current_role() = any (array['admin','pm','sales','sales_exec']));
drop policy if exists plot_sale_promotion_items_write on public.plot_sale_promotion_items;
create policy plot_sale_promotion_items_write on public.plot_sale_promotion_items for all to authenticated
  using (_billing_current_role() = any (array['admin','pm','sales','sales_exec']))
  with check (_billing_current_role() = any (array['admin','pm','sales','sales_exec']));

-- sales_change_status (restated in full; only the role list changed)
create or replace function public.sales_change_status(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_plot_id uuid := (p_payload->>'plot_id')::uuid;
  v_new_status text := p_payload->>'status_code';
  v_note text := nullif(p_payload->>'note', '');
  v_sale_price numeric := nullif(p_payload->>'sale_price', '')::numeric;
  v_customer_id uuid := nullif(p_payload->>'customer_id', '')::uuid;
  v_customer_name text := nullif(p_payload->>'customer_name', '');
  v_customer_phone text := nullif(p_payload->>'customer_phone', '');
  v_sale_id uuid;
  v_old_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('admin','pm','sales','sales_exec') then
    raise exception 'Only sales/PM/admin can change a plot''s sale status' using errcode = '42501';
  end if;
  if v_plot_id is null then
    raise exception 'plot_id is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.sale_statuses where code = v_new_status) then
    raise exception 'Unknown status code: %', v_new_status using errcode = '22023';
  end if;

  if v_customer_id is null and v_customer_name is not null then
    insert into public.customers (full_name, phone, created_by)
    values (v_customer_name, v_customer_phone, v_uid)
    returning id into v_customer_id;
  end if;

  select id, status_code into v_sale_id, v_old_status
  from public.plot_sales
  where plot_id = v_plot_id and cancelled_at is null;

  if v_sale_id is null then
    insert into public.plot_sales (
      plot_id, customer_id, status_code, sales_rep_id, list_price, sale_price,
      booked_at, contract_at, inspection_at, transfer_at, delivered_at, cancelled_at,
      created_by
    )
    select
      v_plot_id, v_customer_id, v_new_status, v_uid, p.list_price, v_sale_price,
      case when v_new_status = 'reserved' then current_date end,
      case when v_new_status = 'contracted' then current_date end,
      case when v_new_status = 'awaiting_inspection' then current_date end,
      case when v_new_status = 'transferred' then current_date end,
      null,
      case when v_new_status = 'cancelled' then current_date end,
      v_uid
    from public.plots p where p.id = v_plot_id
    returning id into v_sale_id;
  else
    update public.plot_sales set
      status_code = v_new_status,
      customer_id = coalesce(v_customer_id, customer_id),
      sale_price = coalesce(v_sale_price, sale_price),
      booked_at = case when v_new_status = 'reserved' and booked_at is null then current_date else booked_at end,
      contract_at = case when v_new_status = 'contracted' and contract_at is null then current_date else contract_at end,
      inspection_at = case when v_new_status = 'awaiting_inspection' and inspection_at is null then current_date else inspection_at end,
      transfer_at = case when v_new_status = 'transferred' and transfer_at is null then current_date else transfer_at end,
      cancelled_at = case when v_new_status = 'cancelled' then current_date else cancelled_at end,
      updated_at = now()
    where id = v_sale_id;
  end if;

  insert into public.plot_sale_events (plot_sale_id, event_type, from_status, to_status, actor_id, note)
  values (v_sale_id, 'status_change', v_old_status, v_new_status, v_uid, v_note);

  return jsonb_build_object('sale_id', v_sale_id, 'status_code', v_new_status);
end;
$$;

revoke all on function public.sales_change_status(jsonb) from public;
revoke all on function public.sales_change_status(jsonb) from anon;
grant execute on function public.sales_change_status(jsonb) to authenticated;

-- sale_receipt_next_number (restated in full; only the role list changed)
create or replace function public.sale_receipt_next_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._billing_current_role();
  v_seq int;
begin
  if v_role not in ('admin','pm','sales','sales_exec') then
    raise exception 'Only sales/PM/admin can issue a receipt number' using errcode = '42501';
  end if;

  insert into public.sale_receipt_number_counters (receipt_date, counter)
  values (current_date, 1)
  on conflict (receipt_date) do update set counter = sale_receipt_number_counters.counter + 1
  returning counter into v_seq;

  return 'RC-' || to_char(current_date, 'YYYYMMDD') || lpad(v_seq::text, 3, '0');
end;
$$;

revoke all on function public.sale_receipt_next_number() from public;
revoke all on function public.sale_receipt_next_number() from anon;
grant execute on function public.sale_receipt_next_number() to authenticated;

-- ---------------------------------------------------------------------------
-- E. Notifications: new kinds
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'new_request', 'billing_approved', 'billing_rejected',
    'pr_pending_review', 'pr_approved', 'pr_rejected', 'pr_ordered', 'pr_received',
    'work_request_new', 'work_request_done',
    'work_request_pending', 'work_request_approved', 'work_request_rejected',
    'tr_submitted', 'tr_approved', 'tr_rejected'
  ]));

-- ---------------------------------------------------------------------------
-- B. Commission settings (fixed amount; plot_id null = project default)
-- ---------------------------------------------------------------------------
create table public.commission_settings (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  plot_id    uuid references public.plots(id) on delete cascade,
  amount     numeric not null check (amount >= 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (project_id, plot_id)
);
-- unique(project_id, plot_id) treats NULL plot_id as distinct, so the project
-- default needs its own partial unique index to stay unique per project.
create unique index commission_settings_one_default_per_project
  on public.commission_settings(project_id) where plot_id is null;

alter table public.commission_settings enable row level security;
create policy commission_settings_select on public.commission_settings for select to authenticated
  using (public._billing_current_role() in ('admin','pm','sales','sales_exec'));
-- Writes only through commission_setting_set/clear below (role-checked).
grant select on public.commission_settings to authenticated;
revoke all on public.commission_settings from anon;

-- Override for the plot if there is one, else the project default, else 0.
create or replace function public._commission_for_plot(p_plot_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select cs.amount from public.commission_settings cs where cs.plot_id = p_plot_id),
    (select cs.amount from public.commission_settings cs
       join public.plots p on p.project_id = cs.project_id
      where p.id = p_plot_id and cs.plot_id is null),
    0
  );
$$;
revoke all on function public._commission_for_plot(uuid) from public;
revoke all on function public._commission_for_plot(uuid) from anon;
grant execute on function public._commission_for_plot(uuid) to authenticated;

create or replace function public.commission_setting_set(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_project_id uuid := nullif(p_payload->>'project_id', '')::uuid;
  v_plot_id uuid := nullif(p_payload->>'plot_id', '')::uuid;
  v_amount numeric := nullif(p_payload->>'amount', '')::numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('admin','pm','sales_exec') then
    raise exception 'Only admin/PM/sales exec can set commission' using errcode = '42501';
  end if;
  if v_amount is null or v_amount < 0 then
    raise exception 'amount must be >= 0' using errcode = '22023';
  end if;
  if v_plot_id is not null then
    select project_id into v_project_id from public.plots where id = v_plot_id;
  end if;
  if v_project_id is null then
    raise exception 'project_id or plot_id is required' using errcode = '22023';
  end if;

  if v_plot_id is null then
    insert into public.commission_settings (project_id, plot_id, amount, updated_by)
    values (v_project_id, null, v_amount, v_uid)
    on conflict (project_id) where plot_id is null
    do update set amount = excluded.amount, updated_by = v_uid, updated_at = now();
  else
    insert into public.commission_settings (project_id, plot_id, amount, updated_by)
    values (v_project_id, v_plot_id, v_amount, v_uid)
    on conflict (project_id, plot_id)
    do update set amount = excluded.amount, updated_by = v_uid, updated_at = now();
  end if;

  return jsonb_build_object('project_id', v_project_id, 'plot_id', v_plot_id, 'amount', v_amount);
end;
$$;
revoke all on function public.commission_setting_set(jsonb) from public;
revoke all on function public.commission_setting_set(jsonb) from anon;
grant execute on function public.commission_setting_set(jsonb) to authenticated;

create or replace function public.commission_setting_clear(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_project_id uuid := nullif(p_payload->>'project_id', '')::uuid;
  v_plot_id uuid := nullif(p_payload->>'plot_id', '')::uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('admin','pm','sales_exec') then
    raise exception 'Only admin/PM/sales exec can set commission' using errcode = '42501';
  end if;
  if v_plot_id is not null then
    delete from public.commission_settings where plot_id = v_plot_id;
  elsif v_project_id is not null then
    delete from public.commission_settings where project_id = v_project_id and plot_id is null;
  else
    raise exception 'project_id or plot_id is required' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.commission_setting_clear(jsonb) from public;
revoke all on function public.commission_setting_clear(jsonb) from anon;
grant execute on function public.commission_setting_clear(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- C. Transfer requests (TR / ใบขอโอน)
-- ---------------------------------------------------------------------------
create table public.transfer_requests (
  id               uuid primary key default gen_random_uuid(),
  request_no       text unique,
  plot_sale_id     uuid not null references public.plot_sales(id) on delete cascade,
  plot_id          uuid not null references public.plots(id) on delete cascade,
  status           text not null default 'draft'
                   check (status in ('draft','submitted','approved','done','rejected')),
  price            numeric not null default 0,
  discount         numeric not null default 0 check (discount >= 0),
  promotion_total  numeric not null default 0 check (promotion_total >= 0),
  commission_amount numeric not null default 0 check (commission_amount >= 0),
  notes            text,
  reject_reason    text,
  requested_by     uuid references public.profiles(id),
  submitted_at     timestamptz,
  approved_by      uuid references public.profiles(id),
  approved_at      timestamptz,
  done_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One live (non-rejected) TR per deal; a rejected one is revised in place
-- (back to draft) or left behind and replaced by a new one.
create unique index transfer_requests_one_live_per_sale
  on public.transfer_requests(plot_sale_id) where status <> 'rejected';
create index transfer_requests_status_idx on public.transfer_requests(status);
create index transfer_requests_plot_id_idx on public.transfer_requests(plot_id);

alter table public.transfer_requests enable row level security;
create policy transfer_requests_select on public.transfer_requests for select to authenticated
  using (public._billing_current_role() in ('admin','pm','sales','sales_exec'));
-- No insert/update grant: everything goes through the RPCs below so numbering,
-- the commission snapshot and notifications can never be skipped.
grant select on public.transfer_requests to authenticated;
revoke all on public.transfer_requests from anon;

create table public.transfer_request_number_counters (
  ym      text primary key,
  counter int not null
);
alter table public.transfer_request_number_counters enable row level security;
-- No policies and no grants: only the security-definer create function writes it.
revoke all on public.transfer_request_number_counters from anon, authenticated;

alter table public.notifications
  add column if not exists transfer_request_id uuid references public.transfer_requests(id) on delete cascade;

-- Snapshot of a deal's money lines (price, discount, promotion, commission).
create or replace function public._transfer_request_snapshot(p_plot_sale_id uuid)
returns table (plot_id uuid, price numeric, discount numeric, promotion_total numeric, commission_amount numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    ps.plot_id,
    coalesce(ps.sale_price, ps.list_price, 0),
    greatest(coalesce(ps.list_price, 0) - coalesce(ps.sale_price, ps.list_price, 0), 0),
    coalesce((select sum(pi.value) from public.plot_sale_promotion_items pi where pi.plot_sale_id = ps.id), 0),
    public._commission_for_plot(ps.plot_id)
  from public.plot_sales ps
  where ps.id = p_plot_sale_id;
$$;
revoke all on function public._transfer_request_snapshot(uuid) from public;
revoke all on function public._transfer_request_snapshot(uuid) from anon;
revoke all on function public._transfer_request_snapshot(uuid) from authenticated;

create or replace function public.transfer_request_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_sale_id uuid := nullif(p_payload->>'plot_sale_id', '')::uuid;
  v_notes text := nullif(p_payload->>'notes', '');
  v_snap record;
  v_seq int;
  v_ym text := to_char(current_date, 'YYMM');
  v_no text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('admin','pm','sales','sales_exec') then
    raise exception 'Only sales/PM/admin can create a transfer request' using errcode = '42501';
  end if;
  if v_sale_id is null then
    raise exception 'plot_sale_id is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.plot_sales where id = v_sale_id and cancelled_at is null) then
    raise exception 'Deal not found or cancelled' using errcode = '22023';
  end if;
  if exists (select 1 from public.transfer_requests where plot_sale_id = v_sale_id and status <> 'rejected') then
    raise exception 'This deal already has a transfer request' using errcode = '22023';
  end if;

  select * into v_snap from public._transfer_request_snapshot(v_sale_id);

  insert into public.transfer_request_number_counters (ym, counter)
  values (v_ym, 1)
  on conflict (ym) do update set counter = transfer_request_number_counters.counter + 1
  returning counter into v_seq;
  v_no := 'TR-' || v_ym || '-' || lpad(v_seq::text, 4, '0');

  insert into public.transfer_requests (
    request_no, plot_sale_id, plot_id, status, price, discount, promotion_total,
    commission_amount, notes, requested_by
  ) values (
    v_no, v_sale_id, v_snap.plot_id, 'draft', v_snap.price, v_snap.discount,
    v_snap.promotion_total, v_snap.commission_amount, v_notes, v_uid
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'request_no', v_no);
end;
$$;
revoke all on function public.transfer_request_create(jsonb) from public;
revoke all on function public.transfer_request_create(jsonb) from anon;
grant execute on function public.transfer_request_create(jsonb) to authenticated;

-- Edit a draft. Fields come from the payload; refresh=true re-reads the
-- deal's current price/discount/promotion/commission first (a draft is the
-- only time the snapshot may change - after submit it is frozen).
create or replace function public.transfer_request_update(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_tr public.transfer_requests%rowtype;
  v_snap record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('admin','pm','sales','sales_exec') then
    raise exception 'Only sales/PM/admin can edit a transfer request' using errcode = '42501';
  end if;

  select * into v_tr from public.transfer_requests where id = p_id for update;
  if not found then
    raise exception 'Transfer request not found' using errcode = '22023';
  end if;
  if v_tr.status <> 'draft' then
    raise exception 'Only a draft can be edited' using errcode = '22023';
  end if;

  if coalesce((p_payload->>'refresh')::boolean, false) then
    select * into v_snap from public._transfer_request_snapshot(v_tr.plot_sale_id);
    v_tr.price := v_snap.price;
    v_tr.discount := v_snap.discount;
    v_tr.promotion_total := v_snap.promotion_total;
    v_tr.commission_amount := v_snap.commission_amount;
  end if;

  update public.transfer_requests set
    price = coalesce(nullif(p_payload->>'price', '')::numeric, v_tr.price),
    discount = coalesce(nullif(p_payload->>'discount', '')::numeric, v_tr.discount),
    promotion_total = coalesce(nullif(p_payload->>'promotion_total', '')::numeric, v_tr.promotion_total),
    commission_amount = coalesce(nullif(p_payload->>'commission_amount', '')::numeric, v_tr.commission_amount),
    notes = case when p_payload ? 'notes' then nullif(p_payload->>'notes', '') else notes end,
    updated_at = now()
  where id = p_id;

  return jsonb_build_object('id', p_id);
end;
$$;
revoke all on function public.transfer_request_update(uuid, jsonb) from public;
revoke all on function public.transfer_request_update(uuid, jsonb) from anon;
grant execute on function public.transfer_request_update(uuid, jsonb) to authenticated;

-- Flow: draft -> submitted -> approved -> done, submitted -> rejected,
-- rejected -> draft (revise and resubmit).
--   submit/done/reopen: sales, sales_exec, pm, admin
--   approve/reject:     sales_exec, admin
create or replace function public.transfer_request_set_status(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text := p_payload->>'status';
  v_reason text := nullif(p_payload->>'reject_reason', '');
  v_tr public.transfer_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('admin','pm','sales','sales_exec') then
    raise exception 'No permission on transfer requests' using errcode = '42501';
  end if;
  if v_status not in ('draft','submitted','approved','done','rejected') then
    raise exception 'Unknown status: %', v_status using errcode = '22023';
  end if;

  select * into v_tr from public.transfer_requests where id = p_id for update;
  if not found then
    raise exception 'Transfer request not found' using errcode = '22023';
  end if;

  if v_status = 'submitted' then
    if v_tr.status <> 'draft' then
      raise exception 'Only a draft can be submitted' using errcode = '22023';
    end if;
    update public.transfer_requests set status = 'submitted', submitted_at = now(), reject_reason = null, updated_at = now() where id = p_id;
    insert into public.notifications (recipient_id, transfer_request_id, type)
    select p.id, p_id, 'tr_submitted' from public.profiles p where p.role in ('sales_exec','admin');

  elsif v_status in ('approved','rejected') then
    if v_role not in ('sales_exec','admin') then
      raise exception 'Only sales exec/admin can approve or reject' using errcode = '42501';
    end if;
    if v_tr.status <> 'submitted' then
      raise exception 'Only a submitted request can be approved or rejected' using errcode = '22023';
    end if;
    if v_status = 'rejected' and v_reason is null then
      raise exception 'reject_reason is required to reject a request' using errcode = '22023';
    end if;
    update public.transfer_requests set
      status = v_status,
      approved_by = v_uid,
      approved_at = now(),
      reject_reason = case when v_status = 'rejected' then v_reason else null end,
      updated_at = now()
    where id = p_id;
    if v_tr.requested_by is not null then
      insert into public.notifications (recipient_id, transfer_request_id, type)
      values (v_tr.requested_by, p_id, case when v_status = 'approved' then 'tr_approved' else 'tr_rejected' end);
    end if;

  elsif v_status = 'done' then
    if v_tr.status <> 'approved' then
      raise exception 'Only an approved request can be marked done' using errcode = '22023';
    end if;
    update public.transfer_requests set status = 'done', done_at = now(), updated_at = now() where id = p_id;

  else -- 'draft': reopen a rejected request
    if v_tr.status <> 'rejected' then
      raise exception 'Only a rejected request can be reopened' using errcode = '22023';
    end if;
    if exists (select 1 from public.transfer_requests where plot_sale_id = v_tr.plot_sale_id and status <> 'rejected') then
      raise exception 'This deal already has another live transfer request' using errcode = '22023';
    end if;
    update public.transfer_requests set status = 'draft', updated_at = now() where id = p_id;
  end if;

  return jsonb_build_object('id', p_id, 'status', v_status);
end;
$$;
revoke all on function public.transfer_request_set_status(uuid, jsonb) from public;
revoke all on function public.transfer_request_set_status(uuid, jsonb) from anon;
grant execute on function public.transfer_request_set_status(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- D. SR approval
-- ---------------------------------------------------------------------------
alter table public.sales_work_requests drop constraint sales_work_requests_status_check;
alter table public.sales_work_requests add constraint sales_work_requests_status_check
  check (status in ('pending_approval','new','accepted','in_progress','done','rejected'));
alter table public.sales_work_requests alter column status set default 'pending_approval';

-- A request the sales exec turned down never reaches construction, so it is
-- flagged separately from construction's own 'rejected'.
alter table public.sales_work_requests
  add column if not exists rejected_at_approval boolean not null default false,
  add column if not exists approved_by uuid references public.profiles(id),
  add column if not exists approved_at timestamptz;

drop index if exists public.sales_work_requests_status_idx;
create index sales_work_requests_status_idx on public.sales_work_requests(status)
  where status in ('pending_approval','new','accepted','in_progress');

-- Read: sales side sees everything; construction (pm/foreman) only what has
-- been approved - plus whatever a pm filed themselves.
drop policy if exists "swr_select" on public.sales_work_requests;
create policy "swr_select"
  on public.sales_work_requests for select to authenticated
  using (
    public._billing_current_role() in ('admin','sales','sales_exec')
    or requested_by = auth.uid()
    or (
      public._billing_current_role() in ('pm','foreman')
      and status <> 'pending_approval'
      and not rejected_at_approval
    )
  );

drop policy if exists "swr_update" on public.sales_work_requests;
create policy "swr_update"
  on public.sales_work_requests for update to authenticated
  using (
    public._billing_current_role() in ('admin','sales','sales_exec')
    or (
      public._billing_current_role() in ('pm','foreman')
      and status <> 'pending_approval'
      and not rejected_at_approval
    )
  )
  with check (public._billing_current_role() in ('admin','pm','sales','sales_exec','foreman'));

-- Create: goes to the sales exec first. A sales exec/admin filing one
-- approves it by filing it, so it lands straight in construction's queue.
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
  if v_category not in ('extra_work','defect','expedite','handover_prep','other') then
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

-- Approve (pending_approval -> new) or reject with a reason.
create or replace function public.sales_work_request_approve(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_approve boolean := coalesce((p_payload->>'approve')::boolean, false);
  v_reason text := nullif(p_payload->>'reject_reason', '');
  v_requested_by uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('sales_exec','admin') then
    raise exception 'Only sales exec/admin can approve a work request' using errcode = '42501';
  end if;
  if not v_approve and v_reason is null then
    raise exception 'reject_reason is required to reject a request' using errcode = '22023';
  end if;

  update public.sales_work_requests set
    status = case when v_approve then 'new' else 'rejected' end,
    rejected_at_approval = not v_approve,
    reject_reason = case when v_approve then reject_reason else v_reason end,
    approved_by = v_uid,
    approved_at = now()
  where id = p_id and status = 'pending_approval'
  returning requested_by, status into v_requested_by, v_status;

  if not found then
    raise exception 'Request not found or not waiting for approval' using errcode = '22023';
  end if;

  if v_approve then
    insert into public.notifications (recipient_id, sales_work_request_id, type)
    select p.id, p_id, 'work_request_new'
    from public.profiles p
    where p.role in ('admin','pm','foreman');
  end if;
  if v_requested_by is not null and v_requested_by <> v_uid then
    insert into public.notifications (recipient_id, sales_work_request_id, type)
    values (v_requested_by, p_id, case when v_approve then 'work_request_approved' else 'work_request_rejected' end);
  end if;

  return jsonb_build_object('id', p_id, 'status', v_status);
end;
$$;

revoke all on function public.sales_work_request_approve(uuid, jsonb) from public;
revoke all on function public.sales_work_request_approve(uuid, jsonb) from anon;
grant execute on function public.sales_work_request_approve(uuid, jsonb) to authenticated;

-- Construction status changes (restated in full): now refuses requests that
-- are still waiting for, or were turned down at, sales approval.
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
    and status <> 'pending_approval'
    and not rejected_at_approval
  returning requested_by into v_requested_by;

  if not found then
    raise exception 'Work request not found or not yet approved by sales' using errcode = '22023';
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
