-- Procurement redesign, steps 1-2: additive foundations only.
--
-- Nothing in the app reads or writes any of this yet, and no existing function
-- is changed, so shipping this migration changes no behaviour. It adds the
-- columns and the cost view that the later steps (request line states, receiving
-- conversion, cost control on the new view) will build on. Design: the
-- "Procurement Workflow Redesign" doc, approved by June 2026-10-17.
--
-- purchase_request_items.line_status starts as 'open' everywhere; the next
-- migration (request lines by state) backfills and maintains it.

-- ---------------------------------------------------------------------------
-- 1. Request lines: keep what the foreman asked for, track coverage by state
-- ---------------------------------------------------------------------------
alter table public.purchase_request_items
  add column if not exists quantity_requested_original numeric,
  add column if not exists line_status text not null default 'open'
    check (line_status in ('open', 'ordered', 'arrived', 'closed')),
  add column if not exists close_reason text,
  add column if not exists closed_by uuid references auth.users(id),
  add column if not exists closed_at timestamptz;

-- Today po_create counts quantity_requested down by what was ordered, so many
-- lines read 0. Recover the original where it is certain: outstanding now
--   + what live (not cancelled) PO lines took from it in the same unit
--   + what was settled by hand.
-- A cancelled PO gave its quantity back when it was cancelled, so it must not
-- be added again. Lines whose PO lines use a different unit never had their
-- quantity reduced, so those links add nothing. Lines with no allocation or
-- settlement records and a quantity of 0 stay NULL (unknown), never guessed.
with taken as (
  select
    pri.id as pri_id,
    coalesce((
      select sum(a.quantity_allocated)
      from public.purchase_order_item_allocations a
      join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
      join public.purchase_orders po on po.id = poi.purchase_order_id
      join public.material_types mt on mt.id = poi.material_type_id
      where a.purchase_request_item_id = pri.id
        and po.status <> 'cancelled'
        and coalesce(nullif(poi.unit, ''), mt.unit) is not distinct from coalesce(nullif(pri.unit, ''), mt_r.unit)
    ), 0) as taken_qty,
    coalesce((
      select sum(s.quantity) from public.purchase_request_item_settlements s
      where s.purchase_request_item_id = pri.id
    ), 0) as settled_qty
  from public.purchase_request_items pri
  join public.material_types mt_r on mt_r.id = pri.material_type_id
)
update public.purchase_request_items pri
set quantity_requested_original = pri.quantity_requested + taken.taken_qty + taken.settled_qty
from taken
where taken.pri_id = pri.id
  and pri.quantity_requested_original is null
  and (pri.quantity_requested > 0 or taken.taken_qty + taken.settled_qty > 0);

-- ---------------------------------------------------------------------------
-- 2. PM review mark on a request (non-blocking comparison of request vs order)
-- ---------------------------------------------------------------------------
alter table public.purchase_requests
  add column if not exists pm_reviewed_by uuid references auth.users(id),
  add column if not exists pm_reviewed_at timestamptz,
  add column if not exists pm_review_comment text;

-- ---------------------------------------------------------------------------
-- 3. Brand rows point to a generic item (optional), so BOQ and request
--    comparison can roll brands up. NULL = compares as itself.
-- ---------------------------------------------------------------------------
alter table public.material_types
  add column if not exists generic_material_id bigint references public.material_types(id),
  add constraint material_types_generic_not_self check (generic_material_id is null or generic_material_id <> id);

create index if not exists material_types_generic_material_id_idx
  on public.material_types (generic_material_id) where generic_material_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Stock cost: frozen unit cost on every movement, average cost on the balance
-- ---------------------------------------------------------------------------
alter table public.stock_movements
  add column if not exists unit_cost numeric,
  add column if not exists unit_cost_estimated boolean not null default false;

alter table public.stock_balances
  add column if not exists avg_cost numeric;

-- Backfill 'out' movements once, marked estimated. Straight-to-site deliveries
-- take the price on their receipt line. Store withdrawals take the store
-- average the app uses today (store_material_unit_cost, 202610160005), frozen
-- from now on. Only rows with no cost yet are touched; nothing is re-priced
-- later.
update public.stock_movements sm
set unit_cost = gri.unit_price_at_receipt, unit_cost_estimated = true
from public.goods_receipt_items gri
where sm.type = 'out'
  and sm.source_type = 'direct_to_site'
  and sm.unit_cost is null
  and gri.id = sm.source_id;

update public.stock_movements sm
set unit_cost = public.store_material_unit_cost(sm.material_type_id), unit_cost_estimated = true
where sm.type = 'out'
  and sm.source_type = 'manual_request'
  and sm.unit_cost is null;

update public.stock_balances sb
set avg_cost = nullif(public.store_material_unit_cost(sb.material_type_id), 0)
where sb.avg_cost is null;

-- ---------------------------------------------------------------------------
-- 5. One place for plot cost: every stock-out that charges a plot or batch.
--    Added beside the existing numbers; cost control switches to it in step 5.
-- ---------------------------------------------------------------------------
create or replace view public.plot_cost_lines
with (security_invoker = true) as
select
  sm.id as stock_movement_id,
  sm.created_at,
  sm.project_id,
  sm.plot_id,
  sm.plot_group_id,
  sm.material_type_id,
  sm.source_type,
  sm.contractor_id,
  sm.issue_no,
  sm.quantity,
  sm.unit_cost,
  sm.unit_cost_estimated,
  round(sm.quantity * coalesce(sm.unit_cost, 0), 2) as value
from public.stock_movements sm
where sm.type = 'out'
  and sm.source_type in ('manual_request', 'direct_to_site')
  and (sm.plot_id is not null or sm.plot_group_id is not null);

grant select on public.plot_cost_lines to authenticated;
