-- Cross-project purchase orders.
--
-- One supplier order may now draw on purchase requests from several projects
-- (sites). The only thing in the way was the check in _po_item_set_allocations
-- that every request must belong to the order's own project; it is removed.
-- Everything else about an allocation is still validated (approved request,
-- same unit, positive quantity within what is outstanding, slices summing to
-- the line quantity).
--
-- BOQ already attributes an allocation to ITS request's project and plots
-- (202610070001), so each site's BOQ only ever sees its own slice. The one
-- place that still assumed "order project = request project" is
-- boq_control_unassigned, restated below to key on the request's project.

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
        -- re-pointed to it by the substitution sync below. Only the unit has
        -- to agree, since quantities are summed in it.
        if v_pri_unit is distinct from v_line_unit then
          raise exception 'A purchase request line is in a different unit than the order line' using errcode = '22023';
        end if;
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

create or replace function public.boq_control_unassigned(p_project_id uuid)
returns table (
  material_type_id bigint,
  material_name text,
  unit text,
  ordered_qty numeric,
  ordered_value numeric,
  po_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with line_factor as (
    select
      a.purchase_order_item_id as poi_id,
      case
        when poi.quantity_ordered > 0 then greatest(0, 1 - sum(a.quantity_allocated) / poi.quantity_ordered)
        else 0
      end as rf
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
    group by a.purchase_order_item_id, poi.quantity_ordered
  ),
  unassigned_pos as (
    select po.id
    from public.purchase_orders po
    where po.project_id = p_project_id
      and po.status <> 'cancelled'
      and po.is_outside_boq = false
      and po.plot_id is null
      and (
        po.plot_group_id is null
        or not exists (select 1 from public.plot_group_members pgm where pgm.group_id = po.plot_group_id)
      )
      and not exists (select 1 from public.purchase_order_plots pop where pop.purchase_order_id = po.id)
  ),
  plotless_requests as (
    select pr.id
    from public.purchase_requests pr
    where pr.project_id = p_project_id
      and pr.plot_id is null
      and (
        pr.plot_group_id is null
        or not exists (select 1 from public.plot_group_members pgm where pgm.group_id = pr.plot_group_id)
      )
      and not exists (select 1 from public.purchase_request_plots prp where prp.purchase_request_id = pr.id)
  ),
  slices as (
    select
      poi.material_type_id,
      poi.purchase_order_id as po_id,
      poi.quantity_ordered * coalesce(lf.rf, 1) as qty,
      poi.quantity_ordered * coalesce(lf.rf, 1) * poi.unit_price as value
    from unassigned_pos up
    join public.purchase_order_items poi on poi.purchase_order_id = up.id
    left join line_factor lf on lf.poi_id = poi.id
    where coalesce(lf.rf, 1) > 0
    union all
    select
      poi.material_type_id,
      poi.purchase_order_id,
      a.quantity_allocated,
      a.quantity_allocated * poi.unit_price
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
    join public.purchase_orders po on po.id = poi.purchase_order_id
      and po.status <> 'cancelled' and po.is_outside_boq = false
    join public.purchase_request_items pri on pri.id = a.purchase_request_item_id
    join plotless_requests pq on pq.id = pri.purchase_request_id
  )
  select
    s.material_type_id,
    mt.name as material_name,
    mt.unit,
    sum(s.qty) as ordered_qty,
    sum(s.value) as ordered_value,
    count(distinct s.po_id)::int as po_count
  from slices s
  join public.material_types mt on mt.id = s.material_type_id
  group by s.material_type_id, mt.name, mt.unit
  order by mt.name;
$$;

revoke all on function public.boq_control_unassigned(uuid) from public;
revoke all on function public.boq_control_unassigned(uuid) from anon;
grant execute on function public.boq_control_unassigned(uuid) to authenticated;
