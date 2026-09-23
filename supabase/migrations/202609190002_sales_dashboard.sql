-- Sales dashboard (one aggregate RPC per screen, same reasoning as
-- get_sales_board - a dashboard is the worst case for "several small
-- PostgREST fetches" since every widget would otherwise be its own round
-- trip). p_project_id null means "all projects combined".
create or replace function get_sales_dashboard(p_project_id uuid default null)
returns jsonb
language sql
stable
as $$
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
    where p_project_id is null or p.project_id = p_project_id
  )
  select jsonb_build_object(
    'totals', (select row_to_json(t) from totals t),
    'byStatus', (select coalesce(jsonb_agg(row_to_json(s) order by s.sort_order), '[]'::jsonb) from by_status s),
    'byProject', (select coalesce(jsonb_agg(row_to_json(pj) order by pj.value desc), '[]'::jsonb) from by_project pj),
    'byModel', (select coalesce(jsonb_agg(row_to_json(m) order by m.sold desc), '[]'::jsonb) from by_model m),
    'byRep', (select coalesce(jsonb_agg(row_to_json(r) order by r.value desc), '[]'::jsonb) from by_rep r),
    'payments', (select row_to_json(pm) from payments pm)
  );
$$;
