-- Allocation traceability: PR fulfilment with the actual PO material, the
-- original request kept as history, and BOQ attribution by allocation instead
-- of by PO header scope.
--
-- Builds on 202610060004_po_item_allocations.sql and 202610060005 (purchase_order_item_allocations
-- is the source of truth for "which slice of this PO line belongs to which
-- request line / plot"). That migration is NOT replaced - this one changes
-- only what has to change:
--
-- 1. Request line material = what purchasing actually ordered; the original
--    ask is history. po_create/po_update (unchanged here) already copy the PO
--    line's material onto every linked request line (202609150003), so the
--    active request line shows the purchased material for payout review. What
--    was missing was the history: purchase_request_items.original_material_type_id
--    is now filled by a trigger the first time a line's material changes, so
--    the foreman's original request is never lost. Allocation links and
--    quantities are untouched by the sync. Lines substituted before this
--    migration have no recorded original (nothing kept it) and stay null.
--      * _po_alloc_apply_qty compares units on each side's own material (the
--        request line's unit vs the PO line's unit).
--      * The material check in _po_item_set_allocations is NOT touched here:
--        202610060005 already lets purchasing pick any material on an
--        allocated line (only the unit must agree).
--
-- 2. boq_control_rollup / boq_control_material_detail / boq_control_unassigned
--    attribute an allocated PO line only through its allocations. Each
--    allocation counts for ITS request's plots (a single plot, or an even
--    split across a group / multi-plot request) with its own quantity and
--    unit_price; received quantity is the same share of what arrived. The
--    PO header's plot scope no longer applies to the allocated part of a
--    line, so a combined PO listing plots A and B does not put the whole line
--    on both. Any part of a line that NO allocation covers keeps the previous
--    header/override attribution, so nothing is dropped or double counted.
--    Cancelled and outside-BOQ orders stay excluded.
--    boq_control_material_detail gains po_item_id / purchase_request_id /
--    pr_no and one row per allocation, so a plot's figure traces back to the
--    PO line and the contributing PRs. Its return type changes, hence the
--    drop + create.
--
-- Lifecycle (edit / cancel / delete / close-short / receive) is unchanged:
-- those functions already move allocations and request balances together
-- (202610060004), and every BOQ figure here reads allocations live.

-- ---------------------------------------------------------------------------
-- Original-material history.
--
-- Deliberately a plain number with NO foreign key to material_types: a second
-- link between these two tables makes every existing query that embeds
-- material_types from a request line ambiguous, which would break the app
-- version already deployed the moment this runs. Names are looked up
-- separately by the code.
-- ---------------------------------------------------------------------------
alter table public.purchase_request_items
  add column if not exists original_material_type_id bigint;

create or replace function public._pri_keep_original_material()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.material_type_id is distinct from old.material_type_id and new.original_material_type_id is null then
    new.original_material_type_id := old.material_type_id;
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_request_items_keep_original_material on public.purchase_request_items;
create trigger purchase_request_items_keep_original_material
  before update of material_type_id on public.purchase_request_items
  for each row execute function public._pri_keep_original_material();

-- ---------------------------------------------------------------------------
-- _po_alloc_apply_qty: unit comparison per side (see header).
-- ---------------------------------------------------------------------------
create or replace function public._po_alloc_apply_qty(p_po_id uuid, p_sign int)
returns void
language sql
security definer
set search_path = public
as $$
  update public.purchase_request_items pri
  set quantity_requested = case
    when p_sign > 0 then pri.quantity_requested + t.qty
    else greatest(0, pri.quantity_requested - t.qty)
  end
  from (
    select a.purchase_request_item_id as pri_id, sum(a.quantity_allocated) as qty
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
    join public.material_types mt on mt.id = poi.material_type_id
    join public.purchase_request_items pri2 on pri2.id = a.purchase_request_item_id
    join public.material_types mt_pri on mt_pri.id = pri2.material_type_id
    where poi.purchase_order_id = p_po_id
      and coalesce(poi.unit, mt.unit) is not distinct from coalesce(pri2.unit, mt_pri.unit)
    group by a.purchase_request_item_id
  ) t
  where pri.id = t.pri_id;
$$;

