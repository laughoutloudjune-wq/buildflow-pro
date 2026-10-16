-- Money value of store withdrawals, for the cost ledger / BOQ comparison.
--
-- A store-stock PO has no plot, so boq_control_rollup never counts its value
-- (it only follows POs that name a plot) - which is right: the purchase must
-- not hit any plot until a contractor request draws it. The withdrawal
-- (stock_movements, source_type = 'manual_request') already counts as
-- issued_qty ("ใช้จริง") but carried no baht, so a plot's cost looked lower
-- than it was. This adds the missing value without touching
-- boq_control_rollup:
--   issued value = withdrawn qty x the store's average buying price
-- for that material, split across a batch exactly like issued_qty.
-- Straight-to-plot deliveries (direct_to_site) are NOT valued here: their PO
-- names the plot, so ordered_value already carries them (no double count).

create or replace function public.store_material_unit_cost(p_material_type_id bigint)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  -- Weighted average net price (after line discount, before VAT) of every
  -- live PO line bought for the store. Received qty is the weight; if nothing
  -- is received yet, fall back to ordered qty.
  with lines as (
    select
      poi.quantity_ordered,
      poi.quantity_received,
      poi.unit_price,
      case when poi.quantity_ordered > 0 then poi.discount_amount / poi.quantity_ordered else 0 end as disc_per_unit
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
    join public.projects pr on pr.id = coalesce(poi.project_id, po.project_id)
    where poi.material_type_id = p_material_type_id
      and pr.kind = 'store'
      and po.status <> 'cancelled'
  ),
  received as (
    select sum(quantity_received * (unit_price - disc_per_unit)) / nullif(sum(quantity_received), 0) as cost
    from lines where quantity_received > 0
  ),
  ordered as (
    select sum(quantity_ordered * (unit_price - disc_per_unit)) / nullif(sum(quantity_ordered), 0) as cost
    from lines where quantity_ordered > 0
  )
  -- Stock that never came through a store PO (opening balance, goods bought
  -- for a plot and then received into the store) is priced at the material's
  -- average price on any live PO line; 0 when it was never bought.
  , any_po as (
    select sum(poi.quantity_ordered * (poi.unit_price - case when poi.quantity_ordered > 0 then poi.discount_amount / poi.quantity_ordered else 0 end))
           / nullif(sum(poi.quantity_ordered), 0) as cost
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
    where poi.material_type_id = p_material_type_id and po.status <> 'cancelled' and poi.quantity_ordered > 0
  )
  select coalesce((select cost from received), (select cost from ordered), (select cost from any_po), 0);
$$;

create or replace function public.boq_control_issued_value(p_project_id uuid, p_scope jsonb default '{}'::jsonb)
returns table(material_type_id bigint, issued_value numeric)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(p_scope->>'plot_group_id', '')::uuid as plot_group_id,
      coalesce(
        (select array_agg(elem::uuid) from jsonb_array_elements_text(coalesce(p_scope->'plot_ids', '[]'::jsonb)) elem),
        array[]::uuid[]
      ) as plot_ids
  ),
  scope_plots as (
    select p.id as plot_id
    from public.plots p
    cross join params
    where p.project_id = p_project_id
      and (
        (array_length(params.plot_ids, 1) is not null and p.id = any(params.plot_ids))
        or (
          array_length(params.plot_ids, 1) is null and params.plot_group_id is not null
          and p.id in (select pgm.plot_id from public.plot_group_members pgm where pgm.group_id = params.plot_group_id)
        )
        or (array_length(params.plot_ids, 1) is null and params.plot_group_id is null)
      )
  ),
  stock_plots as (
    select sm.id as sm_id, sm.plot_id
    from public.stock_movements sm
    where sm.project_id = p_project_id and sm.type = 'out' and sm.source_type = 'manual_request'
      and sm.plot_id is not null
    union all
    select sm.id, pgm.plot_id
    from public.stock_movements sm
    join public.plot_group_members pgm on pgm.group_id = sm.plot_group_id
    where sm.project_id = p_project_id and sm.type = 'out' and sm.source_type = 'manual_request'
      and sm.plot_id is null and sm.plot_group_id is not null
  ),
  stock_weight as (
    select
      sm_id,
      count(*) as total_plots,
      count(*) filter (where plot_id in (select plot_id from scope_plots)) as scope_plots_count
    from stock_plots
    group by sm_id
  ),
  per_material as (
    select sm.material_type_id, sum(sm.quantity * sw.scope_plots_count::numeric / sw.total_plots) as qty
    from stock_weight sw
    join public.stock_movements sm on sm.id = sw.sm_id
    where sw.scope_plots_count > 0
    group by sm.material_type_id
  )
  select pm.material_type_id, pm.qty * public.store_material_unit_cost(pm.material_type_id)
  from per_material pm;
$$;

revoke all on function public.store_material_unit_cost(bigint) from public, anon;
revoke all on function public.boq_control_issued_value(uuid, jsonb) from public, anon;
grant execute on function public.store_material_unit_cost(bigint) to authenticated;
grant execute on function public.boq_control_issued_value(uuid, jsonb) to authenticated;
