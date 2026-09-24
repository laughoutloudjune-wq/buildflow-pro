-- Handover plan Phase 7 cleanup: L-02 (pin search_path), L-04 (drop the
-- dead job_assignments.boq_id FK), L-10 (createPlot all-or-nothing), W-04
-- (mark the 288 imported POs).

-- ---------------------------------------------------------------------------
-- L-02: pin search_path on the 6 functions the advisor lists, restating each
-- in full (no other change to their bodies). Without this, a role able to
-- change the session's search_path could shadow an unqualified reference
-- inside the function with an object from another schema.
-- ---------------------------------------------------------------------------
create or replace function public._jsonb_to_text_array(v jsonb)
 returns text[]
 language sql
 immutable
 set search_path = 'public'
as $function$
  select case
    when v is null or jsonb_typeof(v) <> 'array' then null
    else (select array_agg(value) from jsonb_array_elements_text(v))
  end;
$function$;

create or replace function public._jsonb_to_uuid(v jsonb)
 returns uuid
 language sql
 immutable
 set search_path = 'public'
as $function$
  select case
    when v is null then null
    when jsonb_typeof(v) = 'null' then null
    when v #>> '{}' is null or v #>> '{}' = '' then null
    else (v #>> '{}')::uuid
  end;
$function$;

create or replace function public._profiles_guard_role_change()
 returns trigger
 language plpgsql
 set search_path = 'public'
as $function$
begin
  if new.role is distinct from old.role and public._billing_current_role() <> 'admin' then
    raise exception 'Only admin can change user role' using errcode = '42501';
  end if;
  return new;
end;
$function$;

create or replace function public.set_profile_updated_at()
 returns trigger
 language plpgsql
 set search_path = 'public'
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.get_sales_board(p_project_id uuid)
 returns TABLE(plot_id uuid, plot_name text, plot_group_id uuid, plot_group_name text, house_model_name text, list_price numeric, land_area_sqwa numeric, sale_id uuid, status_code text, status_label text, status_color text, stage text, customer_id uuid, customer_name text, sales_rep_name text, sale_price numeric, booked_at date, contract_at date, inspection_at date, transfer_at date, delivered_at date, status_updated_at timestamp with time zone, jobs_total integer, jobs_done integer, progress_percent numeric)
 language sql
 stable
 set search_path = 'public'
as $function$
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
    ps.updated_at as status_updated_at,
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
$function$;

create or replace function public.get_sales_dashboard(p_project_id uuid DEFAULT NULL::uuid)
 returns jsonb
 language sql
 stable
 set search_path = 'public'
as $function$
  with sale_base as (
    select
      p.id as plot_id,
      p.project_id,
      pr.name as project_name,
      p.list_price,
      coalesce(hm.name, 'ไม่ระบุแบบ') as house_model_name,
      ps.id as sale_id,
      ps.status_code,
      ps.sale_price,
      ps.sales_rep_id,
      rep.full_name as rep_name,
      coalesce(st.stage, 'open') as stage,
      coalesce(st.label, 'ว่าง') as status_label,
      coalesce(st.color, 'slate') as status_color,
      coalesce(st.sort_order, 10) as sort_order
    from public.plots p
    join public.projects pr on pr.id = p.project_id
    left join public.house_models hm on hm.id = p.house_model_id
    left join public.plot_sales ps on ps.plot_id = p.id and ps.cancelled_at is null
    left join public.sale_statuses st on st.code = coalesce(ps.status_code, 'available')
    left join public.profiles rep on rep.id = ps.sales_rep_id
    where p.is_sellable = true
      and (p_project_id is null or p.project_id = p_project_id)
  ),
  totals as (
    select
      count(*) as total_plots,
      count(*) filter (where stage = 'open') as available_count,
      count(*) filter (where stage in ('reserved','contracted','closing')) as in_progress_count,
      count(*) filter (where stage = 'closed') as sold_count,
      count(*) filter (where stage = 'lost') as lost_count,
      coalesce(sum(list_price), 0) as total_inventory_value,
      coalesce(sum(coalesce(sale_price, list_price, 0)) filter (where stage not in ('open', 'lost')), 0) as total_deal_value
    from sale_base
  ),
  by_status as (
    select status_code, status_label, status_color, sort_order,
      count(*) as n,
      coalesce(sum(coalesce(sale_price, list_price, 0)), 0) as value
    from sale_base
    group by status_code, status_label, status_color, sort_order
  ),
  by_project as (
    select project_name,
      count(*) as total,
      count(*) filter (where stage = 'closed') as sold,
      coalesce(sum(coalesce(sale_price, list_price, 0)) filter (where stage not in ('open', 'lost')), 0) as value
    from sale_base
    group by project_name
  ),
  by_model as (
    select house_model_name,
      count(*) as total,
      count(*) filter (where stage = 'closed') as sold
    from sale_base
    group by house_model_name
  ),
  by_rep as (
    select rep_name,
      count(*) as deals,
      coalesce(sum(coalesce(sale_price, list_price, 0)), 0) as value
    from sale_base
    where rep_name is not null and stage not in ('open', 'lost')
    group by rep_name
  ),
  payments as (
    select
      coalesce(sum(sp.amount_paid) filter (where sp.paid_at is not null), 0) as collected,
      coalesce(sum(sp.amount_due) filter (where sp.paid_at is null), 0) as outstanding,
      coalesce(sum(sp.amount_due) filter (where sp.paid_at is null and sp.due_date < current_date), 0) as overdue_amount,
      count(*) filter (where sp.paid_at is null and sp.due_date < current_date) as overdue_count
    from public.sale_payments sp
    join public.plot_sales ps on ps.id = sp.plot_sale_id and ps.cancelled_at is null
    join public.plots p on p.id = ps.plot_id
    where sp.voided_at is null
      and (p_project_id is null or p.project_id = p_project_id)
  )
  select jsonb_build_object(
    'totals', (select row_to_json(t) from totals t),
    'byStatus', (select coalesce(jsonb_agg(row_to_json(s) order by s.sort_order), '[]'::jsonb) from by_status s),
    'byProject', (select coalesce(jsonb_agg(row_to_json(pj) order by pj.value desc), '[]'::jsonb) from by_project pj),
    'byModel', (select coalesce(jsonb_agg(row_to_json(m) order by m.sold desc), '[]'::jsonb) from by_model m),
    'byRep', (select coalesce(jsonb_agg(row_to_json(r) order by r.value desc), '[]'::jsonb) from by_rep r),
    'payments', (select row_to_json(pm) from payments pm)
  );
$function$;

-- ---------------------------------------------------------------------------
-- L-04: job_assignments carried two FKs to boq_master on two different
-- columns - the live boq_item_id (CASCADE, still used everywhere) and a
-- dead boq_id (NO ACTION, 0 non-null values across all 1386 rows, no app
-- code reference). Drops the dead one; boq_item_id's CASCADE is unchanged
-- (M-12's app-layer guard above is the fix for that, not this FK).
-- ---------------------------------------------------------------------------
alter table public.job_assignments drop constraint job_assignments_boq_id_fkey;

-- ---------------------------------------------------------------------------
-- L-10: createPlot did insert-plot-then-insert-jobs as two separate
-- round trips from the app - a failure between them left a plot with no
-- jobs (or half its jobs), with no way to tell from the UI that anything
-- went wrong. plot_create() does both in one function call, so a failure
-- anywhere rolls back the whole thing automatically.
-- ---------------------------------------------------------------------------
create or replace function public.plot_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_role text := _billing_current_role();
  v_project_id uuid := (p_payload->>'project_id')::uuid;
  v_house_model_id uuid := (p_payload->>'house_model_id')::uuid;
  v_name text := p_payload->>'name';
  v_source_plot_id uuid := _jsonb_to_uuid(p_payload->'source_plot_id');
  v_plot_id uuid;
  v_source_project_id uuid;
  v_source_house_model_id uuid;
begin
  if v_role not in ('admin','pm','foreman') then
    raise exception 'Only PM/Admin/Foreman can create a plot' using errcode = '42501';
  end if;
  if v_name is null or trim(v_name) = '' or v_house_model_id is null then
    raise exception 'กรุณากรอกชื่อแปลงและเลือกแบบบ้าน' using errcode = '22023';
  end if;

  -- M-07 guard (future only): a source plot from a different project/house
  -- model is exactly how the Arada Vela/Prime mismatch happened.
  if v_source_plot_id is not null then
    select project_id, house_model_id into v_source_project_id, v_source_house_model_id
    from plots where id = v_source_plot_id;
    if v_source_project_id is null then
      raise exception 'ไม่พบแปลงต้นทางที่เลือก' using errcode = 'P0002';
    end if;
    if v_source_project_id is distinct from v_project_id or v_source_house_model_id is distinct from v_house_model_id then
      raise exception 'คัดลอกงานได้เฉพาะจากแปลงในโครงการเดียวกันที่ใช้แบบบ้านเดียวกันเท่านั้น' using errcode = '22023';
    end if;
  end if;

  insert into plots (project_id, house_model_id, name)
  values (v_project_id, v_house_model_id, v_name)
  returning id into v_plot_id;

  if v_source_plot_id is not null then
    -- Copy an existing plot's jobs (and their assigned contractor).
    insert into job_assignments (plot_id, boq_item_id, contractor_id, status)
    select v_plot_id, ja.boq_item_id, ja.contractor_id, 'pending'
    from job_assignments ja
    where ja.plot_id = v_source_plot_id and ja.boq_item_id is not null;
  else
    -- Generate from the house model's BOQ template.
    insert into job_assignments (plot_id, boq_item_id, status)
    select v_plot_id, bm.id, 'pending'
    from boq_master bm
    where bm.house_model_id = v_house_model_id;
  end if;

  return jsonb_build_object('id', v_plot_id);
end;
$function$;

revoke all on function public.plot_create(jsonb) from public;
grant execute on function public.plot_create(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- W-04: flags the 288 POs imported from the old system (identifiable by
-- their note) so reports can filter them in or out on purpose, instead of
-- guessing from the note text. Nothing else about those rows changes.
-- ---------------------------------------------------------------------------
alter table public.purchase_orders add column if not exists is_imported boolean not null default false;
update public.purchase_orders set is_imported = true where note like 'นำเข้าจากระบบเดิม%';
