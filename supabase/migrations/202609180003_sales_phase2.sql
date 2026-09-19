-- Sales module, Phase 2 (SALES_MODULE_PLAN.md §7.2-7.5, §8.2, Phase 2).
--
-- The sales data model: a status catalogue, customers, the deal itself
-- (plot_sales), and its audit timeline (plot_sale_events) - plus the one RPC
-- that loads the whole board in a single round trip and the one RPC that
-- writes a status change atomically (deal row + event row together, so the
-- two can never drift out of sync the way a two-step client write could).
--
-- RLS on all four tables is scoped to admin/pm/sales from the start -
-- deliberately NOT the "Allow all" shape billings/billing_jobs/billing_adjustments
-- still carry (202609140001_billing_anon_revoke.sql). customers in particular
-- holds ID-card numbers and phone numbers.

-- ---------------------------------------------------------------------------
-- sale_statuses: code is the stable identifier logic keys off; label/color
-- are admin-editable (D3) without touching code, but every row must declare
-- a stage so reports can group statuses invented after this migration ships.
create table public.sale_statuses (
  code        text primary key,
  label       text not null,
  color       text not null,
  stage       text not null check (stage in ('open','reserved','contracted','closing','closed','lost')),
  sort_order  int  not null,
  is_active   boolean not null default true
);

insert into public.sale_statuses (code, label, color, stage, sort_order) values
  ('available',            'ว่าง',                 'slate',   'open',       10),
  ('on_hold',               'ล็อกไว้',               'zinc',    'open',       20),
  ('reserved',              'จอง',                  'amber',   'reserved',   30),
  ('contracted',            'ทำสัญญา',               'blue',    'contracted', 40),
  ('loan_pending',          'ยื่นกู้ / รออนุมัติ',    'indigo',  'contracted', 50),
  ('loan_approved',         'อนุมัติสินเชื่อ',        'sky',     'contracted', 60),
  ('awaiting_inspection',   'รอตรวจบ้าน',            'orange',  'closing',    70),
  ('defect_fixing',         'แก้ Defect',            'rose',    'closing',    80),
  ('awaiting_transfer',     'รอโอน',                 'violet',  'closing',    90),
  ('transferred',           'โอนแล้ว',               'emerald', 'closed',     100),
  ('cancelled',             'ยกเลิก',                'red',     'lost',       110);

alter table public.sale_statuses enable row level security;

create policy "sale_statuses_select"
  on public.sale_statuses for select to authenticated
  using (public._billing_current_role() in ('admin','pm','sales'));

-- D3: admin can add/rename/recolour; nobody else may touch the catalogue.
create policy "sale_statuses_write"
  on public.sale_statuses for all to authenticated
  using (public._billing_current_role() = 'admin')
  with check (public._billing_current_role() = 'admin');

grant select, insert, update on public.sale_statuses to authenticated;
revoke all on public.sale_statuses from anon;

-- ---------------------------------------------------------------------------
-- customers: PII (id_card, phone) - readable/writable only by sales/pm/admin,
-- never foreman or anon (§6).
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  phone       text,
  email       text,
  id_card     text,
  address     text,
  lead_source text,
  note        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

alter table public.customers enable row level security;

create policy "customers_select"
  on public.customers for select to authenticated
  using (public._billing_current_role() in ('admin','pm','sales'));

create policy "customers_write"
  on public.customers for all to authenticated
  using (public._billing_current_role() in ('admin','pm','sales'))
  with check (public._billing_current_role() in ('admin','pm','sales'));

grant select, insert, update on public.customers to authenticated;
revoke all on public.customers from anon;

