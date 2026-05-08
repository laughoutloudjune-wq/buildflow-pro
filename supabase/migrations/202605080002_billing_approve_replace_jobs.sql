-- Hotfix: make billing_approve not depend on ON CONFLICT.
--
-- Some DBs have `billing_jobs` without a unique constraint on
-- (billing_id, job_assignment_id), which causes the approval RPC to fail with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- This replaces the upsert with a delete+insert (atomic inside the function),
-- matching the strategy used by billing_update_request.

create or replace function public.billing_approve(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_doc_no text;
  v_billing_date date := (p_payload->>'billing_date')::date;
  v_payment_note text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm', 'admin') then
    raise exception 'Only PM/Admin can approve billing' using errcode = '42501';
  end if;

  update public.billings set
    status              = 'approved',
    approved_by         = v_uid,
    billing_date        = v_billing_date,
    total_work_amount   = coalesce((p_payload->>'total_work_amount')::numeric, 0),
    total_add_amount    = coalesce((p_payload->>'total_add_amount')::numeric, 0),
    total_deduct_amount = coalesce((p_payload->>'total_deduct_amount')::numeric, 0),
    wht_percent         = coalesce((p_payload->>'wht_percent')::numeric, 0),
    retention_percent   = coalesce((p_payload->>'retention_percent')::numeric, 0),
    net_amount          = coalesce((p_payload->>'net_amount')::numeric, 0)
  where id = p_id
  returning doc_no::text into v_doc_no;

  if v_doc_no is null then
    raise exception 'Billing not found' using errcode = 'P0002';
  end if;

  -- Replace job line items wholesale (no ON CONFLICT dependency).
  delete from public.billing_jobs where billing_id = p_id;
  insert into public.billing_jobs (billing_id, job_assignment_id, amount, progress_percent)
  select
    p_id,
    (j->>'id')::uuid,
    coalesce((j->>'request_amount')::numeric, 0),
    case
      when j ? 'progress_percent' and jsonb_typeof(j->'progress_percent') <> 'null'
      then (j->>'progress_percent')::numeric
      else null
    end
  from jsonb_array_elements(coalesce(p_payload->'selected_jobs', '[]'::jsonb)) j
  where coalesce(nullif(j->>'id', ''), '') <> '';

  -- Replace adjustments wholesale
  delete from public.billing_adjustments where billing_id = p_id;
  insert into public.billing_adjustments (billing_id, type, description, unit, quantity, unit_price)
  select
    p_id,
    (a->>'type'),
    (a->>'description'),
    coalesce(nullif(a->>'unit', ''), 'unit'),
    coalesce((a->>'quantity')::numeric, 0),
    coalesce((a->>'unit_price')::numeric, 0)
  from jsonb_array_elements(coalesce(p_payload->'adjustments', '[]'::jsonb)) a;

  -- Payments: clear stale rows (FK link + legacy notes) so re-approval never
  -- creates duplicates. Then insert one payment row per persisted job.
  delete from public.payments where billing_id = p_id;
  delete from public.payments
  where billing_id is null
    and note in (
      'เบิกตามใบขอเบิก #' || coalesce(v_doc_no, '-'),
      'เน€เธเธดเธเธ•เธฒเธกเนเธเธงเธฒเธเธเธดเธฅ #' || coalesce(v_doc_no, '-')
    );

  v_payment_note := 'เบิกตามใบขอเบิก #' || coalesce(v_doc_no, '-');
  insert into public.payments (billing_id, job_assignment_id, amount, payment_date, note)
  select p_id, bj.job_assignment_id, bj.amount, v_billing_date, v_payment_note
  from public.billing_jobs bj
  where bj.billing_id = p_id;

  return jsonb_build_object('id', p_id, 'doc_no', v_doc_no);
end;
$$;

grant execute on function public.billing_approve(uuid, jsonb) to authenticated;

