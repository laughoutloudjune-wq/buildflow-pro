-- A request line only counted as ordered when its allocations were in the same
-- unit text as the ask. A request written in the placeholder unit "unit" (the
-- material's own unit) against a PO line in another unit that has a saved
-- conversion (e.g. 10 unit vs 10 เส้น, 1 เส้น = 1 master unit) stayed "open",
-- so the request kept saying "not ordered" although its PO existed (PR-73).
--
-- _pri_line_state now compares both sides in the material's master unit using
-- unit_factor(). A side whose conversion is unknown is left out (never a mixed-unit
-- sum), so a line with no known conversion stays open as before, until it is
-- converted or closed by hand. Saving a conversion re-checks the open lines of
-- that material.
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
    when exists (select 1 from public.purchase_order_item_allocations a2 where a2.purchase_request_item_id = p_pri_id)
      and (
        select coalesce(sum(a.quantity_allocated / public.unit_factor(pri.material_type_id, poi.unit))
                        filter (where public.unit_factor(pri.material_type_id, poi.unit) is not null), 0)
        from public.purchase_order_item_allocations a
        join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
        join public.purchase_orders po on po.id = poi.purchase_order_id
        join public.purchase_request_items pri on pri.id = a.purchase_request_item_id
        where a.purchase_request_item_id = p_pri_id
          and po.status <> 'cancelled'
      ) >= (
        select pri.quantity_requested / public.unit_factor(pri.material_type_id, pri.unit)
        from public.purchase_request_items pri
        where pri.id = p_pri_id
          and public.unit_factor(pri.material_type_id, pri.unit) is not null
      )
    then 'ordered'
    when exists (
      select 1 from public.purchase_request_item_settlements s where s.purchase_request_item_id = p_pri_id
    ) then 'closed'
    else 'open'
  end;
$$;

create or replace function public._muc_resync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pri uuid;
begin
  for v_pri in
    select id from public.purchase_request_items
    where material_type_id = new.material_type_id and line_status = 'open'
  loop
    perform public._pri_resync_material(v_pri);
  end loop;
  return null;
end;
$$;

create or replace trigger material_unit_conversions_resync
  after insert or update on public.material_unit_conversions
  for each row execute function public._muc_resync_trigger();

-- Bring open lines that already have an order up to date.
select public._pri_resync_material(pri.id)
from public.purchase_request_items pri
where pri.line_status = 'open'
  and exists (select 1 from public.purchase_order_item_allocations a where a.purchase_request_item_id = pri.id);
