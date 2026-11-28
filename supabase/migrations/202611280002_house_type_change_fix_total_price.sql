-- Follow-up to 202611280001 (safe to run on top of it; replaces functions only, no data is touched):
--  1. boq_master.total_price is a generated column: copying a BOQ line must not insert it (this was
--     the error every plot hit).
--  2. "Check without saving": the plan may carry dry_run=true. The function then does everything for
--     real (all constraints, triggers, money check) and rolls back with the message DRY_RUN_OK.
--  3. Jobs without a BOQ line are not required in the plan; weekly-plan title refresh can no longer
--     fail a move.

create or replace function public._htc_copy_line(
  p_new_model uuid,
  p_source uuid,
  p_price numeric,
  p_plot_id uuid,
  out line_id uuid,
  out created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src boq_master;
  v_price numeric;
begin
  select * into v_src from boq_master where id = p_source;
  if not found then
    raise exception 'ไม่พบรายการ BOQ ต้นทาง' using errcode = 'P0002';
  end if;
  v_price := coalesce(p_price, v_src.price_per_unit);

  select bm.id into line_id
  from boq_master bm
  where bm.house_model_id = p_new_model
    and bm.item_name = v_src.item_name
    and bm.unit is not distinct from v_src.unit
    and bm.quantity is not distinct from v_src.quantity
    and bm.price_per_unit is not distinct from v_price
    and not exists (select 1 from job_assignments ja where ja.plot_id = p_plot_id and ja.boq_item_id = bm.id)
  order by bm.created_at, bm.id
  limit 1;
  if line_id is not null then
    created := false;
    return;
  end if;

  -- total_price is a generated column (price_per_unit * quantity): never insert it.
  insert into boq_master (project_id, contractor_type_id, house_model_id, item_name, price, unit, description, price_per_unit, quantity)
  values (v_src.project_id, v_src.contractor_type_id, p_new_model, v_src.item_name, v_src.price, v_src.unit, v_src.description,
          v_price, v_src.quantity)
  returning id into line_id;

  insert into boq_material_items (boq_id, material_type_id, planned_quantity, waste_percent)
  select line_id, mi.material_type_id, mi.planned_quantity, mi.waste_percent
  from boq_material_items mi
  where mi.boq_id = p_source;

  created := true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Apply the change to ONE plot (all-or-nothing: any exception rolls it back).
--
-- p_plan = {
--   plot_id, new_house_model_id,
--   dry_run?: true = do everything, run the money check, then roll back (message DRY_RUN_OK),
--   moves:    [{ job_id, target_boq_id | copy_from_boq_id, accept_new_qty? }],
--   new_jobs: [{ boq_id | copy_from_boq_id }]   -- lines to give a job with no contractor
-- }
-- Every existing job of the plot must appear once in moves.
-- ---------------------------------------------------------------------------
create or replace function public.house_type_change_apply(p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plot plots;
  v_new_model uuid := (p_plan->>'new_house_model_id')::uuid;
  v_new_model_project uuid;
  v_move jsonb;
  v_job job_assignments;
  v_old_line boq_master;
  v_target uuid;
  v_copy record;
  v_eff numeric;
  v_before jsonb;
  v_after jsonb;
  v_diffs jsonb;
  v_backup jsonb;
  v_created_boq uuid[] := '{}';
  v_created_jobs uuid[] := '{}';
  v_used_copy uuid[] := '{}';
  v_accepted uuid[] := '{}';
  v_moved uuid[] := '{}';
  v_seen uuid[] := '{}';
  v_nj jsonb;
  v_run_id uuid;
  v_job_count int;
  v_moves_count int;
begin
  if v_uid is null or public._billing_current_role() <> 'admin' then
    raise exception 'เฉพาะแอดมินเท่านั้นที่เปลี่ยนแบบบ้านได้' using errcode = '42501';
  end if;

  select * into v_plot from plots where id = (p_plan->>'plot_id')::uuid for update;
  if not found then
    raise exception 'ไม่พบแปลง' using errcode = 'P0002';
  end if;
  if v_new_model is null then
    raise exception 'ยังไม่ได้เลือกแบบบ้านใหม่' using errcode = '22023';
  end if;
  if v_plot.house_model_id is not distinct from v_new_model then
    raise exception 'แปลงนี้ใช้แบบบ้านนี้อยู่แล้ว' using errcode = '22023';
  end if;
  select project_id into v_new_model_project from house_models where id = v_new_model;
  if not found then
    raise exception 'ไม่พบแบบบ้านใหม่' using errcode = 'P0002';
  end if;
  if v_new_model_project is not null and v_new_model_project is distinct from v_plot.project_id then
    raise exception 'แบบบ้านใหม่ต้องอยู่ในโครงการเดียวกับแปลง' using errcode = '22023';
  end if;

  -- Every job must have exactly one move.
  -- jobs with no BOQ line at all (should not exist) carry no contract and stay as they are
  select count(*) into v_job_count from job_assignments where plot_id = v_plot.id and boq_item_id is not null;
  v_moves_count := coalesce(jsonb_array_length(p_plan->'moves'), 0);
  if v_job_count <> v_moves_count then
    raise exception 'แผนไม่ครบ: แปลงมี % งาน แต่แผนระบุ % งาน', v_job_count, v_moves_count using errcode = '22023';
  end if;

  v_before := public._htc_money(v_plot.id);

  -- Backup first (everything the move can touch, plus bills/payments for reference).
  v_backup := jsonb_build_object(
    'plot', jsonb_build_object('id', v_plot.id, 'house_model_id', v_plot.house_model_id),
    'jobs', coalesce((select jsonb_agg(to_jsonb(ja)) from job_assignments ja where ja.plot_id = v_plot.id), '[]'::jsonb),
    'billing_jobs', coalesce((select jsonb_agg(to_jsonb(bj)) from billing_jobs bj
                              join job_assignments ja on ja.id = bj.job_assignment_id where ja.plot_id = v_plot.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p)) from payments p
                          join job_assignments ja on ja.id = p.job_assignment_id where ja.plot_id = v_plot.id), '[]'::jsonb),
    'weekly_plan_items', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'job_assignment_id', w.job_assignment_id))
                                   from weekly_plan_items w
                                   join job_assignments ja on ja.id = w.job_assignment_id where ja.plot_id = v_plot.id), '[]'::jsonb)
  );

  -- Pin each job's old price first (same effective value, so nothing resyncs),
  -- then move it to its new line.
  for v_move in select * from jsonb_array_elements(coalesce(p_plan->'moves', '[]'::jsonb)) loop
    select * into v_job from job_assignments
      where id = (v_move->>'job_id')::uuid and plot_id = v_plot.id for update;
    if not found then
      raise exception 'งาน % ไม่ใช่ของแปลงนี้', v_move->>'job_id' using errcode = '22023';
    end if;
    if v_job.id = any (v_seen) then
      raise exception 'งานซ้ำในแผน' using errcode = '22023';
    end if;
    v_seen := v_seen || v_job.id;

    select * into v_old_line from boq_master where id = v_job.boq_item_id;
    v_eff := coalesce(v_job.agreed_price_per_unit, v_old_line.price_per_unit);

    if (v_move->>'target_boq_id') is not null then
      v_target := (v_move->>'target_boq_id')::uuid;
      if not exists (select 1 from boq_master where id = v_target and house_model_id = v_new_model) then
        raise exception 'รายการปลายทางไม่ได้อยู่ในแบบบ้านใหม่' using errcode = '22023';
      end if;
    elsif (v_move->>'copy_from_boq_id') is not null then
      select * into v_copy from public._htc_copy_line(v_new_model, (v_move->>'copy_from_boq_id')::uuid, v_eff, v_plot.id);
      v_target := v_copy.line_id;
      v_used_copy := v_used_copy || v_target;
      if v_copy.created then v_created_boq := v_created_boq || v_target; end if;
    else
      raise exception 'งาน % ยังไม่ได้ระบุรายการปลายทาง', v_job.id using errcode = '22023';
    end if;

    if exists (select 1 from job_assignments x where x.plot_id = v_plot.id and x.boq_item_id = v_target and x.id <> v_job.id and x.id = any (v_moved)) then
      raise exception 'มีสองงานชี้ไปรายการ BOQ เดียวกัน' using errcode = '22023';
    end if;

    if v_job.agreed_price_per_unit is null and v_eff is not null then
      update job_assignments set agreed_price_per_unit = v_eff where id = v_job.id;
    end if;
    update job_assignments set boq_item_id = v_target where id = v_job.id;
    v_moved := v_moved || v_job.id;
    if coalesce((v_move->>'accept_new_qty')::boolean, false) then
      v_accepted := v_accepted || v_job.id;
    end if;
  end loop;

  -- Lines of the new type the plot has no job for: a job with no contractor.
  for v_nj in select * from jsonb_array_elements(coalesce(p_plan->'new_jobs', '[]'::jsonb)) loop
    if (v_nj->>'boq_id') is not null then
      v_target := (v_nj->>'boq_id')::uuid;
      if not exists (select 1 from boq_master where id = v_target and house_model_id = v_new_model) then
        raise exception 'รายการปลายทางไม่ได้อยู่ในแบบบ้านใหม่' using errcode = '22023';
      end if;
    elsif (v_nj->>'copy_from_boq_id') is not null then
      select * into v_copy from public._htc_copy_line(v_new_model, (v_nj->>'copy_from_boq_id')::uuid, null, v_plot.id);
      v_target := v_copy.line_id;
      v_used_copy := v_used_copy || v_target;
      if v_copy.created then v_created_boq := v_created_boq || v_target; end if;
    else
      continue;
    end if;
    if not exists (select 1 from job_assignments x where x.plot_id = v_plot.id and x.boq_item_id = v_target) then
      insert into job_assignments (plot_id, boq_item_id, status)
      values (v_plot.id, v_target, 'pending')
      returning id into v_run_id;
      v_created_jobs := v_created_jobs || v_run_id;
    end if;
  end loop;

  update plots set house_model_id = v_new_model where id = v_plot.id;

  -- Weekly plan lines stay linked (same job id); a no-op update lets the
  -- existing trigger refresh their title to the new line's name.
  -- Cosmetic only, so a future lock/validation rule on weekly plan lines must
  -- not be able to fail the whole move.
  begin
    update weekly_plan_items set job_assignment_id = job_assignment_id
    where job_assignment_id = any (v_moved);
  exception when others then
    null;
  end;

  -- Jobs whose new quantity was approved follow the current price like any
  -- pending bill does (PR #36 rule); everything else is untouched.
  if array_length(v_accepted, 1) is not null then
    perform public.billing_resync_pending_for_jobs(v_accepted);
  end if;

  v_after := public._htc_money(v_plot.id);
  v_diffs := public._htc_money_diff(v_before, v_after, v_accepted);
  if jsonb_array_length(v_diffs) > 0 then
    raise exception 'MONEY_CHECK_FAILED' using errcode = 'P0001', detail = v_diffs::text;
  end if;

  -- Dry run ("check without saving"): everything above really ran, including
  -- every constraint, trigger and the money check. Roll it all back and report.
  if coalesce((p_plan->>'dry_run')::boolean, false) then
    raise exception 'DRY_RUN_OK' using errcode = 'P0001', detail = jsonb_build_object(
      'moved', coalesce(array_length(v_moved, 1), 0),
      'copied_lines', coalesce(array_length(v_created_boq, 1), 0),
      'new_jobs', coalesce(array_length(v_created_jobs, 1), 0),
      'accepted_new_qty', coalesce(array_length(v_accepted, 1), 0),
      'paid_total', v_after->'paid_total')::text;
  end if;

  insert into house_type_change_runs (
    created_by, project_id, plot_id, old_house_model_id, new_house_model_id,
    backup, money_before, money_after, created_boq_ids, created_job_ids, used_copy_ids, summary
  ) values (
    v_uid, v_plot.project_id, v_plot.id, v_plot.house_model_id, v_new_model,
    v_backup, v_before, v_after, v_created_boq, v_created_jobs, v_used_copy,
    jsonb_build_object('moved', coalesce(array_length(v_moved, 1), 0),
                       'copied_lines', coalesce(array_length(v_created_boq, 1), 0),
                       'new_jobs', coalesce(array_length(v_created_jobs, 1), 0),
                       'accepted_new_qty', coalesce(array_length(v_accepted, 1), 0))
  ) returning id into v_run_id;

  return jsonb_build_object(
    'run_id', v_run_id,
    'plot_id', v_plot.id,
    'moved', coalesce(array_length(v_moved, 1), 0),
    'copied_lines', coalesce(array_length(v_created_boq, 1), 0),
    'new_jobs', coalesce(array_length(v_created_jobs, 1), 0),
    'paid_total', v_after->'paid_total',
    'billed_total', v_after->'billed_total'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Revert one applied run (all-or-nothing). Jobs go back to their old BOQ
-- lines and old agreed price, the plot to its old type. Jobs and BOQ copies
-- the run created are removed ONLY when still unused; anything in use is kept
-- and listed in the result. The money check runs again against the snapshot
-- taken before the run.
-- ---------------------------------------------------------------------------
create or replace function public.house_type_change_revert(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_run house_type_change_runs;
  v_plot plots;
  v_job jsonb;
  v_id uuid;
  v_kept_jobs uuid[] := '{}';
  v_kept_lines uuid[] := '{}';
  v_removed_jobs int := 0;
  v_removed_lines int := 0;
  v_restored uuid[] := '{}';
  v_after jsonb;
  v_before jsonb;
  v_diffs jsonb;
  v_bills uuid[];
begin
  if v_uid is null or public._billing_current_role() <> 'admin' then
    raise exception 'เฉพาะแอดมินเท่านั้นที่คืนค่าได้' using errcode = '42501';
  end if;

  select * into v_run from house_type_change_runs where id = p_run_id for update;
  if not found then
    raise exception 'ไม่พบรายการเปลี่ยนแบบบ้าน' using errcode = 'P0002';
  end if;
  if v_run.status <> 'applied' then
    raise exception 'รายการนี้คืนค่าไปแล้ว' using errcode = '22023';
  end if;

  select * into v_plot from plots where id = v_run.plot_id for update;
  if v_plot.house_model_id is distinct from v_run.new_house_model_id then
    raise exception 'แปลงนี้ถูกเปลี่ยนแบบบ้านอีกครั้งหลังจากนั้น คืนค่ารายการล่าสุดก่อน' using errcode = '22023';
  end if;


  -- Jobs back to their old line and old price.
  for v_job in select * from jsonb_array_elements(v_run.backup->'jobs') loop
    update job_assignments
    set boq_item_id = (v_job->>'boq_item_id')::uuid,
        agreed_price_per_unit = (v_job->>'agreed_price_per_unit')::numeric
    where id = (v_job->>'id')::uuid and plot_id = v_plot.id;
    if found then v_restored := v_restored || (v_job->>'id')::uuid; end if;
  end loop;

  update plots set house_model_id = v_run.old_house_model_id where id = v_plot.id;

  -- Titles on weekly plan lines follow the restored line again.
  begin
    update weekly_plan_items set job_assignment_id = job_assignment_id
    where job_assignment_id = any (v_restored);
  exception when others then
    null;
  end;

  -- Pending bills of jobs whose new quantity was approved were re-priced by the
  -- run; put those bill lines back to the amounts saved in the backup (only
  -- while the bill is still waiting for review) and refresh the bill totals.
  v_bills := array(
    select distinct bj.billing_id
    from billing_jobs bj
    join billings bl on bl.id = bj.billing_id and bl.status = 'pending_review'
    join jsonb_array_elements(v_run.backup->'billing_jobs') b(value) on (b.value->>'id')::uuid = bj.id
    where bj.amount is distinct from (b.value->>'amount')::numeric
  );
  update billing_jobs bj set amount = (b.value->>'amount')::numeric
  from jsonb_array_elements(v_run.backup->'billing_jobs') b(value)
  where bj.id = (b.value->>'id')::uuid
    and bj.billing_id = any (v_bills)
    and bj.amount is distinct from (b.value->>'amount')::numeric;
  update billings bl
  set total_work_amount = (select sum(j.amount) from billing_jobs j where j.billing_id = bl.id),
      net_amount = (select sum(j.amount) from billing_jobs j where j.billing_id = bl.id)
                   + coalesce(bl.total_add_amount, 0) - coalesce(bl.total_deduct_amount, 0)
  where bl.id = any (v_bills);

  -- Jobs this run created: remove only when still completely unused.
  foreach v_id in array v_run.created_job_ids loop
    if exists (select 1 from job_assignments ja where ja.id = v_id)
       and not exists (select 1 from job_assignments ja where ja.id = v_id and ja.contractor_id is not null)
       and not exists (select 1 from billing_jobs bj where bj.job_assignment_id = v_id)
       and not exists (select 1 from payments p where p.job_assignment_id = v_id)
       and not exists (select 1 from weekly_plan_items w where w.job_assignment_id = v_id) then
      delete from job_assignments where id = v_id;
      v_removed_jobs := v_removed_jobs + 1;
    elsif exists (select 1 from job_assignments ja where ja.id = v_id) then
      v_kept_jobs := v_kept_jobs || v_id;
    end if;
  end loop;

  -- BOQ lines this run copied: remove only when nothing uses them.
  -- (also copies reused from an earlier run, once that run's lines are free)
  foreach v_id in array (
    select coalesce(array_agg(distinct x), '{}'::uuid[]) from (
      select unnest(v_run.created_boq_ids) as x
      union
      select u from unnest(v_run.used_copy_ids) u
      where exists (select 1 from house_type_change_runs r where u = any (r.created_boq_ids))
    ) q
  ) loop
    if not exists (select 1 from boq_master where id = v_id) then
      continue;
    end if;
    if not exists (select 1 from job_assignments ja where ja.boq_item_id = v_id)
       and not exists (select 1 from purchase_request_items pri where pri.boq_id = v_id) then
      delete from boq_master where id = v_id;
      v_removed_lines := v_removed_lines + 1;
    else
      v_kept_lines := v_kept_lines || v_id;
    end if;
  end loop;

  -- Money must match the snapshot taken before the run (jobs that existed then).
  v_before := v_run.money_before;
  v_after := public._htc_money(v_plot.id);
  v_diffs := public._htc_money_diff(v_before, v_after, '{}'::uuid[]);
  if jsonb_array_length(v_diffs) > 0 then
    raise exception 'MONEY_CHECK_FAILED' using errcode = 'P0001', detail = v_diffs::text;
  end if;

  update house_type_change_runs
  set status = 'reverted', reverted_at = now(), reverted_by = v_uid,
      revert_note = jsonb_build_object('removed_jobs', v_removed_jobs, 'removed_lines', v_removed_lines,
                                       'kept_jobs', to_jsonb(v_kept_jobs), 'kept_lines', to_jsonb(v_kept_lines))
  where id = v_run.id;

  return jsonb_build_object(
    'run_id', v_run.id,
    'plot_id', v_plot.id,
    'removed_jobs', v_removed_jobs,
    'removed_lines', v_removed_lines,
    'kept_jobs', to_jsonb(v_kept_jobs),
    'kept_lines', to_jsonb(v_kept_lines)
  );
end;
$$;

grant execute on function public.house_type_change_apply(jsonb) to authenticated;
grant execute on function public.house_type_change_revert(uuid) to authenticated;
