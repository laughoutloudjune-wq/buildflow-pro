-- Adds plot_sales.updated_at to get_sales_board's result, needed for the
-- board's "ค้างเกิน N วัน" filter (SALES_MODULE_PLAN.md §8.2) - days since the
-- deal's status last changed. sales_change_status() already bumps updated_at
-- on every transition, so this is free to compute, no new column needed.
--
-- Postgres won't let CREATE OR REPLACE add a column to an existing function's
-- return table, so this drops and recreates it (same day as 202609180003,
-- before anything depends on the old shape).
drop function if exists public.get_sales_board(uuid);

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
  status_updated_at timestamptz,
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
$$;

revoke all on function public.get_sales_board(uuid) from public;
revoke all on function public.get_sales_board(uuid) from anon;
grant execute on function public.get_sales_board(uuid) to authenticated;
