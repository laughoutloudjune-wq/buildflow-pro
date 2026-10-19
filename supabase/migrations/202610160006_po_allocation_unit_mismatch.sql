-- A request line asked in a different unit than the order line no longer
-- blocks saving a purchase order.
--
-- _po_item_set_allocations used to raise "A purchase request line is in a
-- different unit than the order line" for any explicit allocation whose
-- request unit differed from the PO line's unit. Request lines keep the unit
-- they were typed in ("unit" placeholder, ลัง, ...) while the material's
-- catalog unit can differ or be corrected later, so a PO could become
-- impossible to save from the PR it was meant to answer.
--
-- The allocation is now recorded as the link, but nothing is ever added or
-- subtracted across units: _po_alloc_apply_qty (202610070001) already skips
-- different-unit allocations when counting the request line down, the request
-- screens already show them as "purchased in another unit"
-- (purchasesInOtherUnits), and _po_alloc_validate now leaves them out of the
-- remaining-quantity check. Same-unit behaviour is unchanged.
--
-- Both functions are restated in full from their live definitions
-- (_po_item_set_allocations from 202610070002) with only those changes.

create or replace function public._po_item_set_allocations(
  p_po_id uuid,
  p_poi_id uuid,
  p_allocs jsonb,
  p_strict boolean,
  p_po_project_id uuid,
  p_prior_pairs jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_qty numeric;
  v_line_material bigint;
  v_line_unit text;
  v_a record;
  v_pr_status text;
  v_pr_project uuid;
  v_pri_material bigint;
  v_pri_unit text;
  v_sum numeric := 0;
  v_count int := 0;
  v_sole uuid;
begin
  delete from public.purchase_order_item_allocations where purchase_order_item_id = p_poi_id;

  select poi.quantity_ordered, poi.material_type_id, coalesce(poi.unit, mt.unit)
  into v_line_qty, v_line_material, v_line_unit
  from public.purchase_order_items poi
  join public.material_types mt on mt.id = poi.material_type_id
  where poi.id = p_poi_id and poi.purchase_order_id = p_po_id;
  if not found then
    raise exception 'Purchase order line not found' using errcode = 'P0002';
  end if;

  if p_allocs is not null and jsonb_typeof(p_allocs) = 'array' and jsonb_array_length(p_allocs) > 0 then
    if exists (
      select 1 from jsonb_array_elements(p_allocs) e
      group by e->>'purchase_request_item_id' having count(*) > 1
    ) then
      raise exception 'A request line can only be allocated once per order line' using errcode = '22023';
    end if;

    for v_a in
      select public._jsonb_to_uuid(e->'purchase_request_item_id') as pri_id,
             nullif(e->>'quantity', '')::numeric as qty
      from jsonb_array_elements(p_allocs) e
    loop
      if v_a.pri_id is null then
        raise exception 'Allocation is missing its purchase request line' using errcode = '22023';
      end if;
      if v_a.qty is null or v_a.qty <= 0 then
        if p_strict then
          raise exception 'Allocated quantity must be greater than zero' using errcode = '22023';
        end if;
        continue;
      end if;

      select pr.status, pr.project_id, pri.material_type_id, coalesce(pri.unit, mt.unit)
      into v_pr_status, v_pr_project, v_pri_material, v_pri_unit
      from public.purchase_request_items pri
      join public.purchase_requests pr on pr.id = pri.purchase_request_id
      join public.material_types mt on mt.id = pri.material_type_id
      where pri.id = v_a.pri_id;
      if not found then
        raise exception 'Purchase request line not found' using errcode = 'P0002';
      end if;

      if p_strict then
        if v_pr_status not in ('approved', 'ordered') and not exists (
          select 1 from jsonb_array_elements(coalesce(p_prior_pairs, '[]'::jsonb)) pp
          where public._jsonb_to_uuid(pp->'poi') = p_poi_id
            and public._jsonb_to_uuid(pp->'pri') = v_a.pri_id
        ) then
          raise exception 'Only an approved purchase request can be ordered' using errcode = '22023';
        end if;
        -- A purchase request from ANOTHER project may be bought on this order
        -- (one supplier delivering to several sites): the allocation records
        -- which request - and so which project and plot - each slice is for,
        -- and BOQ follows the allocation, not the order's own project.
        -- Material is deliberately NOT required to match: purchasing picks what
        -- is actually bought (a different brand, say) and the request line is
        -- re-pointed to it by the substitution sync.
        -- Unit is NOT required to match either (was an error before
        -- 202610160006): a different-unit allocation is only a link, never
        -- counted against the request line (see _po_alloc_apply_qty).
      end if;

      insert into public.purchase_order_item_allocations (
        purchase_order_item_id, purchase_request_item_id, quantity_allocated, created_by
      ) values (p_poi_id, v_a.pri_id, v_a.qty, auth.uid());

      v_sum := v_sum + v_a.qty;
      v_count := v_count + 1;
      v_sole := v_a.pri_id;
    end loop;
  end if;

  if p_strict and abs(v_sum - v_line_qty) > 0.0001 then
    raise exception 'The order line quantity must equal the sum of its request allocations' using errcode = '22023';
  end if;

  -- Keep the legacy line-level link as a read path: set only when the line
  -- answers exactly one request line.
  update public.purchase_order_items
  set purchase_request_item_id = case when v_count = 1 then v_sole else null end
  where id = p_poi_id;
end;
$$;

revoke all on function public._po_item_set_allocations(uuid, uuid, jsonb, boolean, uuid, jsonb) from public, anon, authenticated;

create or replace function public._po_alloc_validate(p_po_id uuid, p_strict_pris uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
begin
  if p_strict_pris is null or cardinality(p_strict_pris) = 0 then
    return;
  end if;

  -- Only allocations counted in the request line's own unit are compared with
  -- what is still outstanding on it; a different-unit allocation is a link.
  for v_r in
    select pri.id as pri_id, pri.quantity_requested as remaining, sum(a.quantity_allocated) as alloc
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
    join public.material_types mt on mt.id = poi.material_type_id
    join public.purchase_request_items pri on pri.id = a.purchase_request_item_id
    join public.material_types mt_pri on mt_pri.id = pri.material_type_id
    where poi.purchase_order_id = p_po_id
      and a.purchase_request_item_id = any(p_strict_pris)
      and coalesce(poi.unit, mt.unit) is not distinct from coalesce(pri.unit, mt_pri.unit)
    group by pri.id, pri.quantity_requested
  loop
    if v_r.alloc > v_r.remaining + 0.0001 then
      raise exception 'Allocated quantity exceeds the remaining quantity on a purchase request line' using errcode = '22023';
    end if;
  end loop;

  if exists (
    select 1
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
    join public.purchase_order_item_allocations a2 on a2.purchase_request_item_id = a.purchase_request_item_id
    join public.purchase_order_items i2 on i2.id = a2.purchase_order_item_id
    join public.purchase_orders p2 on p2.id = i2.purchase_order_id
    where poi.purchase_order_id = p_po_id
      and a.purchase_request_item_id = any(p_strict_pris)
      and i2.closes_request_line
      and p2.status <> 'cancelled'
      and p2.id <> p_po_id
  ) then
    raise exception 'A purchase request line has already been closed by another purchase order' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public._po_alloc_validate(uuid, uuid[]) from public, anon, authenticated;
