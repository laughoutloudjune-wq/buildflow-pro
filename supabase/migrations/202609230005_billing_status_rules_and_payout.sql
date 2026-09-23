-- Handover plan Phase 2.1, 2.5, 2.6 - contractor billing guards.
--
-- 2.1 (H-04): a bill could be approved twice, rejected after approval (with
-- its payments rows left behind looking "already paid"), or have its
-- approval/deletion undone after payout without anyone noticing. Adds status
-- guards to billing_approve/billing_reject (only from pending_review) and to
-- billing_undo_approve/billing_delete (refuse once paid_out_at is set).
--
-- 2.6 (L-09): billing_reject used to overwrite the foreman's own `note` and
-- record the rejecter as `approved_by`, so the original note was lost and an
-- approved-vs-rejected bill couldn't be told apart by who touched it. Adds
-- separate review_note/reviewed_by/reviewed_at columns.
--
-- 2.5 (M-06, part of W-02): markBillingsAsPaidOut ran one UPDATE per bill in
-- parallel with no all-or-nothing guarantee and no check for an existing
-- payout, so a partial failure could leave a batch half-marked, and
-- re-running it on an already-paid bill could silently overwrite its pay
-- date and WHT/retention amounts. Replaces the JS-side loop with one
-- database function per direction. Also lets `accountant` call these (W-02:
-- accountant's whole job is the payment cycle page), while approve/reject
-- stay PM/Admin only.

alter table public.billings
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

create or replace function public.billing_approve(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_doc_no text;
  v_billing_date date := (p_payload->>'billing_date')::date;
  v_payment_note text;
  v_submitted_by uuid;
  v_created_by uuid;
  v_recipient uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm', 'admin') then
    raise exception 'Only PM/Admin can approve billing' using errcode = '42501';
  end if;

  select status into v_status from public.billings where id = p_id;
  if v_status is null then
    raise exception 'Billing not found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'Only a billing pending review can be approved' using errcode = '42501';
  end if;

  update public.billings set
    status              = 'approved',
    approved_by         = v_uid,
    approved_at         = now(),
    billing_date        = v_billing_date,
    total_work_amount   = coalesce((p_payload->>'total_work_amount')::numeric, 0),
    total_add_amount    = coalesce((p_payload->>'total_add_amount')::numeric, 0),
    total_deduct_amount = coalesce((p_payload->>'total_deduct_amount')::numeric, 0),
    wht_percent         = coalesce((p_payload->>'wht_percent')::numeric, 0),
    retention_percent   = coalesce((p_payload->>'retention_percent')::numeric, 0),
    net_amount          = coalesce((p_payload->>'net_amount')::numeric, 0)
  where id = p_id
  returning doc_no::text, submitted_by, created_by into v_doc_no, v_submitted_by, v_created_by;

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

  v_recipient := coalesce(v_submitted_by, v_created_by);
  if v_recipient is not null then
    insert into public.notifications (recipient_id, billing_id, type)
    values (v_recipient, p_id, 'billing_approved');
  end if;

  insert into public.notifications (recipient_id, billing_id, type)
  select p.id, p_id, 'billing_approved'
  from public.profiles p
  where p.role = 'admin'
    and p.id is distinct from v_recipient;

  return jsonb_build_object('id', p_id, 'doc_no', v_doc_no);
end;
$function$;

create or replace function public.billing_reject(p_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_doc_no text;
  v_submitted_by uuid;
  v_created_by uuid;
  v_recipient uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm', 'admin') then
    raise exception 'Only PM/Admin can reject billing' using errcode = '42501';
  end if;

  select status, doc_no::text, submitted_by, created_by
    into v_status, v_doc_no, v_submitted_by, v_created_by
  from public.billings where id = p_id;

  if v_doc_no is null then
    raise exception 'Billing not found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'Only a billing pending review can be rejected' using errcode = '42501';
  end if;

  update public.billings set
    status = 'rejected',
    review_note = p_note,
    reviewed_by = v_uid,
    reviewed_at = now()
  where id = p_id;

  -- Defensive only: reject is now refused above unless the bill is still
  -- pending_review, so no payments row can exist yet. Kept so a rejected
  -- bill can never show as "paid" if this is ever reached from elsewhere.
  delete from public.payments where billing_id = p_id;

  v_recipient := coalesce(v_submitted_by, v_created_by);
  if v_recipient is not null then
    insert into public.notifications (recipient_id, billing_id, type)
    values (v_recipient, p_id, 'billing_rejected');
  end if;

  return jsonb_build_object('id', p_id, 'doc_no', v_doc_no);
end;
$function$;

create or replace function public.billing_undo_approve(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_doc_no text;
  v_paid_out_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm', 'admin') then
    raise exception 'Only PM/Admin can undo approve' using errcode = '42501';
  end if;

  select status, doc_no::text, paid_out_at into v_status, v_doc_no, v_paid_out_at
  from public.billings where id = p_id;

  if v_status is null then
    raise exception 'Billing not found' using errcode = 'P0002';
  end if;
  if v_status <> 'approved' then
    raise exception 'Only approved billing can be reverted' using errcode = '42501';
  end if;
  if v_paid_out_at is not null then
    raise exception 'Cannot undo approval - this billing has already been paid out, unmark the payout first' using errcode = '42501';
  end if;

  delete from public.payments where billing_id = p_id;
  delete from public.payments
  where billing_id is null
    and note in (
      'เบิกตามใบขอเบิก #' || coalesce(v_doc_no, '-'),
      'เน€เธเธดเธเธ•เธฒเธกเนเธเธงเธฒเธเธเธดเธฅ #' || coalesce(v_doc_no, '-')
    );

  update public.billings
  set status = 'pending_review',
      approved_by = null,
      approved_at = null
  where id = p_id;

  return jsonb_build_object('id', p_id, 'doc_no', v_doc_no);
end;
$function$;

create or replace function public.billing_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_doc_no text;
  v_created_by uuid;
  v_submitted_by uuid;
  v_paid_out_at timestamptz;
  v_is_owner boolean;
  v_is_privileged boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  v_is_privileged := v_role in ('pm', 'admin');

  select status, doc_no::text, created_by, submitted_by, paid_out_at
    into v_status, v_doc_no, v_created_by, v_submitted_by, v_paid_out_at
  from public.billings where id = p_id;

  if v_status is null then
    raise exception 'Billing not found' using errcode = 'P0002';
  end if;
  if v_paid_out_at is not null then
    raise exception 'Cannot delete - this billing has already been paid out, unmark the payout first' using errcode = '42501';
  end if;

  v_is_owner := v_created_by = v_uid or v_submitted_by = v_uid;

  if v_status = 'approved' and not v_is_privileged then
    raise exception 'Only PM/Admin can delete approved billing' using errcode = '42501';
  end if;
  if v_status <> 'approved' and not (v_is_owner or v_is_privileged) then
    raise exception 'No permission to delete this billing' using errcode = '42501';
  end if;

  if v_status = 'approved' then
    delete from public.payments where billing_id = p_id;
    delete from public.payments
    where billing_id is null
      and note in (
        'เบิกตามใบขอเบิก #' || coalesce(v_doc_no, '-'),
        'เน€เธเธดเธเธ•เธฒเธกเนเธเธงเธฒเธเธเธดเธฅ #' || coalesce(v_doc_no, '-')
      );
  end if;

  delete from public.billing_jobs where billing_id = p_id;
  delete from public.billing_adjustments where billing_id = p_id;
  delete from public.billings where id = p_id;

  return jsonb_build_object('id', p_id, 'doc_no', v_doc_no);
end;
$function$;

-- 2.5: one all-or-nothing payout function per direction, replacing the JS
-- loop of independent per-row updates in markBillingsAsPaidOut. Accountant
-- can call both (W-02); approve/reject/undo above stay PM/Admin only.
create or replace function public.billing_mark_paid_out(p_items jsonb, p_paid_at date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_expected int;
  v_count int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm', 'admin', 'accountant') then
    raise exception 'Only PM/Admin/Accountant can mark billings as paid out' using errcode = '42501';
  end if;

  v_expected := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if v_expected = 0 then
    raise exception 'No billing IDs provided' using errcode = '22023';
  end if;

  with items as (
    select
      (i->>'id')::uuid as id,
      coalesce((i->>'wht_applied')::boolean, false) as wht_applied,
      coalesce((i->>'retention_applied')::boolean, true) as retention_applied,
      coalesce((i->>'deduct_applied')::boolean, true) as deduct_applied,
      nullif(i->>'retention_amount', '')::numeric as retention_amount,
      nullif(i->>'wht_amount', '')::numeric as wht_amount
    from jsonb_array_elements(p_items) i
  )
  update public.billings b
  set paid_out_at       = p_paid_at,
      paid_out_by       = v_uid,
      wht_applied       = items.wht_applied,
      retention_applied = items.retention_applied,
      deduct_applied    = items.deduct_applied,
      retention_amount  = items.retention_amount,
      wht_amount        = items.wht_amount
  from items
  where b.id = items.id
    and b.status = 'approved'
    and b.paid_out_at is null;

  get diagnostics v_count = row_count;

  if v_count <> v_expected then
    raise exception 'One or more billings are not approved or are already paid out' using errcode = '42501';
  end if;

  return jsonb_build_object('count', v_count);
end;
$function$;

create or replace function public.billing_unmark_paid_out(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_count int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm', 'admin', 'accountant') then
    raise exception 'Only PM/Admin/Accountant can unmark paid out' using errcode = '42501';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'No billing IDs provided' using errcode = '22023';
  end if;

  update public.billings
  set paid_out_at = null,
      paid_out_by = null
  where id = any(p_ids);

  get diagnostics v_count = row_count;

  return jsonb_build_object('count', v_count);
end;
$function$;

revoke execute on function public.billing_mark_paid_out(jsonb, date), public.billing_unmark_paid_out(uuid[])
  from anon, public;
grant execute on function public.billing_mark_paid_out(jsonb, date), public.billing_unmark_paid_out(uuid[])
  to authenticated;