revoke all on function public._po_alloc_apply_qty(uuid, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- boq_control_rollup: restated from 202609220002 with an allocation branch.
--
--   line_factor     the part of an ALLOCATED PO line that no allocation covers
--                   (1 for a line with no allocations, which is every line
--                   outside this feature). The existing header / override
--                   branches multiply by it, so they only see the unallocated
--                   remainder.
--   alloc_pr_plots  the plots of every request in this project, by the same
--                   three shapes a request carries (plot, group, ad-hoc set).
--   ordered_allocated  one slice per allocation, weighted by how much of the
--                   request's plot set falls inside the scope.
-- ---------------------------------------------------------------------------
create or replace function public.boq_control_rollup(
  p_project_id uuid,
  p_scope jsonb default '{}'::jsonb
)
returns table (
  material_type_id bigint,
  material_name text,
  unit text,
  planned_qty numeric,
  allowance_qty numeric,
  ordered_qty numeric,
  received_qty numeric,
  issued_qty numeric,
  ordered_value numeric,
  received_value numeric,
  is_estimated boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      p_project_id as project_id,
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
    where p.project_id = params.project_id
      and (
        (array_length(params.plot_ids, 1) is not null and p.id = any(params.plot_ids))
        or (
          array_length(params.plot_ids, 1) is null and params.plot_group_id is not null
          and p.id in (select pgm.plot_id from public.plot_group_members pgm where pgm.group_id = params.plot_group_id)
        )
        or (array_length(params.plot_ids, 1) is null and params.plot_group_id is null)
      )
  ),
  planned as (
    select
      bmi.material_type_id,
      sum(bmi.planned_quantity) as planned_qty,
      sum(
        bmi.planned_quantity
        * coalesce(nullif(bmi.waste_percent, 0), (select os.default_waste_percent from public.organization_settings os limit 1), 0)
        / 100
      ) as allowance_qty
    from scope_plots sp
    join public.plots pl on pl.id = sp.plot_id
    join public.boq_master bm on bm.house_model_id = pl.house_model_id
    join public.boq_material_items bmi on bmi.boq_id = bm.id
    group by bmi.material_type_id
  ),
  line_factor as (
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
  alloc_pr_plots as (
    select pr.id as pr_id, pr.plot_id as plot_id
    from public.purchase_requests pr
    where pr.project_id = p_project_id and pr.plot_id is not null
    union all
    select pr.id, pgm.plot_id
    from public.purchase_requests pr
    join public.plot_group_members pgm on pgm.group_id = pr.plot_group_id
    where pr.project_id = p_project_id and pr.plot_id is null and pr.plot_group_id is not null
    union all
    select pr.id, prp.plot_id
    from public.purchase_requests pr
    join public.purchase_request_plots prp on prp.purchase_request_id = pr.id
    where pr.project_id = p_project_id and pr.plot_id is null and pr.plot_group_id is null
  ),
  alloc_pr_weight as (
    select
      pr_id,
      count(*) as total_plots,
      count(*) filter (where plot_id in (select plot_id from scope_plots)) as scope_plots_count
    from alloc_pr_plots
    group by pr_id
  ),
  po_plots as (
    select po.id as po_id, po.plot_id as plot_id
    from public.purchase_orders po
    where po.project_id = p_project_id
      and po.status <> 'cancelled'
      and po.is_outside_boq = false
      and po.plot_id is not null
    union all
    select po.id, pgm.plot_id
    from public.purchase_orders po
    join public.plot_group_members pgm on pgm.group_id = po.plot_group_id
    where po.project_id = p_project_id
      and po.status <> 'cancelled'
      and po.is_outside_boq = false
      and po.plot_id is null
      and po.plot_group_id is not null
    union all
    select po.id, pop.plot_id
    from public.purchase_orders po
    join public.purchase_order_plots pop on pop.purchase_order_id = po.id
    where po.project_id = p_project_id
      and po.status <> 'cancelled'
      and po.is_outside_boq = false
      and po.plot_id is null
      and po.plot_group_id is null
  ),
  po_weight as (
    select
      po_id,
      count(*) as total_plots,
      count(*) filter (where plot_id in (select plot_id from scope_plots)) as scope_plots_count
    from po_plots
    group by po_id
  ),
  ordered_inherited as (
    select
      poi.material_type_id,
      sum(poi.quantity_ordered * coalesce(lf.rf, 1) * pw.scope_plots_count::numeric / pw.total_plots) as ordered_qty,
      sum(poi.quantity_received * coalesce(lf.rf, 1) * pw.scope_plots_count::numeric / pw.total_plots) as received_qty,
      sum(poi.quantity_ordered * coalesce(lf.rf, 1) * poi.unit_price * pw.scope_plots_count::numeric / pw.total_plots) as ordered_value,
      sum(poi.quantity_received * coalesce(lf.rf, 1) * poi.unit_price * pw.scope_plots_count::numeric / pw.total_plots) as received_value,
      bool_or(pw.scope_plots_count < pw.total_plots and pw.scope_plots_count > 0) as is_estimated
    from po_weight pw
    join public.purchase_order_items poi on poi.purchase_order_id = pw.po_id and poi.project_id is null
    left join line_factor lf on lf.poi_id = poi.id
    where pw.scope_plots_count > 0
      and coalesce(lf.rf, 1) > 0
    group by poi.material_type_id
  ),
  -- A line overridden to its own project/plot: single plot = weight 1, plot
  -- group = spread across its member plots, same treatment a whole
  -- group-scoped PO already gets - just computed per item instead of per PO.
  overridden_item_plots as (
    select poi.id as poi_id, pgm.plot_id as plot_id
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
    join public.plot_group_members pgm on pgm.group_id = poi.plot_group_id
    where poi.project_id = p_project_id and po.status <> 'cancelled'
    union all
    select poi.id, poi.plot_id
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
    where poi.project_id = p_project_id and po.status <> 'cancelled' and poi.plot_id is not null
  ),
  overridden_item_weight as (
    select poi_id, count(*) as total_plots,
      count(*) filter (where plot_id in (select plot_id from scope_plots)) as scope_plots_count
    from overridden_item_plots
    group by poi_id
  ),
  ordered_overridden as (
    select
      poi.material_type_id,
      sum(poi.quantity_ordered * coalesce(lf.rf, 1) * ow.scope_plots_count::numeric / ow.total_plots) as ordered_qty,
      sum(poi.quantity_received * coalesce(lf.rf, 1) * ow.scope_plots_count::numeric / ow.total_plots) as received_qty,
      sum(poi.quantity_ordered * coalesce(lf.rf, 1) * poi.unit_price * ow.scope_plots_count::numeric / ow.total_plots) as ordered_value,
      sum(poi.quantity_received * coalesce(lf.rf, 1) * poi.unit_price * ow.scope_plots_count::numeric / ow.total_plots) as received_value,
      bool_or(ow.scope_plots_count < ow.total_plots and ow.scope_plots_count > 0) as is_estimated
    from overridden_item_weight ow
    join public.purchase_order_items poi on poi.id = ow.poi_id
    left join line_factor lf on lf.poi_id = poi.id
    where ow.scope_plots_count > 0
      and coalesce(lf.rf, 1) > 0
    group by poi.material_type_id
  ),
  -- The allocated part of a line: each allocation's own quantity, for its
  -- request's plots only. Received follows the same share of the line.
  ordered_allocated as (
    select
      poi.material_type_id,
      sum(a.quantity_allocated * w.scope_plots_count::numeric / w.total_plots) as ordered_qty,
      sum(
        case when poi.quantity_ordered > 0 then poi.quantity_received * a.quantity_allocated / poi.quantity_ordered else 0 end
        * w.scope_plots_count::numeric / w.total_plots
      ) as received_qty,
      sum(a.quantity_allocated * poi.unit_price * w.scope_plots_count::numeric / w.total_plots) as ordered_value,
      sum(
        case when poi.quantity_ordered > 0 then poi.quantity_received * a.quantity_allocated / poi.quantity_ordered else 0 end
        * poi.unit_price * w.scope_plots_count::numeric / w.total_plots
      ) as received_value,
      bool_or(w.scope_plots_count < w.total_plots) as is_estimated
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
    join public.purchase_orders po on po.id = poi.purchase_order_id
      and po.status <> 'cancelled'
      and po.is_outside_boq = false
    join public.purchase_request_items pri on pri.id = a.purchase_request_item_id
    join alloc_pr_weight w on w.pr_id = pri.purchase_request_id
    where w.scope_plots_count > 0
    group by poi.material_type_id
  ),
  ordered as (
    select
      material_type_id,
      sum(ordered_qty) as ordered_qty,
      sum(received_qty) as received_qty,
      sum(ordered_value) as ordered_value,
      sum(received_value) as received_value,
      bool_or(is_estimated) as is_estimated
    from (
      select * from ordered_inherited
      union all
      select * from ordered_overridden
      union all
      select * from ordered_allocated
    ) combined
    group by material_type_id
  ),
  stock_plots as (
    select sm.id as sm_id, sm.plot_id as plot_id
    from public.stock_movements sm
    where sm.project_id = p_project_id
      and sm.type = 'out'
      and sm.plot_id is not null
    union all
    select sm.id, pgm.plot_id
    from public.stock_movements sm
    join public.plot_group_members pgm on pgm.group_id = sm.plot_group_id
    where sm.project_id = p_project_id
      and sm.type = 'out'
      and sm.plot_id is null
      and sm.plot_group_id is not null
  ),
  stock_weight as (
    select
      sm_id,
      count(*) as total_plots,
      count(*) filter (where plot_id in (select plot_id from scope_plots)) as scope_plots_count
    from stock_plots
    group by sm_id
  ),
  issued as (
    select
      sm.material_type_id,
      sum(sm.quantity * sw.scope_plots_count::numeric / sw.total_plots) as issued_qty,
      bool_or(sw.scope_plots_count < sw.total_plots and sw.scope_plots_count > 0) as is_estimated
    from stock_weight sw
    join public.stock_movements sm on sm.id = sw.sm_id
    where sw.scope_plots_count > 0
    group by sm.material_type_id
  ),
  all_materials as (
    select material_type_id from planned
    union
    select material_type_id from ordered
    union
    select material_type_id from issued
  )
  select
    am.material_type_id,
    mt.name as material_name,
    mt.unit,
    coalesce(p.planned_qty, 0) as planned_qty,
    coalesce(p.allowance_qty, 0) as allowance_qty,
    coalesce(o.ordered_qty, 0) as ordered_qty,
    coalesce(o.received_qty, 0) as received_qty,
    coalesce(i.issued_qty, 0) as issued_qty,
    coalesce(o.ordered_value, 0) as ordered_value,
    coalesce(o.received_value, 0) as received_value,
    coalesce(o.is_estimated, false) or coalesce(i.is_estimated, false) as is_estimated
  from all_materials am
  join public.material_types mt on mt.id = am.material_type_id
  left join planned p on p.material_type_id = am.material_type_id
  left join ordered o on o.material_type_id = am.material_type_id
  left join issued i on i.material_type_id = am.material_type_id
  order by mt.name;
$$;

revoke all on function public.boq_control_rollup(uuid, jsonb) from public;
revoke all on function public.boq_control_rollup(uuid, jsonb) from anon;
grant execute on function public.boq_control_rollup(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- boq_control_material_detail: restated from 202609220002. New columns
-- (po_item_id, purchase_request_id, pr_no) and one row per allocation, so a
-- plot's quantity can be followed back to the PO line and the requests that
-- contributed it. The unallocated remainder of a line keeps its old rows.
-- ---------------------------------------------------------------------------
drop function if exists public.boq_control_material_detail(uuid, bigint, jsonb);

create function public.boq_control_material_detail(
  p_project_id uuid,
  p_material_type_id bigint,
  p_scope jsonb default '{}'::jsonb
)
returns table (
  doc_kind text,
  doc_id uuid,
  doc_no text,
  doc_date date,
  supplier_name text,
  plot_label text,
  quantity numeric,
  weight numeric,
  status text,
  po_item_id uuid,
  purchase_request_id uuid,
  pr_no integer
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      p_project_id as project_id,
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
    where p.project_id = params.project_id
      and (
        (array_length(params.plot_ids, 1) is not null and p.id = any(params.plot_ids))
        or (
          array_length(params.plot_ids, 1) is null and params.plot_group_id is not null
          and p.id in (select pgm.plot_id from public.plot_group_members pgm where pgm.group_id = params.plot_group_id)
        )
        or (array_length(params.plot_ids, 1) is null and params.plot_group_id is null)
      )
  ),
  line_factor as (
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
  po_plots as (
    select po.id as po_id, po.plot_id as plot_id
    from public.purchase_orders po
    where po.project_id = p_project_id and po.status <> 'cancelled' and po.is_outside_boq = false and po.plot_id is not null
    union all
    select po.id, pgm.plot_id
    from public.purchase_orders po
    join public.plot_group_members pgm on pgm.group_id = po.plot_group_id
    where po.project_id = p_project_id and po.status <> 'cancelled' and po.is_outside_boq = false
      and po.plot_id is null and po.plot_group_id is not null
    union all
    select po.id, pop.plot_id
    from public.purchase_orders po
    join public.purchase_order_plots pop on pop.purchase_order_id = po.id
    where po.project_id = p_project_id and po.status <> 'cancelled' and po.is_outside_boq = false
      and po.plot_id is null and po.plot_group_id is null
  ),
  po_weight as (
    select po_id, count(*) as total_plots,
      count(*) filter (where plot_id in (select plot_id from scope_plots)) as scope_plots_count
    from po_plots
    group by po_id
  ),
  po_rows as (
    select
      'po'::text as doc_kind,
      po.id as doc_id,
      po.po_no as doc_no,
      po.order_date as doc_date,
      s.name as supplier_name,
      case
        when po.plot_id is not null then 'แปลง ' || coalesce(pl.name, '')
        when po.plot_group_id is not null then 'กลุ่ม ' || coalesce(pg.name, '')
        when exists (select 1 from public.purchase_order_plots pop where pop.purchase_order_id = po.id) then 'หลายแปลง'
        else 'ไม่ระบุแปลง'
      end as plot_label,
      sum(poi.quantity_ordered * coalesce(lf.rf, 1)) as quantity,
      max(pw.scope_plots_count::numeric / pw.total_plots) as weight,
      po.status as status,
      null::uuid as po_item_id,
      null::uuid as purchase_request_id,
      null::integer as pr_no
    from public.purchase_orders po
    join public.purchase_order_items poi on poi.purchase_order_id = po.id and poi.material_type_id = p_material_type_id and poi.project_id is null
    left join line_factor lf on lf.poi_id = poi.id
    join po_weight pw on pw.po_id = po.id
    left join public.suppliers s on s.id = po.supplier_id
    left join public.plots pl on pl.id = po.plot_id
    left join public.plot_groups pg on pg.id = po.plot_group_id
    where po.project_id = p_project_id and po.status <> 'cancelled' and po.is_outside_boq = false
      and coalesce(lf.rf, 1) > 0
    group by po.id, po.po_no, po.order_date, s.name, po.plot_id, pl.name, po.plot_group_id, pg.name, po.status
    having max(pw.scope_plots_count) > 0
  ),
  overridden_item_plots as (
    select poi.id as poi_id, pgm.plot_id as plot_id
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
    join public.plot_group_members pgm on pgm.group_id = poi.plot_group_id
    where poi.project_id = p_project_id and poi.material_type_id = p_material_type_id and po.status <> 'cancelled'
    union all
    select poi.id, poi.plot_id
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
    where poi.project_id = p_project_id and poi.material_type_id = p_material_type_id
      and po.status <> 'cancelled' and poi.plot_id is not null
  ),
  overridden_item_weight as (
    select poi_id, count(*) as total_plots,
      count(*) filter (where plot_id in (select plot_id from scope_plots)) as scope_plots_count
    from overridden_item_plots
    group by poi_id
  ),
  po_rows_overridden as (
    select
      'po'::text as doc_kind,
      po.id as doc_id,
      po.po_no as doc_no,
      po.order_date as doc_date,
      s.name as supplier_name,
      (
        case
          when poi.plot_id is not null then 'แปลง ' || coalesce(pl.name, '')
          when poi.plot_group_id is not null then 'กลุ่ม ' || coalesce(pg.name, '')
          else 'ไม่ระบุแปลง'
        end || ' (แยกจากใบสั่งซื้อหลัก)'
      ) as plot_label,
      poi.quantity_ordered * coalesce(lf.rf, 1) as quantity,
      ow.scope_plots_count::numeric / ow.total_plots as weight,
      po.status as status,
      poi.id as po_item_id,
      null::uuid as purchase_request_id,
      null::integer as pr_no
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
    join overridden_item_weight ow on ow.poi_id = poi.id
    left join line_factor lf on lf.poi_id = poi.id
    left join public.suppliers s on s.id = po.supplier_id
    left join public.plots pl on pl.id = poi.plot_id
    left join public.plot_groups pg on pg.id = poi.plot_group_id
    where ow.scope_plots_count > 0
      and coalesce(lf.rf, 1) > 0
  ),
  alloc_pr_plots as (
    select pr.id as pr_id, pr.plot_id as plot_id
    from public.purchase_requests pr
    where pr.project_id = p_project_id and pr.plot_id is not null
    union all
    select pr.id, pgm.plot_id
    from public.purchase_requests pr
    join public.plot_group_members pgm on pgm.group_id = pr.plot_group_id
    where pr.project_id = p_project_id and pr.plot_id is null and pr.plot_group_id is not null
    union all
    select pr.id, prp.plot_id
    from public.purchase_requests pr
    join public.purchase_request_plots prp on prp.purchase_request_id = pr.id
    where pr.project_id = p_project_id and pr.plot_id is null and pr.plot_group_id is null
  ),
  alloc_pr_weight as (
    select pr_id, count(*) as total_plots,
      count(*) filter (where plot_id in (select plot_id from scope_plots)) as scope_plots_count
    from alloc_pr_plots
    group by pr_id
  ),
  po_rows_alloc as (
    select
      'po'::text as doc_kind,
      po.id as doc_id,
      po.po_no as doc_no,
      po.order_date as doc_date,
      s.name as supplier_name,
      (
        case
          when pr.plot_id is not null then 'แปลง ' || coalesce(pl.name, '')
          when pr.plot_group_id is not null then 'กลุ่ม ' || coalesce(pg.name, '')
          when exists (select 1 from public.purchase_request_plots prp where prp.purchase_request_id = pr.id) then 'หลายแปลง'
          else 'ไม่ระบุแปลง'
        end || ' · PR #' || lpad(pr.pr_no::text, 4, '0')
      ) as plot_label,
      a.quantity_allocated as quantity,
      w.scope_plots_count::numeric / w.total_plots as weight,
      po.status as status,
      poi.id as po_item_id,
      pr.id as purchase_request_id,
      pr.pr_no as pr_no
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id and poi.material_type_id = p_material_type_id
    join public.purchase_orders po on po.id = poi.purchase_order_id
      and po.status <> 'cancelled' and po.is_outside_boq = false
    join public.purchase_request_items pri on pri.id = a.purchase_request_item_id
    join public.purchase_requests pr on pr.id = pri.purchase_request_id
    join alloc_pr_weight w on w.pr_id = pr.id
    left join public.suppliers s on s.id = po.supplier_id
    left join public.plots pl on pl.id = pr.plot_id
    left join public.plot_groups pg on pg.id = pr.plot_group_id
    where w.scope_plots_count > 0
  ),
  stock_plots as (
    select sm.id as sm_id, sm.plot_id as plot_id
    from public.stock_movements sm
    where sm.project_id = p_project_id and sm.type = 'out' and sm.plot_id is not null
    union all
    select sm.id, pgm.plot_id
    from public.stock_movements sm
    join public.plot_group_members pgm on pgm.group_id = sm.plot_group_id
    where sm.project_id = p_project_id and sm.type = 'out' and sm.plot_id is null and sm.plot_group_id is not null
  ),
  stock_weight as (
    select sm_id, count(*) as total_plots,
      count(*) filter (where plot_id in (select plot_id from scope_plots)) as scope_plots_count
    from stock_plots
    group by sm_id
  ),
  stock_rows as (
    select
      'stock_out'::text as doc_kind,
      sm.id as doc_id,
      null::text as doc_no,
      sm.created_at::date as doc_date,
      null::text as supplier_name,
      case
        when sm.plot_id is not null then 'แปลง ' || coalesce(pl.name, '')
        when sm.plot_group_id is not null then 'กลุ่ม ' || coalesce(pg.name, '')
        else 'ไม่ระบุแปลง'
      end as plot_label,
      sm.quantity as quantity,
      sw.scope_plots_count::numeric / sw.total_plots as weight,
      'issued'::text as status,
      null::uuid as po_item_id,
      null::uuid as purchase_request_id,
      null::integer as pr_no
    from public.stock_movements sm
    join stock_weight sw on sw.sm_id = sm.id
    left join public.plots pl on pl.id = sm.plot_id
    left join public.plot_groups pg on pg.id = sm.plot_group_id
    where sm.project_id = p_project_id and sm.type = 'out' and sm.material_type_id = p_material_type_id
      and sw.scope_plots_count > 0
  ),
  pr_plots as (
    select pr.id as pr_id, pr.plot_id as plot_id
    from public.purchase_requests pr
    where pr.project_id = p_project_id and pr.status not in ('rejected', 'cancelled') and pr.plot_id is not null
    union all
    select pr.id, pgm.plot_id
    from public.purchase_requests pr
    join public.plot_group_members pgm on pgm.group_id = pr.plot_group_id
    where pr.project_id = p_project_id and pr.status not in ('rejected', 'cancelled')
      and pr.plot_id is null and pr.plot_group_id is not null
    union all
    select pr.id, prp.plot_id
    from public.purchase_requests pr
    join public.purchase_request_plots prp on prp.purchase_request_id = pr.id
    where pr.project_id = p_project_id and pr.status not in ('rejected', 'cancelled')
      and pr.plot_id is null and pr.plot_group_id is null
  ),
  pr_weight as (
    select pr_id, count(*) as total_plots,
      count(*) filter (where plot_id in (select plot_id from scope_plots)) as scope_plots_count
    from pr_plots
    group by pr_id
  ),
  pr_rows as (
    select
      'pr'::text as doc_kind,
      pr.id as doc_id,
      '#' || lpad(pr.pr_no::text, 4, '0') as doc_no,
      pr.created_at::date as doc_date,
      null::text as supplier_name,
      case
        when pr.plot_id is not null then 'แปลง ' || coalesce(pl.name, '')
        when pr.plot_group_id is not null then 'กลุ่ม ' || coalesce(pg.name, '')
        when exists (select 1 from public.purchase_request_plots prp where prp.purchase_request_id = pr.id) then 'หลายแปลง'
        else 'ไม่ระบุแปลง'
      end as plot_label,
      sum(pri.quantity_requested) as quantity,
      max(pw.scope_plots_count::numeric / pw.total_plots) as weight,
      pr.status as status,
      null::uuid as po_item_id,
      pr.id as purchase_request_id,
      pr.pr_no as pr_no
    from public.purchase_requests pr
    join public.purchase_request_items pri on pri.purchase_request_id = pr.id and pri.material_type_id = p_material_type_id
    join pr_weight pw on pw.pr_id = pr.id
    left join public.plots pl on pl.id = pr.plot_id
    left join public.plot_groups pg on pg.id = pr.plot_group_id
    where pr.project_id = p_project_id and pr.status not in ('rejected', 'cancelled') and pri.quantity_requested > 0
    group by pr.id, pr.pr_no, pr.created_at, pr.plot_id, pl.name, pr.plot_group_id, pg.name, pr.status
    having max(pw.scope_plots_count) > 0
  )
  select * from po_rows
  union all
  select * from po_rows_overridden
  union all
  select * from po_rows_alloc
  union all
  select * from stock_rows
  union all
  select * from pr_rows
  order by doc_date desc nulls last;
$$;

revoke all on function public.boq_control_material_detail(uuid, bigint, jsonb) from public;
revoke all on function public.boq_control_material_detail(uuid, bigint, jsonb) from anon;
grant execute on function public.boq_control_material_detail(uuid, bigint, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- boq_control_unassigned: restated from 202609170004. Spend with no plot to
-- attribute it to: (a) lines of POs with no plot tag - only the part no
-- allocation covers - and (b) allocations whose request names no plots.
-- An allocation to a request WITH plots is assigned, so it never shows here.
-- ---------------------------------------------------------------------------
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
      and po.project_id = p_project_id and po.status <> 'cancelled' and po.is_outside_boq = false
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