-- ---------------------------------------------------------------------------
-- plot_sales: the deal. One physical house = one plots row = one live deal -
-- bookings get cancelled and plots get re-sold, so this is its own table
-- with a partial unique index rather than a status column on plots, which
-- would throw away the previous customer the moment a plot is re-sold.
create table public.plot_sales (
  id              uuid primary key default gen_random_uuid(),
  plot_id         uuid not null references public.plots(id) on delete cascade,
  customer_id     uuid references public.customers(id),
  status_code     text not null references public.sale_statuses(code),
  sales_rep_id    uuid references public.profiles(id),

  list_price      numeric,
  sale_price      numeric,
  discount_note   text,
  booking_amount  numeric,
  contract_amount numeric,
  down_total      numeric,
  loan_bank       text,
  loan_amount     numeric,

  booked_at          date,
  contract_at        date,
  loan_submitted_at  date,
  loan_approved_at   date,
  inspection_at      date,
  transfer_at        date,
  delivered_at       date,
  cancelled_at       date,
  cancel_reason      text,

  note        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index plot_sales_one_live_per_plot
  on public.plot_sales(plot_id) where cancelled_at is null;
-- Full history (including cancelled deals) still needs a plain lookup by plot.
create index plot_sales_plot_id_idx on public.plot_sales(plot_id);

alter table public.plot_sales enable row level security;

create policy "plot_sales_select"
  on public.plot_sales for select to authenticated
  using (public._billing_current_role() in ('admin','pm','sales'));

create policy "plot_sales_write"
  on public.plot_sales for all to authenticated
  using (public._billing_current_role() in ('admin','pm','sales'))
  with check (public._billing_current_role() in ('admin','pm','sales'));

grant select, insert, update on public.plot_sales to authenticated;
revoke all on public.plot_sales from anon;

-- ---------------------------------------------------------------------------
-- plot_sale_events: append-only audit trail. Dates on plot_sales are what
-- reports filter on and must stay editable (a sale is usually entered after
-- the fact); this is "who changed what, when", which editable dates can
-- never be - so both are kept, not one or the other.
create table public.plot_sale_events (
  id              uuid primary key default gen_random_uuid(),
  plot_sale_id    uuid not null references public.plot_sales(id) on delete cascade,
  event_type      text not null,
  from_status     text,
  to_status       text,
  happened_at     timestamptz not null default now(),
  actor_id        uuid references public.profiles(id),
  note            text,
  attachment_urls text[]
);

create index plot_sale_events_plot_sale_id_idx on public.plot_sale_events(plot_sale_id);

alter table public.plot_sale_events enable row level security;

create policy "plot_sale_events_select"
  on public.plot_sale_events for select to authenticated
  using (public._billing_current_role() in ('admin','pm','sales'));

-- Insert-only: an audit trail that could be edited or deleted by the same
-- roles it's supposed to be keeping honest isn't an audit trail.
create policy "plot_sale_events_insert"
  on public.plot_sale_events for insert to authenticated
  with check (public._billing_current_role() in ('admin','pm','sales'));

grant select, insert on public.plot_sale_events to authenticated;
revoke all on public.plot_sale_events from anon;

-- ---------------------------------------------------------------------------
-- get_sales_board: every plot in a project plus its live deal (if any) and
-- construction progress, in one round trip (PERF_HANDOFF.md - latency here
-- is round trips, not query cost). Not security definer: it runs as the
-- caller, so RLS on plot_sales/customers/sale_statuses is still the real
-- authority on who sees deal data, exactly like boq_control_rollup does for
-- cost data.
--
-- progress_percent: money-weighted from the latest approved-billing progress
-- per job_assignment, weighted by coalesce(agreed_price_per_unit,
-- price_per_unit) * quantity - same effective-price rule as
-- PlotDetailPageClient's getJobFinancials(). Falls back to jobs_done/jobs_total
-- for a plot with no billing history at all yet (most plots, per
-- SALES_MODULE_PLAN.md §4: only 268 billing_jobs rows across ~90 plots).
create or replace function public.get_sales_board(p_project_id uuid)
returns table (
  plot_id           uuid,
  plot_name         text,
  plot_group_id     uuid,
  plot_group_name   text,
  house_model_name  text,
  list_price        numeric,
  land_area_sqwa    numeric,
  sale_id           uuid,
  status_code       text,
  status_label      text,
  status_color      text,
  stage             text,
  customer_id       uuid,
  customer_name     text,
  sales_rep_name    text,
  sale_price        numeric,
  booked_at         date,
  contract_at       date,
  inspection_at     date,
  transfer_at       date,
  delivered_at      date,
  jobs_total        int,
  jobs_done         int,
  progress_percent  numeric
)
language sql stable as $$
  with job_stats as (
    select
      ja.plot_id,
      count(*) as jobs_total,
      count(*) filter (where ja.status = 'completed') as jobs_done
    from public.job_assignments ja
    join public.plots pl on pl.id = ja.plot_id
    where pl.project_id = p_project_id
    group by ja.plot_id
  ),
  job_weighted as (
    select distinct on (bj.job_assignment_id)
      ja.plot_id,
      coalesce(ja.agreed_price_per_unit, bm.price_per_unit, 0) * coalesce(bm.quantity, 0) as weight,
      bj.progress_percent
    from public.billing_jobs bj
    join public.billings b on b.id = bj.billing_id and b.status = 'approved'
    join public.job_assignments ja on ja.id = bj.job_assignment_id
    join public.plots pl on pl.id = ja.plot_id and pl.project_id = p_project_id
    join public.boq_master bm on bm.id = ja.boq_item_id
    order by bj.job_assignment_id, b.created_at desc
  ),
  plot_progress as (
    select
      plot_id,
      sum(weight * coalesce(progress_percent, 0)) / nullif(sum(weight), 0) as weighted_percent
    from job_weighted
    where weight > 0
    group by plot_id
  )
  select
    p.id as plot_id,
    p.name as plot_name,
    pg.id as plot_group_id,
    pg.name as plot_group_name,
    hm.name as house_model_name,
    p.list_price,
    p.land_area_sqwa,
    ps.id as sale_id,
    coalesce(ps.status_code, 'available') as status_code,
    coalesce(st.label, st_avail.label) as status_label,
    coalesce(st.color, st_avail.color) as status_color,
    coalesce(st.stage, st_avail.stage) as stage,
    c.id as customer_id,
    c.full_name as customer_name,
    rep.full_name as sales_rep_name,
    ps.sale_price,
    ps.booked_at,
    ps.contract_at,
    ps.inspection_at,
    ps.transfer_at,
    ps.delivered_at,
    coalesce(js.jobs_total, 0) as jobs_total,
    coalesce(js.jobs_done, 0) as jobs_done,
    coalesce(
      pp.weighted_percent,
      case when coalesce(js.jobs_total, 0) > 0 then js.jobs_done::numeric / js.jobs_total * 100 else 0 end
    ) as progress_percent
  from public.plots p
  left join lateral (
    select g.id, g.name
    from public.plot_group_members m
    join public.plot_groups g on g.id = m.group_id
    where m.plot_id = p.id
    order by g.name
    limit 1
  ) pg on true
  left join public.house_models hm on hm.id = p.house_model_id
  left join public.plot_sales ps on ps.plot_id = p.id and ps.cancelled_at is null
  left join public.sale_statuses st on st.code = ps.status_code
  left join public.sale_statuses st_avail on st_avail.code = 'available'
  left join public.customers c on c.id = ps.customer_id
  left join public.profiles rep on rep.id = ps.sales_rep_id
  left join job_stats js on js.plot_id = p.id
  left join plot_progress pp on pp.plot_id = p.id
  where p.project_id = p_project_id and p.is_sellable = true
  order by p.name;
$$;

revoke all on function public.get_sales_board(uuid) from public;
revoke all on function public.get_sales_board(uuid) from anon;
grant execute on function public.get_sales_board(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- sales_change_status: the one write path for moving a plot through the
-- pipeline. Finds-or-creates the plot's live deal and always appends a
-- plot_sale_events row in the same transaction, so the deal's current status
-- and its audit trail can never drift apart the way two separate client-side
-- writes could. Marking a plot 'cancelled' also stamps cancelled_at, which is
-- what frees the plot for a fresh deal under the partial unique index.
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
  if v_role not in ('admin','pm','sales') then
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
