-- Phase 2.4: wrap the multi-step billing flows in atomic Postgres functions.
--
-- Before this migration, approving / creating / updating / undoing / deleting
-- a billing was a sequence of 3-6 independent Supabase calls from the Node
-- action. A crash or network drop between any two left the database in a
-- half-applied state (billing row updated but payments missing, adjustments
-- wiped but new ones not inserted, etc.).
--
-- Each RPC below does all of its writes inside a single implicit transaction,
-- so either everything lands or nothing does. Role checks run inside the
-- function as a defense-in-depth belt to the TS-side checks.
--
-- All functions are `security definer` so they can bypass RLS, but they
-- always verify `auth.uid()` and `profiles.role` before touching anything.
--
-- Safe to run multiple times (uses CREATE OR REPLACE).

-- ---------------------------------------------------------------------------
-- Helper: current caller's role ('' for anonymous)
-- ---------------------------------------------------------------------------
create or replace function public._billing_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), '');
$$;

grant execute on function public._billing_current_role() to authenticated;

-- ---------------------------------------------------------------------------
-- Helper: safe cast jsonb value to uuid (returns null for '' or jsonb null)
-- ---------------------------------------------------------------------------
create or replace function public._jsonb_to_uuid(v jsonb)
returns uuid
language sql
immutable
as $$
  select case
    when v is null then null
    when jsonb_typeof(v) = 'null' then null
    when v #>> '{}' is null or v #>> '{}' = '' then null
    else (v #>> '{}')::uuid
  end;
$$;

-- ---------------------------------------------------------------------------
-- Helper: jsonb array -> text[] (returns null for missing/non-array)
-- ---------------------------------------------------------------------------
create or replace function public._jsonb_to_text_array(v jsonb)
returns text[]
language sql
immutable
as $$
  select case
    when v is null or jsonb_typeof(v) <> 'array' then null
    else (select array_agg(value) from jsonb_array_elements_text(v))
  end;
$$;

-- ===========================================================================
-- RPC: billing_create_request
-- ===========================================================================
-- Creates a pending_review billing with its jobs + adjustments.
-- Allowed roles: foreman, pm, admin.
-- Returns: { id: uuid, doc_no: <billing doc_no> }
create or replace function public.billing_create_request(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_billing_id uuid;
  v_doc_no text;
  v_is_extra boolean := (p_payload->>'type') = 'extra_work';
  v_total_work numeric := coalesce((p_payload->>'total_work_amount')::numeric, 0);
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('foreman', 'pm', 'admin') then
    raise exception 'No permission to create billing request' using errcode = '42501';
  end if;

  if v_is_extra then
    v_total_work := 0;
  end if;

  insert into public.billings (
    project_id, contractor_id, plot_id, billing_date, note,
    total_work_amount, total_add_amount, total_deduct_amount, net_amount,
    status, type, attachment_urls, reason_for_dc,
    created_by, submitted_at, submitted_by
  ) values (
    (p_payload->>'project_id')::uuid,
    (p_payload->>'contractor_id')::uuid,
    public._jsonb_to_uuid(p_payload->'plot_id'),
    (p_payload->>'billing_date')::date,
    p_payload->>'note',
    v_total_work,
    coalesce((p_payload->>'total_add_amount')::numeric, 0),
    coalesce((p_payload->>'total_deduct_amount')::numeric, 0),
    coalesce((p_payload->>'net_amount')::numeric, 0),
    'pending_review',
    coalesce(p_payload->>'type', 'progress'),
    public._jsonb_to_text_array(p_payload->'attachment_urls'),
    p_payload->>'reason_for_dc',
    v_uid,
    now(),
    v_uid
  )
  returning id, doc_no::text into v_billing_id, v_doc_no;

  if not v_is_extra then
    insert into public.billing_jobs (billing_id, job_assignment_id, amount, progress_percent)
    select
      v_billing_id,
      (j->>'id')::uuid,
      coalesce((j->>'request_amount')::numeric, 0),
      nullif(j->>'progress_percent', '')::numeric
    from jsonb_array_elements(coalesce(p_payload->'selected_jobs', '[]'::jsonb)) j
    where coalesce(nullif(j->>'id', ''), '') <> '';
  end if;

  insert into public.billing_adjustments (billing_id, type, description, unit, quantity, unit_price)
  select
    v_billing_id,
    (a->>'type'),
    (a->>'description'),
    coalesce(nullif(a->>'unit', ''), 'unit'),
    coalesce((a->>'quantity')::numeric, 0),
    coalesce((a->>'unit_price')::numeric, 0)
  from jsonb_array_elements(coalesce(p_payload->'adjustments', '[]'::jsonb)) a;

  return jsonb_build_object('id', v_billing_id, 'doc_no', v_doc_no);
end;
$$;

grant execute on function public.billing_create_request(jsonb) to authenticated;

-- ===========================================================================
-- RPC: billing_update_request
-- ===========================================================================
-- Edits an existing pending_review billing: replaces its jobs + adjustments.
-- Non-privileged users can only edit requests they created/submitted.
-- Returns: { id, doc_no }
create or replace function public.billing_update_request(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_doc_no text;
  v_created_by uuid;
  v_submitted_by uuid;
  v_is_privileged boolean;
  v_is_extra boolean := (p_payload->>'type') = 'extra_work';
  v_total_work numeric := coalesce((p_payload->>'total_work_amount')::numeric, 0);
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  v_is_privileged := v_role in ('pm', 'admin');

  select status, doc_no::text, created_by, submitted_by
    into v_status, v_doc_no, v_created_by, v_submitted_by
  from public.billings
  where id = p_id;

  if v_status is null then
    raise exception 'Billing not found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'Can edit pending review only' using errcode = '42501';
  end if;
  if not v_is_privileged then
    if v_created_by is not null and v_created_by <> v_uid then
      raise exception 'No permission to edit this request' using errcode = '42501';
    end if;
    if v_created_by is null and v_submitted_by <> v_uid then
      raise exception 'No permission to edit this request' using errcode = '42501';
    end if;
  end if;

  if v_is_extra then
    v_total_work := 0;
  end if;

  update public.billings set
    project_id           = (p_payload->>'project_id')::uuid,
    contractor_id        = (p_payload->>'contractor_id')::uuid,
    plot_id              = public._jsonb_to_uuid(p_payload->'plot_id'),
    billing_date         = (p_payload->>'billing_date')::date,
    note                 = p_payload->>'note',
    total_work_amount    = v_total_work,
    total_add_amount     = coalesce((p_payload->>'total_add_amount')::numeric, 0),
    total_deduct_amount  = coalesce((p_payload->>'total_deduct_amount')::numeric, 0),
    net_amount           = coalesce((p_payload->>'net_amount')::numeric, 0),
    type                 = coalesce(p_payload->>'type', 'progress'),
    attachment_urls      = public._jsonb_to_text_array(p_payload->'attachment_urls'),
    reason_for_dc        = p_payload->>'reason_for_dc',
    submitted_at         = now()
  where id = p_id;

  delete from public.billing_jobs where billing_id = p_id;
  delete from public.billing_adjustments where billing_id = p_id;

  if not v_is_extra then
    insert into public.billing_jobs (billing_id, job_assignment_id, amount, progress_percent)
    select
      p_id,
      (j->>'id')::uuid,
      coalesce((j->>'request_amount')::numeric, 0),
      nullif(j->>'progress_percent', '')::numeric
    from jsonb_array_elements(coalesce(p_payload->'selected_jobs', '[]'::jsonb)) j
    where coalesce(nullif(j->>'id', ''), '') <> '';
  end if;

  insert into public.billing_adjustments (billing_id, type, description, unit, quantity, unit_price)
  select
    p_id,
    (a->>'type'),
    (a->>'description'),
    coalesce(nullif(a->>'unit', ''), 'unit'),
    coalesce((a->>'quantity')::numeric, 0),
    coalesce((a->>'unit_price')::numeric, 0)
  from jsonb_array_elements(coalesce(p_payload->'adjustments', '[]'::jsonb)) a;

  return jsonb_build_object('id', p_id, 'doc_no', v_doc_no);
end;
$$;

grant execute on function public.billing_update_request(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC: billing_approve
-- ===========================================================================
-- Approves a billing: updates status + totals, upserts jobs, replaces
-- adjustments, wipes any stale payments (billing_id link + legacy note),
-- and inserts a fresh payments row per persisted job.
-- Allowed roles: pm, admin.
-- Returns: { id, doc_no }
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

  -- Replace job line items (upsert by (billing_id, job_assignment_id))
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
  where coalesce(nullif(j->>'id', ''), '') <> ''
  on conflict (billing_id, job_assignment_id) do update
    set amount = excluded.amount,
        progress_percent = excluded.progress_percent;

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

-- ===========================================================================
-- RPC: billing_undo_approve
-- ===========================================================================
-- Reverts an approved billing back to pending_review and wipes its payments.
-- Allowed roles: pm, admin.
create or replace function public.billing_undo_approve(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_doc_no text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm', 'admin') then
    raise exception 'Only PM/Admin can undo approve' using errcode = '42501';
  end if;

  select status, doc_no::text into v_status, v_doc_no
  from public.billings where id = p_id;

  if v_status is null then
    raise exception 'Billing not found' using errcode = 'P0002';
  end if;
  if v_status <> 'approved' then
    raise exception 'Only approved billing can be reverted' using errcode = '42501';
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
      approved_by = null
  where id = p_id;

  return jsonb_build_object('id', p_id, 'doc_no', v_doc_no);
end;
$$;

grant execute on function public.billing_undo_approve(uuid) to authenticated;

-- ===========================================================================
-- RPC: billing_delete
-- ===========================================================================
-- Deletes a billing and all its dependents (jobs, adjustments, payments).
-- Permission rules:
--   - status = 'approved' → only pm / admin
--   - otherwise → creator/submitter or pm/admin
create or replace function public.billing_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_doc_no text;
  v_created_by uuid;
  v_submitted_by uuid;
  v_is_owner boolean;
  v_is_privileged boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  v_is_privileged := v_role in ('pm', 'admin');

  select status, doc_no::text, created_by, submitted_by
    into v_status, v_doc_no, v_created_by, v_submitted_by
  from public.billings where id = p_id;

  if v_status is null then
    raise exception 'Billing not found' using errcode = 'P0002';
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
$$;

grant execute on function public.billing_delete(uuid) to authenticated;
