-- A request line was only moved to "ordered" when its purchase order line had
-- the "this order covers it" box ticked (closes_request_line). Lines linked
-- through allocations (orders made from the request, or combined requests)
-- never get that flag, so a request whose full quantity was already on a PO
-- still showed "open" and stayed in the "waiting for a PO" pile.
--
-- A line now also counts as ordered when the quantities allocated to it on
-- live orders, in the line's own unit, add up to what was asked. Different
-- units are never added together, so a line bought in another unit stays open
-- until it is covered or closed by hand, as before. Partly covered lines
-- (e.g. 17 of 20) stay open.
--
-- Safe to run twice. No tables or signatures change.

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
    when (
      select coalesce(sum(a.quantity_allocated), 0)
      from public.purchase_order_item_allocations a
      join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
      join public.purchase_orders po on po.id = poi.purchase_order_id
      join public.purchase_request_items pri on pri.id = a.purchase_request_item_id
      join public.material_types mt on mt.id = pri.material_type_id
      where a.purchase_request_item_id = p_pri_id
        and po.status <> 'cancelled'
        and coalesce(nullif(btrim(poi.unit), ''), btrim(mt.unit)) = coalesce(nullif(btrim(pri.unit), ''), btrim(mt.unit))
    ) >= (select quantity_requested from public.purchase_request_items where id = p_pri_id)
      and exists (select 1 from public.purchase_order_item_allocations a2 where a2.purchase_request_item_id = p_pri_id)
    then 'ordered'
    when exists (
      select 1 from public.purchase_request_item_settlements s where s.purchase_request_item_id = p_pri_id
    ) then 'closed'
    else 'open'
  end;
$$;

-- The rule above also depends on the order line's unit and quantity, so
-- changing either re-checks the requests it is linked to (the other triggers
-- already cover allocation changes, order status changes and the covers box).
create or replace trigger purchase_order_items_unit_qty_resync
  after update of unit, quantity_ordered on public.purchase_order_items
  for each row
  when (old.unit is distinct from new.unit or old.quantity_ordered is distinct from new.quantity_ordered)
  execute function public._poi_covers_resync_trigger();

-- Bring lines that are already fully allocated up to date (this also
-- recomputes each request's status).
select public._pri_resync_material(pri.id)
from public.purchase_request_items pri
where pri.line_status = 'open'
  and exists (select 1 from public.purchase_order_item_allocations a where a.purchase_request_item_id = pri.id);
