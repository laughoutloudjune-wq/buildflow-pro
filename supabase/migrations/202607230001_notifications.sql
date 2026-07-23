-- In-app notifications for the billing approval workflow.
--
-- Recipient rules (per product decision):
--   - foreman submits a request (progress or DC) -> notify every PM
--   - PM approves a request                       -> notify the submitter + every admin
--   - PM rejects a request                        -> notify the submitter only
--
-- Admins are deliberately excluded from "new request" notifications — job
-- approval isn't their job, only PM's. Notification rows carry only
-- (recipient_id, billing_id, type) — display text (doc_no, contractor,
-- project name) is resolved by the reading client via a join, so this table
-- never goes stale relative to the billing it points at.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  billing_id uuid references public.billings(id) on delete cascade,
  type text not null check (type in ('new_request', 'billing_approved', 'billing_rejected')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_id, read_at, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select to authenticated
  using (recipient_id = auth.uid());

-- Only lets a recipient flip read_at on their own rows (mark-as-read); all
-- inserts happen through the security-definer RPCs below, bypassing RLS, so
-- there is deliberately no insert policy for authenticated.
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

grant select, update on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- billing_create_request: notify every PM of a new foreman submission
-- ---------------------------------------------------------------------------
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

  insert into public.notifications (recipient_id, billing_id, type)
  select p.id, v_billing_id, 'new_request'
  from public.profiles p
  where p.role = 'pm';

  return jsonb_build_object('id', v_billing_id, 'doc_no', v_doc_no);
end;
$$;

grant execute on function public.billing_create_request(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- billing_approve: notify the submitter + every admin
-- ---------------------------------------------------------------------------
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
$$;

grant execute on function public.billing_approve(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- billing_reject: atomic status update + notify the submitter
-- ---------------------------------------------------------------------------
-- Previously a plain client-side UPDATE (see actions/billing/reviews.ts) —
-- moved into an RPC so the status change and the notification insert can't
-- get out of sync with each other.
create or replace function public.billing_reject(p_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
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

  update public.billings set
    status = 'rejected',
    note = coalesce(p_note, note),
    approved_by = v_uid
  where id = p_id
  returning doc_no::text, submitted_by, created_by into v_doc_no, v_submitted_by, v_created_by;

  if v_doc_no is null then
    raise exception 'Billing not found' using errcode = 'P0002';
  end if;

  v_recipient := coalesce(v_submitted_by, v_created_by);
  if v_recipient is not null then
    insert into public.notifications (recipient_id, billing_id, type)
    values (v_recipient, p_id, 'billing_rejected');
  end if;

  return jsonb_build_object('id', p_id, 'doc_no', v_doc_no);
end;
$$;

grant execute on function public.billing_reject(uuid, text) to authenticated;
