-- Partial PO fulfillment (202609090004) only settles a purchase request line
-- when a PO created *from that request* covers it. Three real cases fall
-- outside that:
--
--   1. The brand actually bought differs from the one on the request. Swapping
--      the material in place on a prefilled PO row keeps the link, but the
--      natural gesture - delete the row, add a new one - loses it, and the PR
--      line stays outstanding forever with nothing on screen to say so.
--   2. The PO was built standalone, never "from" the request. po_create only
--      touches a PR when purchase_request_id is set, so nothing settles.
--   3. The line is simply never going to be ordered. Dropping it from the PO
--      leaves it outstanding, so the request can never reach 'ordered'.
--
-- All three need the same thing: a human saying "this quantity is handled,
-- stop asking". This records that as its own row rather than just decrementing
-- quantity_requested the way po_create does, so a manual settle is undoable
-- and carries who/when/why - it is a judgement call, not a derived fact.
create table if not exists public.purchase_request_item_settlements (
  id uuid primary key default gen_random_uuid(),
  purchase_request_item_id uuid not null references public.purchase_request_items(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  -- 'ordered'   - bought, just not through a PO linked to this request
  --               (different brand, or a PO raised standalone).
  -- 'cancelled' - not being bought at all; closes the line so the request
  --               can finish instead of hanging on a dead item.
  reason text not null check (reason in ('ordered', 'cancelled')),
  -- Free text on purpose: the PO it refers to may be one of ours, a supplier's
  -- own reference, or nothing at all. Upgrading this to a real
  -- purchase_orders FK later is additive and needs no UI change.
  po_ref text,
  note text,
  settled_by uuid not null references public.profiles(id),
  settled_at timestamptz not null default now()
);
create index if not exists purchase_request_item_settlements_item_idx
  on public.purchase_request_item_settlements (purchase_request_item_id);

alter table public.purchase_request_item_settlements enable row level security;

drop policy if exists "purchase_request_item_settlements_select" on public.purchase_request_item_settlements;
create policy "purchase_request_item_settlements_select"
  on public.purchase_request_item_settlements for select to authenticated using (true);

grant select on public.purchase_request_item_settlements to authenticated;

-- ---------------------------------------------------------------------------
-- pr_item_settle: close some quantity on one or more lines of an approved
-- request by hand. Mirrors po_create's consumption exactly - subtract from
-- quantity_requested, then move the request to 'ordered' only once every line
-- has hit 0 - so a manual settle and a PO-driven one are indistinguishable to
-- everything downstream.
-- ---------------------------------------------------------------------------
create or replace function public.pr_item_settle(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_pr_id uuid := public._jsonb_to_uuid(p_payload->'purchase_request_id');
  v_reason text := coalesce(nullif(p_payload->>'reason', ''), 'ordered');
  v_po_ref text := nullif(btrim(coalesce(p_payload->>'po_ref', '')), '');
  v_note text := nullif(btrim(coalesce(p_payload->>'note', '')), '');
  v_status text;
  v_settled int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can settle a purchase request line' using errcode = '42501';
  end if;
  if v_reason not in ('ordered', 'cancelled') then
    raise exception 'Unknown settlement reason' using errcode = '22023';
  end if;

  select status into v_status from public.purchase_requests where id = v_pr_id;
  if v_status is null then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;
  -- Same gate as "create PO from this request": anything not approved either
  -- has nothing outstanding left or was never cleared to be bought.
  if v_status <> 'approved' then
    raise exception 'Only an approved purchase request can be settled by hand' using errcode = '42501';
  end if;

  -- Clamping instead of erroring would silently record a quantity nobody
  -- asked for, so reject the whole call and let the UI say which line is off.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    join public.purchase_request_items pri
      on pri.id = public._jsonb_to_uuid(i->'purchase_request_item_id')
    where pri.purchase_request_id = v_pr_id
      and coalesce((i->>'quantity')::numeric, 0) > pri.quantity_requested
  ) then
    raise exception 'Settled quantity exceeds what is still outstanding' using errcode = '22023';
  end if;

  with picked as (
    select
      public._jsonb_to_uuid(i->'purchase_request_item_id') as item_id,
      coalesce((i->>'quantity')::numeric, 0) as qty
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  ),
  -- Join through purchase_request_items so an item id belonging to some other
  -- request can't be settled by passing it in the payload.
  valid as (
    select picked.item_id, picked.qty
    from picked
    join public.purchase_request_items pri on pri.id = picked.item_id
    where pri.purchase_request_id = v_pr_id
      and picked.qty > 0
  ),
  inserted as (
    insert into public.purchase_request_item_settlements
      (purchase_request_item_id, quantity, reason, po_ref, note, settled_by)
    select item_id, qty, v_reason, v_po_ref, v_note, v_uid from valid
    returning 1
  )
  select count(*) into v_settled from inserted;

  if v_settled = 0 then
    raise exception 'Select at least one line to settle' using errcode = '22023';
  end if;

  update public.purchase_request_items pri
  set quantity_requested = greatest(0, pri.quantity_requested - picked.qty)
  from (
    select
      public._jsonb_to_uuid(i->'purchase_request_item_id') as item_id,
      sum(coalesce((i->>'quantity')::numeric, 0)) as qty
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    group by 1
  ) picked
  where pri.id = picked.item_id
    and pri.purchase_request_id = v_pr_id;

  update public.purchase_requests
  set status = case
    when exists (
      select 1 from public.purchase_request_items
      where purchase_request_id = v_pr_id and quantity_requested > 0
    ) then 'approved'
    else 'ordered'
  end
  where id = v_pr_id and status = 'approved';

  return jsonb_build_object('id', v_pr_id, 'settled', v_settled);
end;
$fn$;

grant execute on function public.pr_item_settle(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- pr_item_settle_undo: give one manual settlement's quantity back. Only ever
-- touches rows this table owns, so it can't disturb what a PO consumed.
-- ---------------------------------------------------------------------------
create or replace function public.pr_item_settle_undo(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_item_id uuid;
  v_qty numeric;
  v_pr_id uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can undo a settlement' using errcode = '42501';
  end if;

  select s.purchase_request_item_id, s.quantity, pri.purchase_request_id, pr.status
  into v_item_id, v_qty, v_pr_id, v_status
  from public.purchase_request_item_settlements s
  join public.purchase_request_items pri on pri.id = s.purchase_request_item_id
  join public.purchase_requests pr on pr.id = pri.purchase_request_id
  where s.id = p_id;

  if v_item_id is null then
    raise exception 'Settlement not found' using errcode = 'P0002';
  end if;
  -- Past 'ordered' the request has goods receipts and possibly payments
  -- hanging off it; re-opening a line then would put quantity back that
  -- nothing downstream expects to see move.
  if v_status not in ('approved', 'ordered') then
    raise exception 'Cannot undo a settlement once the request has been received or closed' using errcode = '42501';
  end if;

  delete from public.purchase_request_item_settlements where id = p_id;

  update public.purchase_request_items
  set quantity_requested = quantity_requested + v_qty
  where id = v_item_id;

  -- Giving quantity back re-opens the request if it had been closed out.
  update public.purchase_requests
  set status = 'approved'
  where id = v_pr_id and status = 'ordered';

  return jsonb_build_object('id', v_pr_id);
end;
$fn$;

grant execute on function public.pr_item_settle_undo(uuid) to authenticated;
