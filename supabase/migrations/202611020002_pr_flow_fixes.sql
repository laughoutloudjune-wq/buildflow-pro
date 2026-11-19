-- Purchase request flow fixes found in the 2026-11-02 walk-through.
--
-- 1. A request never reached 'received' when its order was received BEFORE the
--    request was linked to it, or when it only became fully ordered after the
--    goods arrived (live: requests 9, 22, 56, 58 sat in "รอของ" with every
--    order received). Only goods_receipt_create ever set 'received', and only
--    for a request that was 'ordered' at that moment. The status is now worked
--    out from the line states in one place, so it follows whatever happens
--    (link, unlink, receive, undo receive, cancel or delete an order).
-- 2. A line covered by allocations is now 'arrived' once every order that
--    covers it is received/paid (it used to stay 'ordered' forever, so the
--    stored 'arrived' of 49 lines was reverted by any later re-check).
-- 3. Nobody could withdraw a wrong request: pr_cancel (the status 'cancelled'
--    already existed and the screens already show it).
-- 4. pr_update let any foreman edit any other person's pending request.
--
-- Nothing is dropped or deleted. Safe to run twice. Builds on 202611020001.
-- Existing rows are NOT changed by this file - see 202611020003 for the
-- optional re-check of the rows that are already out of step.

-- 2. line state ---------------------------------------------------------------
create or replace function public._pri_line_state(p_pri_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.purchase_order_item_allocations a
      join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
      join public.purchase_orders po on po.id = poi.purchase_order_id
      where a.purchase_request_item_id = p_pri_id
        and poi.closes_request_line
        and po.status in ('received', 'paid')
    ) or exists (
      select 1
      from public.purchase_request_po_links l
      join public.purchase_order_items poi on poi.id = l.purchase_order_item_id
      join public.purchase_orders po on po.id = poi.purchase_order_id
      where l.purchase_request_item_id = p_pri_id
        and po.status in ('received', 'paid')
    ) then 'arrived'
    when exists (
      select 1
      from public.purchase_order_item_allocations a
      join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
      join public.purchase_orders po on po.id = poi.purchase_order_id
      where a.purchase_request_item_id = p_pri_id
        and poi.closes_request_line
        and po.status <> 'cancelled'
    ) or exists (
      select 1
      from public.purchase_request_po_links l
      join public.purchase_order_items poi on poi.id = l.purchase_order_item_id
      join public.purchase_orders po on po.id = poi.purchase_order_id
      where l.purchase_request_item_id = p_pri_id
        and po.status <> 'cancelled'
    ) then 'ordered'
    when exists (select 1 from public.purchase_order_item_allocations a2 where a2.purchase_request_item_id = p_pri_id)
      and (
        select coalesce(sum(a.quantity_allocated / coalesce(public.unit_factor(pri.material_type_id, poi.unit), 1)), 0)
        from public.purchase_order_item_allocations a
        join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
        join public.purchase_orders po on po.id = poi.purchase_order_id
        join public.purchase_request_items pri on pri.id = a.purchase_request_item_id
        where a.purchase_request_item_id = p_pri_id
          and po.status <> 'cancelled'
      ) >= (
        select pri.quantity_requested / coalesce(public.unit_factor(pri.material_type_id, pri.unit), 1)
        from public.purchase_request_items pri
        where pri.id = p_pri_id
      )
    then case
      -- fully covered: it has arrived once none of the covering orders is still on its way
      when not exists (
        select 1
        from public.purchase_order_item_allocations a
        join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
        join public.purchase_orders po on po.id = poi.purchase_order_id
        where a.purchase_request_item_id = p_pri_id
          and po.status not in ('cancelled', 'received', 'paid')
      ) then 'arrived'
      else 'ordered'
    end
    when exists (
      select 1 from public.purchase_request_item_settlements s where s.purchase_request_item_id = p_pri_id
    ) then 'closed'
    else 'open'
  end;
$$;

