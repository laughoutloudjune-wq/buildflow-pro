-- A purchase request line that already has a purchase order on it kept showing
-- "waiting for a PO" when the PO line was in a unit that has no typed
-- conversion to the material's master unit (live: request line 5 "unit" on
-- PO-20261031002 written as 5 "ใบ" for a material kept in "แผ่น").
-- _pri_line_state only counted an allocation when unit_factor() was known, so
-- the line stayed 'open' and the request stayed in the "order" pile.
--
-- Now an unknown unit counts at face value (1:1), the same way an empty unit
-- already does. A real conversion, once typed, still wins; the "ขอเป็นหน่วยอื่น"
-- chip still flags the mismatch. This covers every future PO the same way.
--
-- Also re-checks the lines that are still 'open' but have a live allocation
-- (only 'open' lines: nothing already ordered/arrived/closed is touched).
-- Nothing is removed. Safe to run twice. Builds on 202610260002.

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
        -- A PO unit with no typed conversion counts at face value (1:1)
        -- instead of making the whole line look unordered.
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
    then 'ordered'
    when exists (
      select 1 from public.purchase_request_item_settlements s where s.purchase_request_item_id = p_pri_id
    ) then 'closed'
    else 'open'
  end;
$$;

select public._pri_resync_material(pri.id)
from public.purchase_request_items pri
where pri.line_status = 'open'
  and exists (
    select 1 from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
    join public.purchase_orders po on po.id = poi.purchase_order_id
    where a.purchase_request_item_id = pri.id and po.status <> 'cancelled'
  );
