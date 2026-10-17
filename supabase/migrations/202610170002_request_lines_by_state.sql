-- Procurement redesign, step 3: a request line is covered by a decision, not
-- by subtraction.
--
-- Until now a PO counted purchase_request_items.quantity_requested down by what
-- it ordered (same unit only), settlements and cancellations counted it back
-- up, and when purchasing bought a different material the request line itself
-- was re-pointed to it. That arithmetic is what blocked saving a PO and
-- erased what the foreman had asked for.
--
-- From here:
--   * quantity_requested (and the material and unit) stay exactly as the
--     foreman wrote them. Nothing the PO side does changes them.
--   * line_status says where the line stands: open -> ordered -> arrived, or
--     closed by hand. It is derived from the PO links and the "this order
--     covers it" tick, and kept in step by triggers.
--   * the quantity-vs-remaining, request-unit and "already closed by another
--     PO" checks are gone; quantities and units are information.
--
-- Depends on 202610170001 (line_status, quantity_requested_original columns).
-- Live functions that were hot-fixed outside the repo (po_allocation_unit_
-- mismatch, 2026-10-16) are patched in place from their live definition, and
-- the migration fails loudly if the expected text is missing.

-- ---------------------------------------------------------------------------
-- 1. Stop the swap: a request line keeps the material the foreman chose.
-- ---------------------------------------------------------------------------
drop trigger if exists purchase_request_items_keep_original_material on public.purchase_request_items;
drop function if exists public._pri_keep_original_material();

-- ---------------------------------------------------------------------------
-- 2. Line state, derived from the PO links
-- ---------------------------------------------------------------------------
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
    ) then 'arrived'
    when exists (
      select 1
      from public.purchase_order_item_allocations a
      join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
      join public.purchase_orders po on po.id = poi.purchase_order_id
      where a.purchase_request_item_id = p_pri_id
        and poi.closes_request_line
        and po.status <> 'cancelled'
    ) then 'ordered'
    when exists (
      select 1 from public.purchase_request_item_settlements s where s.purchase_request_item_id = p_pri_id
    ) then 'closed'
    else 'open'
  end;
$$;

