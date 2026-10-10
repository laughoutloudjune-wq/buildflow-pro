-- Project-level construction progress for the projects list: value-weighted
-- (BOQ price x quantity) average of each job's latest approved progress %,
-- counting jobs with no approved claim as 0%. Read-only, invoker rights so
-- RLS applies exactly as for the underlying tables.
create or replace function public.get_projects_progress()
returns table (
  project_id uuid,
  plots_with_jobs int,
  jobs_total int,
  jobs_done int,
  progress_percent numeric
)
language sql stable
set search_path = public
as $$
  with latest as (
    select distinct on (bj.job_assignment_id)
      bj.job_assignment_id,
      bj.progress_percent
    from public.billing_jobs bj
    join public.billings b on b.id = bj.billing_id and b.status in ('approved', 'paid_out')
    order by bj.job_assignment_id, b.created_at desc
  ),
  jobs as (
    select
      pl.project_id,
      ja.plot_id,
      ja.status,
      coalesce(ja.agreed_price_per_unit, bm.price_per_unit, 0) * coalesce(bm.quantity, 0) as weight,
      coalesce(l.progress_percent, 0) as pct
    from public.job_assignments ja
    join public.plots pl on pl.id = ja.plot_id
    left join public.boq_master bm on bm.id = ja.boq_item_id
    left join latest l on l.job_assignment_id = ja.id
  )
  select
    j.project_id,
    count(distinct j.plot_id)::int,
    count(*)::int,
    (count(*) filter (where j.status = 'completed'))::int,
    coalesce(sum(j.weight * j.pct) / nullif(sum(j.weight), 0), 0)
  from jobs j
  group by j.project_id;
$$;

revoke all on function public.get_projects_progress() from public, anon;
grant execute on function public.get_projects_progress() to authenticated;