-- 1. request status -----------------------------------------------------------
-- Worked out from the line states: any open line -> approved; else any ordered
-- line -> ordered; else any arrived line -> received. A request whose lines
-- are ALL closed by hand keeps its status (an approved one still moves to
-- 'ordered', as before) so old requests are never pushed backwards by this.
-- Becoming 'received' tells the requester, unless app.skip_pr_notify = '1'
-- (used by the one-off clean-up so old requests do not notify anyone).
create or replace function public._pr_recompute_status(p_pr_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_new text;
  v_by uuid;
begin
  select status, requested_by into v_old, v_by from public.purchase_requests where id = p_pr_id;
  if v_old is null or v_old not in ('approved', 'ordered', 'received') then
    return;
  end if;

  select case
    when bool_or(line_status = 'open') then 'approved'
    when bool_or(line_status = 'ordered') then 'ordered'
    when bool_or(line_status = 'arrived') then 'received'
    when v_old = 'approved' then 'ordered'
    else v_old
  end
  into v_new
  from public.purchase_request_items
  where purchase_request_id = p_pr_id;

  v_new := coalesce(v_new, v_old);
  if v_new = v_old then
    return;
  end if;

  update public.purchase_requests set status = v_new where id = p_pr_id;

  if v_new = 'received' and v_by is not null and coalesce(current_setting('app.skip_pr_notify', true), '') <> '1' then
    insert into public.notifications (recipient_id, purchase_request_id, type)
    values (v_by, p_pr_id, 'pr_received');
  end if;
end;
$$;

-- 3. withdraw / cancel a request ----------------------------------------------
-- The requester can withdraw their own request while it waits for review;
-- PM/Admin can cancel one that is waiting or approved but not ordered yet.
-- Refused while a live order is linked or a line was closed as "bought
-- elsewhere" (undo those first), so a cancelled request never hides spend.
create or replace function public.pr_cancel(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_by uuid;
  v_staff boolean := v_role in ('pm', 'admin');
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select status, requested_by into v_status, v_by from public.purchase_requests where id = p_id;
  if v_status is null then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;

  if v_staff then
    if v_status not in ('pending_review', 'approved') then
      raise exception 'Only a request that has not been ordered yet can be cancelled' using errcode = '42501';
    end if;
  elsif v_role = 'foreman' and v_by = v_uid then
    if v_status <> 'pending_review' then
      raise exception 'Only a request that is still waiting for review can be withdrawn' using errcode = '42501';
    end if;
  else
    raise exception 'No permission to cancel this purchase request' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.purchase_request_items pri
    where pri.purchase_request_id = p_id
      and (
        exists (
          select 1 from public.purchase_order_item_allocations a
          join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
          join public.purchase_orders po on po.id = poi.purchase_order_id
          where a.purchase_request_item_id = pri.id and po.status <> 'cancelled'
        )
        or exists (
          select 1 from public.purchase_request_po_links l
          join public.purchase_order_items poi on poi.id = l.purchase_order_item_id
          join public.purchase_orders po on po.id = poi.purchase_order_id
          where l.purchase_request_item_id = pri.id and po.status <> 'cancelled'
        )
        or exists (
          select 1 from public.purchase_request_item_settlements s
          where s.purchase_request_item_id = pri.id and s.reason = 'ordered'
        )
      )
  ) then
    raise exception 'Cannot cancel a request that already has an order - remove the link to the order first' using errcode = '42501';
  end if;

  update public.purchase_requests
  set status = 'cancelled',
      review_note = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), review_note),
      reviewed_by = case when v_staff then v_uid else reviewed_by end,
      reviewed_at = case when v_staff then now() else reviewed_at end
  where id = p_id;

  return jsonb_build_object('id', p_id, 'status', 'cancelled');
end;
$$;

-- 4. editing a pending request ------------------------------------------------
create or replace function public.pr_update(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_by uuid;
  v_pr_no text;
  v_plot_ids_count int := jsonb_array_length(coalesce(p_payload->'plot_ids', '[]'::jsonb));
  v_plot_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_id') end;
  v_plot_group_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_group_id') end;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('foreman','pm','admin') then
    raise exception 'No permission to edit this purchase request' using errcode = '42501';
  end if;
  if v_plot_id is not null and v_plot_group_id is not null then
    raise exception 'Choose either a single plot or a plot group, not both' using errcode = '22023';
  end if;

  select status, requested_by, pr_no::text into v_status, v_by, v_pr_no from public.purchase_requests where id = p_id;
  if v_status is null then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;
  if v_role = 'foreman' and v_by is distinct from v_uid then
    raise exception 'No permission to edit this purchase request' using errcode = '42501';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'Cannot edit a purchase request that has already been reviewed' using errcode = '42501';
  end if;

  update public.purchase_requests set
    project_id = (p_payload->>'project_id')::uuid,
    plot_id = v_plot_id,
    plot_group_id = v_plot_group_id,
    note = p_payload->>'note',
    needed_by_date = nullif(p_payload->>'needed_by_date', '')::date
  where id = p_id;

  delete from public.purchase_request_items where purchase_request_id = p_id;
  insert into public.purchase_request_items (purchase_request_id, material_type_id, quantity_requested, note, boq_id, unit)
  select
    p_id,
    (i->>'material_type_id')::bigint,
    (i->>'quantity_requested')::numeric,
    i->>'note',
    public._jsonb_to_uuid(i->'boq_id'),
    nullif(i->>'unit', '')
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where coalesce((i->>'quantity_requested')::numeric, 0) > 0;

  delete from public.purchase_request_plots where purchase_request_id = p_id;
  insert into public.purchase_request_plots (purchase_request_id, plot_id)
  select p_id, elem::uuid
  from jsonb_array_elements_text(coalesce(p_payload->'plot_ids', '[]'::jsonb)) as elem
  where elem <> '';

  return jsonb_build_object('id', p_id, 'pr_no', v_pr_no);
end;
$$;
