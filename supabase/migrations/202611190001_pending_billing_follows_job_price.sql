-- A pending (pending_review) progress request stores an amount snapshot taken
-- when it was sent. When a job's price (or its BOQ line price/quantity) is
-- corrected afterwards, keep those pending requests in step so the list,
-- print and PM review all show the same, current total. Approved/paid bills
-- are never touched. No DROP/DELETE statements.

create or replace function public.billing_resync_pending_for_jobs(p_job_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_job_ids is null or array_length(p_job_ids, 1) is null then
    return;
  end if;

  create temp table if not exists _bj_fix (billing_id uuid, bj_id uuid, new_amount numeric) on commit drop;
  truncate _bj_fix;

  insert into _bj_fix (billing_id, bj_id, new_amount)
  select b.id, bj.id, f.fresh
  from billing_jobs bj
  join billings b on b.id = bj.billing_id
  join job_assignments ja on ja.id = bj.job_assignment_id
  join boq_master bm on bm.id = ja.boq_item_id
  cross join lateral (
    select
      coalesce(bm.quantity, 0) * coalesce(ja.agreed_price_per_unit, bm.price_per_unit, 0) as total_boq,
      coalesce((select sum(p.amount) from payments p where p.job_assignment_id = ja.id), 0) as paid
  ) t
  cross join lateral (
    select greatest(0, t.total_boq * bj.progress_percent / 100 - t.paid) as fresh
  ) f
  where bj.job_assignment_id = any (p_job_ids)
    and b.status = 'pending_review'
    and b.type = 'progress'
    and bj.progress_percent is not null
    -- ignore rounding noise from a 2-decimal percent
    and abs(f.fresh - bj.amount) > greatest(1, t.total_boq * 0.00005 + 0.01);

  update billing_jobs bj set amount = x.new_amount
  from _bj_fix x where x.bj_id = bj.id;

  update billings b
  set total_work_amount = s.work,
      net_amount = s.work + coalesce(b.total_add_amount, 0) - coalesce(b.total_deduct_amount, 0)
  from (
    select bj.billing_id, sum(bj.amount) as work
    from billing_jobs bj
    where bj.billing_id in (select billing_id from _bj_fix)
    group by bj.billing_id
  ) s
  where s.billing_id = b.id;
end;
$$;

revoke all on function public.billing_resync_pending_for_jobs(uuid[]) from public, anon, authenticated;

create or replace function public.tr_job_price_resync_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.billing_resync_pending_for_jobs(array[new.id]);
  return new;
end;
$$;

create or replace function public.tr_boq_price_resync_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.billing_resync_pending_for_jobs(
    array(select id from job_assignments where boq_item_id = new.id)
  );
  return new;
end;
$$;

revoke all on function public.tr_job_price_resync_pending() from public, anon, authenticated;
revoke all on function public.tr_boq_price_resync_pending() from public, anon, authenticated;

create or replace trigger job_price_resync_pending
  after update of agreed_price_per_unit on public.job_assignments
  for each row
  when (old.agreed_price_per_unit is distinct from new.agreed_price_per_unit)
  execute function public.tr_job_price_resync_pending();

create or replace trigger boq_price_resync_pending
  after update of price_per_unit, quantity on public.boq_master
  for each row
  when (old.price_per_unit is distinct from new.price_per_unit or old.quantity is distinct from new.quantity)
  execute function public.tr_boq_price_resync_pending();