create or replace function public._pr_recompute_status(p_pr_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.purchase_requests
  set status = case
    when exists (
      select 1 from public.purchase_request_items pri
      where pri.purchase_request_id = p_pr_id and pri.line_status = 'open'
    ) then 'approved'
    else 'ordered'
  end
  where id = p_pr_id
    and status in ('approved', 'ordered');
$$;

-- Name kept: the existing triggers on the allocation table and on PO status
-- call it. It no longer touches the material; it refreshes the line state and
-- the request's status.
create or replace function public._pri_resync_material(p_pri_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pr uuid;
  v_old text;
  v_new text;
begin
  select purchase_request_id, line_status into v_pr, v_old
  from public.purchase_request_items where id = p_pri_id;
  if not found then
    return;
  end if;
  v_new := public._pri_line_state(p_pri_id);
  if v_new is distinct from v_old then
    update public.purchase_request_items
    set line_status = v_new,
        closed_at = case when v_new = 'closed' then coalesce(closed_at, now()) else null end,
        closed_by = case when v_new = 'closed' then closed_by else null end,
        close_reason = case when v_new = 'closed' then close_reason else null end
    where id = p_pri_id;
  end if;
  perform public._pr_recompute_status(v_pr);
end;
$$;

-- Any PO status change can move a line (cancel -> back to open, received ->
-- arrived), not only cancel.
drop trigger if exists purchase_orders_resync_material on public.purchase_orders;
create trigger purchase_orders_resync_material
  after update of status on public.purchase_orders
  for each row
  when (old.status is distinct from new.status)
  execute function public._po_status_resync_trigger();

-- Ticking or un-ticking "this order covers it" moves the line too.
create or replace function public._poi_covers_resync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pri uuid;
begin
  for v_pri in
    select a.purchase_request_item_id from public.purchase_order_item_allocations a
    where a.purchase_order_item_id = new.id
  loop
    perform public._pri_resync_material(v_pri);
  end loop;
  return null;
end;
$$;

drop trigger if exists purchase_order_items_covers_resync on public.purchase_order_items;
create trigger purchase_order_items_covers_resync
  after update of closes_request_line on public.purchase_order_items
  for each row
  when (old.closes_request_line is distinct from new.closes_request_line)
  execute function public._poi_covers_resync_trigger();

-- ---------------------------------------------------------------------------
-- 3. No countdown, no arithmetic checks
-- ---------------------------------------------------------------------------
create or replace function public._po_alloc_apply_qty(p_po_id uuid, p_sign integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The request quantity is never changed by a PO any more.
  return;
end;
$$;

create or replace function public._po_alloc_validate(p_po_id uuid, p_strict_pris uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allocated quantity vs what is left, and "already closed by another PO",
  -- are information now, shown as warnings in the app.
  return;
end;
$$;

do $$
declare
  v_def text;
  v_old text := 'if p_strict and abs(v_sum - v_line_qty) > 0.0001 then';
begin
  v_def := pg_get_functiondef('public._po_item_set_allocations(uuid,uuid,jsonb,boolean,uuid,jsonb)'::regprocedure);
  if position(v_old in v_def) = 0 then
    raise exception 'Expected allocation-sum check not found in _po_item_set_allocations';
  end if;
  execute replace(v_def, v_old, 'if false then');

  v_def := pg_get_functiondef('public.po_close_short(uuid,text)'::regprocedure);
  v_old := 'if v_alloc.pri_unit is not distinct from v_line.unit and v_alloc.quantity_allocated > v_new_qty then';
  if position(v_old in v_def) = 0 then
    raise exception 'Expected give-back check not found in po_close_short';
  end if;
  execute replace(v_def, v_old, 'if false then');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Closing a line by hand (bought elsewhere / no longer needed)
-- ---------------------------------------------------------------------------
create or replace function public.pr_item_settle(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_pr_id uuid := public._jsonb_to_uuid(p_payload->'purchase_request_id');
  v_reason text := coalesce(nullif(p_payload->>'reason', ''), 'ordered');
  v_po_ref text := nullif(btrim(coalesce(p_payload->>'po_ref', '')), '');
  v_note text := nullif(btrim(coalesce(p_payload->>'note', '')), '');
  v_status text;
  v_settled int;
  v_item uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can close a purchase request line' using errcode = '42501';
  end if;
  if v_reason not in ('ordered', 'cancelled') then
    raise exception 'Unknown settlement reason' using errcode = '22023';
  end if;

  select status into v_status from public.purchase_requests where id = v_pr_id;
  if v_status is null then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;
  if v_status not in ('approved', 'ordered') then
    raise exception 'Only an approved request can have its lines closed by hand' using errcode = '42501';
  end if;

  with picked as (
    select
      public._jsonb_to_uuid(i->'purchase_request_item_id') as item_id,
      nullif((i->>'quantity')::numeric, 0) as qty
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  ),
  valid as (
    select pri.id as item_id, coalesce(picked.qty, pri.quantity_requested) as qty
    from picked
    join public.purchase_request_items pri on pri.id = picked.item_id
    where pri.purchase_request_id = v_pr_id
      and pri.line_status = 'open'
  ),
  inserted as (
    insert into public.purchase_request_item_settlements
      (purchase_request_item_id, quantity, reason, po_ref, note, settled_by)
    select item_id, qty, v_reason, v_po_ref, v_note, v_uid from valid
    returning purchase_request_item_id
  )
  select count(*) into v_settled from inserted;

  if v_settled = 0 then
    raise exception 'Select at least one open line to close' using errcode = '22023';
  end if;

  update public.purchase_request_items pri
  set close_reason = coalesce(v_note, v_reason), closed_by = v_uid
  where pri.purchase_request_id = v_pr_id
    and pri.id in (select public._jsonb_to_uuid(i->'purchase_request_item_id')
                   from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i)
    and pri.line_status = 'open';

  for v_item in
    select public._jsonb_to_uuid(i->'purchase_request_item_id')
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  loop
    perform public._pri_resync_material(v_item);
  end loop;

  return jsonb_build_object('id', v_pr_id, 'settled', v_settled);
end;
$$;

create or replace function public.pr_item_settle_undo(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_item_id uuid;
  v_pr_id uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can reopen a closed request line' using errcode = '42501';
  end if;

  select s.purchase_request_item_id, pri.purchase_request_id, pr.status
  into v_item_id, v_pr_id, v_status
  from public.purchase_request_item_settlements s
  join public.purchase_request_items pri on pri.id = s.purchase_request_item_id
  join public.purchase_requests pr on pr.id = pri.purchase_request_id
  where s.id = p_id;

  if v_item_id is null then
    raise exception 'Settlement not found' using errcode = 'P0002';
  end if;
  if v_status not in ('approved', 'ordered') then
    raise exception 'Cannot reopen a line once the request has been received' using errcode = '42501';
  end if;

  delete from public.purchase_request_item_settlements where id = p_id;
  perform public._pri_resync_material(v_item_id);

  return jsonb_build_object('id', v_pr_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. PM review of request vs order (a mark, never a gate)
-- ---------------------------------------------------------------------------
create or replace function public.pr_pm_review(p_id uuid, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
begin
  if v_uid is null or v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can review a purchase request against its orders' using errcode = '42501';
  end if;
  update public.purchase_requests
  set pm_reviewed_by = v_uid,
      pm_reviewed_at = now(),
      pm_review_comment = nullif(btrim(coalesce(p_comment, '')), '')
  where id = p_id;
  if not found then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id);
end;
$$;

revoke all on function public._pri_line_state(uuid) from public, anon;
revoke all on function public.pr_pm_review(uuid, text) from public, anon;
grant execute on function public.pr_pm_review(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Data: put back what the foreman asked, then derive the line states
-- ---------------------------------------------------------------------------
-- State first, from the old arithmetic (a line counted down to 0, or ticked
-- "covers it", counts as covered), because the quantities change below.
with live as (
  select
    a.purchase_request_item_id as pri_id,
    bool_or(true) as has_live,
    bool_or(po.status in ('received', 'paid')) as has_done,
    bool_or(poi.closes_request_line) as has_tick
  from public.purchase_order_item_allocations a
  join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
  join public.purchase_orders po on po.id = poi.purchase_order_id
  where po.status <> 'cancelled'
  group by a.purchase_request_item_id
)
update public.purchase_request_items pri
set line_status = case
  when live.has_live and (pri.quantity_requested = 0 or live.has_tick) and live.has_done then 'arrived'
  when live.has_live and (pri.quantity_requested = 0 or live.has_tick) then 'ordered'
  when live.pri_id is null and pri.quantity_requested = 0 then 'closed'
  when live.pri_id is null and exists (
    select 1 from public.purchase_request_item_settlements s where s.purchase_request_item_id = pri.id
  ) then 'closed'
  else 'open'
end
from public.purchase_request_items pri2
left join live on live.pri_id = pri2.id
where pri.id = pri2.id;

-- Foreman's quantity back where the original is known.
update public.purchase_request_items
set quantity_requested = quantity_requested_original
where quantity_requested_original is not null
  and quantity_requested is distinct from quantity_requested_original;

-- Foreman's material back on the lines purchasing had swapped (3 so far). The
-- unit stays what the request already says; if it was never set, take the
-- original material's.
update public.purchase_request_items pri
set unit = coalesce(pri.unit, (select mt.unit from public.material_types mt where mt.id = pri.original_material_type_id)),
    material_type_id = pri.original_material_type_id
where pri.original_material_type_id is not null
  and pri.material_type_id is distinct from pri.original_material_type_id;

-- The swap history column has no meaning any more.
update public.purchase_request_items set original_material_type_id = null
where original_material_type_id is not null;

-- Request status from the line states (only requests still being ordered).
do $$
declare
  v_pr uuid;
begin
  for v_pr in
    select id from public.purchase_requests where status in ('approved', 'ordered')
  loop
    perform public._pr_recompute_status(v_pr);
  end loop;
end $$;
