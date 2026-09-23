-- Handover plan Phase 4.3 (W-03): a rejected bill was a dead end -
-- billing_update_request only allowed edits while pending_review, so the
-- foreman had to re-type a brand new request from scratch instead of fixing
-- and resending the rejected one. Needs 2.1 (status guards) and 2.6
-- (review_note/reviewed_by/reviewed_at) already shipped.
--
-- billing_update_request now also accepts a 'rejected' billing (same
-- owner-or-PM/admin permission check as before). Saving one moves it back
-- to 'pending_review', clears review_note/reviewed_by/reviewed_at (a stale
-- reason from the last round shouldn't linger once the bill has actually
-- been changed), and notifies PMs the same way billing_create_request does
-- for a brand new request.

create or replace function public.billing_update_request(p_id uuid, p_payload jsonb)
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
  v_is_privileged boolean;
  v_is_extra boolean := (p_payload->>'type') = 'extra_work';
  v_total_work numeric := coalesce((p_payload->>'total_work_amount')::numeric, 0);
  v_was_rejected boolean;
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
  if v_status not in ('pending_review', 'rejected') then
    raise exception 'Can edit pending review or rejected billing only' using errcode = '42501';
  end if;
  if not v_is_privileged then
    if v_created_by is not null and v_created_by <> v_uid then
      raise exception 'No permission to edit this request' using errcode = '42501';
    end if;
    if v_created_by is null and v_submitted_by <> v_uid then
      raise exception 'No permission to edit this request' using errcode = '42501';
    end if;
  end if;

  v_was_rejected := (v_status = 'rejected');

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
    submitted_at         = now(),
    status               = case when v_was_rejected then 'pending_review' else status end,
    review_note          = case when v_was_rejected then null else review_note end,
    reviewed_by          = case when v_was_rejected then null else reviewed_by end,
    reviewed_at          = case when v_was_rejected then null else reviewed_at end
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

  if v_was_rejected then
    insert into public.notifications (recipient_id, billing_id, type)
    select p.id, p_id, 'new_request'
    from public.profiles p
    where p.role = 'pm';
  end if;

  return jsonb_build_object('id', p_id, 'doc_no', v_doc_no);
end;
$function$;
