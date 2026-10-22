-- Unit conversion for BOQ comparison.
--
-- Everything compared to the BOQ is counted in the material's master unit
-- (material_types.unit). A request or order line may be written in another
-- unit (purchase_request_items.unit / purchase_order_items.unit, free text).
-- Until now the BOQ rollup added those quantities up whatever their unit, so
-- "600 เส้น" against a BOQ counted in มัด looked like 600 มัด.
--
-- 1. material_unit_conversions: per material, how many `unit` make 1 master
--    unit (factor). Example: โครงซีลาย, unit 'เส้น', factor 10 (10 เส้น = 1 มัด).
--    base quantity = quantity / factor. Written by admin/pm through
--    material_unit_conversion_set; every signed-in staff role can read it.
-- 2. unit_factor(material, unit): 1 when the unit is empty, the master unit or
--    the literal placeholder 'unit'; the stored factor; NULL when unknown.
-- 3. boq_control_rollup / boq_control_unassigned / boq_control_material_detail
--    restated (from their live definitions) so PO quantities are converted to
--    the master unit. A line whose conversion is unknown adds 0 to the
--    quantities (never a mixed-unit sum) and is counted in
--    unconverted_lines; its baht value still counts. boq_control_rollup also
--    returns pending_qty: quantity on open request lines not yet on a PO.
--
-- Safe to run twice. Dropping the old rollup/detail signatures is needed
-- because their column lists change.

create table if not exists public.material_unit_conversions (
  id bigint generated always as identity primary key,
  material_type_id bigint not null references public.material_types(id) on delete cascade,
  unit text not null check (btrim(unit) <> ''),
  factor numeric not null check (factor > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (material_type_id, unit)
);

alter table public.material_unit_conversions enable row level security;

drop policy if exists material_unit_conversions_select on public.material_unit_conversions;
create policy material_unit_conversions_select on public.material_unit_conversions
  for select to authenticated
  using (public._billing_current_role() in ('admin', 'pm', 'foreman'));

revoke all on public.material_unit_conversions from anon;
grant select on public.material_unit_conversions to authenticated;

create or replace function public.material_unit_conversion_set(
  p_material_type_id bigint,
  p_unit text,
  p_factor numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_unit text := btrim(coalesce(p_unit, ''));
  v_master text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if public._billing_current_role() not in ('admin', 'pm') then
    raise exception 'No permission to set unit conversions' using errcode = '42501';
  end if;
  select btrim(unit) into v_master from public.material_types where id = p_material_type_id;
  if not found then
    raise exception 'Material not found' using errcode = 'P0002';
  end if;
  if v_unit = '' then
    raise exception 'Unit is required' using errcode = '22023';
  end if;
  if v_unit = v_master then
    raise exception 'That is already the master unit' using errcode = '22023';
  end if;
  if p_factor is null or p_factor <= 0 then
    raise exception 'Factor must be greater than zero' using errcode = '22023';
  end if;
  insert into public.material_unit_conversions (material_type_id, unit, factor, created_by)
  values (p_material_type_id, v_unit, p_factor, v_uid)
  on conflict (material_type_id, unit) do update set factor = excluded.factor;
end;
$$;

revoke all on function public.material_unit_conversion_set(bigint, text, numeric) from public, anon;
grant execute on function public.material_unit_conversion_set(bigint, text, numeric) to authenticated;

create or replace function public.unit_factor(p_material_type_id bigint, p_unit text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when nullif(btrim(coalesce(p_unit, '')), '') is null then 1::numeric
    when btrim(p_unit) = btrim(mt.unit) or btrim(p_unit) = 'unit' then 1::numeric
    else (
      select c.factor from public.material_unit_conversions c
      where c.material_type_id = p_material_type_id and c.unit = btrim(p_unit)
    )
  end
  from public.material_types mt
  where mt.id = p_material_type_id;
$$;

revoke all on function public.unit_factor(bigint, text) from public, anon;
grant execute on function public.unit_factor(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- boq_control_rollup
-- ---------------------------------------------------------------------------
drop function if exists public.boq_control_rollup(uuid, jsonb);

create or replace function public.boq_control_rollup(p_project_id uuid, p_scope jsonb default '{}'::jsonb)
returns table(
  material_type_id bigint, material_name text, unit text,
  planned_qty numeric, allowance_qty numeric, ordered_qty numeric, received_qty numeric, issued_qty numeric,
  ordered_value numeric, received_value numeric, is_estimated boolean,
  pending_qty numeric, unconverted_lines integer
)
language sql
stable security definer
set search_path to 'public'
as $function$
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
  -- how many of the line's own unit make 1 master unit (NULL = unknown)
  poi_unit as (
    select poi.id as poi_id, public.unit_factor(poi.material_type_id, poi.unit) as f
    from public.purchase_order_items poi
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
      sum(coalesce(poi.quantity_ordered / pu.f, 0) * coalesce(lf.rf, 1) * pw.scope_plots_count::numeric / pw.total_plots) as ordered_qty,
      sum(coalesce(poi.quantity_received / pu.f, 0) * coalesce(lf.rf, 1) * pw.scope_plots_count::numeric / pw.total_plots) as received_qty,
      sum(poi.quantity_ordered * coalesce(lf.rf, 1) * poi.unit_price * pw.scope_plots_count::numeric / pw.total_plots) as ordered_value,
      sum(poi.quantity_received * coalesce(lf.rf, 1) * poi.unit_price * pw.scope_plots_count::numeric / pw.total_plots) as received_value,
      bool_or(pw.scope_plots_count < pw.total_plots and pw.scope_plots_count > 0) as is_estimated,
      count(*) filter (where pu.f is null) as unconverted
    from po_weight pw
    join public.purchase_order_items poi on poi.purchase_order_id = pw.po_id and poi.project_id is null
    join poi_unit pu on pu.poi_id = poi.id
    left join line_factor lf on lf.poi_id = poi.id
    where pw.scope_plots_count > 0
      and coalesce(lf.rf, 1) > 0
    group by poi.material_type_id
  ),
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
      sum(coalesce(poi.quantity_ordered / pu.f, 0) * coalesce(lf.rf, 1) * ow.scope_plots_count::numeric / ow.total_plots) as ordered_qty,
      sum(coalesce(poi.quantity_received / pu.f, 0) * coalesce(lf.rf, 1) * ow.scope_plots_count::numeric / ow.total_plots) as received_qty,
      sum(poi.quantity_ordered * coalesce(lf.rf, 1) * poi.unit_price * ow.scope_plots_count::numeric / ow.total_plots) as ordered_value,
      sum(poi.quantity_received * coalesce(lf.rf, 1) * poi.unit_price * ow.scope_plots_count::numeric / ow.total_plots) as received_value,
      bool_or(ow.scope_plots_count < ow.total_plots and ow.scope_plots_count > 0) as is_estimated,
      count(*) filter (where pu.f is null) as unconverted
    from overridden_item_weight ow
    join public.purchase_order_items poi on poi.id = ow.poi_id
    join poi_unit pu on pu.poi_id = poi.id
    left join line_factor lf on lf.poi_id = poi.id
    where ow.scope_plots_count > 0
      and coalesce(lf.rf, 1) > 0
    group by poi.material_type_id
  ),
  ordered_allocated as (
    select
      poi.material_type_id,
      sum(coalesce(a.quantity_allocated / pu.f, 0) * w.scope_plots_count::numeric / w.total_plots) as ordered_qty,
      sum(
        case when poi.quantity_ordered > 0 then coalesce(poi.quantity_received / pu.f, 0) * a.quantity_allocated / poi.quantity_ordered else 0 end
        * w.scope_plots_count::numeric / w.total_plots
      ) as received_qty,
      sum(a.quantity_allocated * poi.unit_price * w.scope_plots_count::numeric / w.total_plots) as ordered_value,
      sum(
        case when poi.quantity_ordered > 0 then poi.quantity_received * a.quantity_allocated / poi.quantity_ordered else 0 end
        * poi.unit_price * w.scope_plots_count::numeric / w.total_plots
      ) as received_value,
      bool_or(
        w.scope_plots_count < w.total_plots
        or (alloc_n.n > 1 and poi.quantity_received > 0 and poi.quantity_received < poi.quantity_ordered)
      ) as is_estimated,
      count(*) filter (where pu.f is null) as unconverted
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
    join poi_unit pu on pu.poi_id = poi.id
    join (
      select purchase_order_item_id, count(*) as n
      from public.purchase_order_item_allocations
      group by purchase_order_item_id
    ) alloc_n on alloc_n.purchase_order_item_id = poi.id
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
      bool_or(is_estimated) as is_estimated,
      sum(unconverted) as unconverted
    from (
      select * from ordered_inherited
      union all
      select * from ordered_overridden
      union all
      select * from ordered_allocated
    ) combined
    group by material_type_id
  ),
  pending as (
    select
      pri.material_type_id,
      sum(pri.quantity_requested / pf.f * w.scope_plots_count::numeric / w.total_plots) filter (where pf.f is not null) as pending_qty,
      count(*) filter (where pf.f is null) as unconverted
    from public.purchase_request_items pri
    join public.purchase_requests pr on pr.id = pri.purchase_request_id
      and pr.project_id = p_project_id
      and pr.status in ('pending_review', 'approved')
    join alloc_pr_weight w on w.pr_id = pr.id
    cross join lateral (select public.unit_factor(pri.material_type_id, pri.unit) as f) pf
    where pri.line_status = 'open'
      and pri.quantity_requested > 0
      and w.scope_plots_count > 0
    group by pri.material_type_id
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
    coalesce(o.is_estimated, false) or coalesce(i.is_estimated, false) as is_estimated,
    coalesce(pe.pending_qty, 0) as pending_qty,
    (coalesce(o.unconverted, 0) + coalesce(pe.unconverted, 0))::int as unconverted_lines
  from all_materials am
  join public.material_types mt on mt.id = am.material_type_id
  left join planned p on p.material_type_id = am.material_type_id
  left join ordered o on o.material_type_id = am.material_type_id
  left join issued i on i.material_type_id = am.material_type_id
  left join pending pe on pe.material_type_id = am.material_type_id
  order by mt.name;
$function$;

revoke all on function public.boq_control_rollup(uuid, jsonb) from public, anon;
grant execute on function public.boq_control_rollup(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- boq_control_unassigned
-- ---------------------------------------------------------------------------
create or replace function public.boq_control_unassigned(p_project_id uuid)
returns table(material_type_id bigint, material_name text, unit text, ordered_qty numeric, ordered_value numeric, po_count integer)
language sql
stable security definer
set search_path to 'public'
as $function$
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
      coalesce(poi.quantity_ordered / public.unit_factor(poi.material_type_id, poi.unit), 0) * coalesce(lf.rf, 1) as qty,
      poi.quantity_ordered * coalesce(lf.rf, 1) * poi.unit_price as value
    from unassigned_pos up
    join public.purchase_order_items poi on poi.purchase_order_id = up.id
    left join line_factor lf on lf.poi_id = poi.id
    where coalesce(lf.rf, 1) > 0
    union all
    select
      poi.material_type_id,
      poi.purchase_order_id,
      coalesce(a.quantity_allocated / public.unit_factor(poi.material_type_id, poi.unit), 0),
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
$function$;

revoke all on function public.boq_control_unassigned(uuid) from public, anon;
grant execute on function public.boq_control_unassigned(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- boq_control_material_detail
-- Same rows as before, with quantity in the master unit. Extra columns:
--   raw_quantity / raw_unit: the document's own figure and unit,
--   convertible: false when the unit has no known conversion (quantity is 0),
--   total_plots: how many plots the document was bought/asked for.
-- ---------------------------------------------------------------------------
drop function if exists public.boq_control_material_detail(uuid, bigint, jsonb);

create or replace function public.boq_control_material_detail(p_project_id uuid, p_material_type_id bigint, p_scope jsonb default '{}'::jsonb)
returns table(
  doc_kind text, doc_id uuid, doc_no text, doc_date date, supplier_name text, plot_label text,
  quantity numeric, weight numeric, status text, po_item_id uuid, purchase_request_id uuid, pr_no integer,
  raw_quantity numeric, raw_unit text, convertible boolean, total_plots integer
)
language sql
stable security definer
set search_path to 'public'
as $function$
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
  master as (
    select btrim(unit) as unit from public.material_types where id = p_material_type_id
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
      end || case when lf.poi_id is not null then ' (ส่วนที่ไม่ได้ผูกใบขอซื้อ)' else '' end as plot_label,
      sum(coalesce(poi.quantity_ordered / public.unit_factor(poi.material_type_id, poi.unit), 0) * coalesce(lf.rf, 1)) as quantity,
      max(pw.scope_plots_count::numeric / pw.total_plots) as weight,
      po.status as status,
      null::uuid as po_item_id,
      null::uuid as purchase_request_id,
      null::integer as pr_no,
      sum(poi.quantity_ordered * coalesce(lf.rf, 1)) as raw_quantity,
      coalesce(nullif(btrim(poi.unit), ''), (select unit from master)) as raw_unit,
      bool_and(public.unit_factor(poi.material_type_id, poi.unit) is not null) as convertible,
      max(pw.total_plots)::integer as total_plots
    from public.purchase_orders po
    join public.purchase_order_items poi on poi.purchase_order_id = po.id and poi.material_type_id = p_material_type_id and poi.project_id is null
    left join line_factor lf on lf.poi_id = poi.id
    join po_weight pw on pw.po_id = po.id
    left join public.suppliers s on s.id = po.supplier_id
    left join public.plots pl on pl.id = po.plot_id
    left join public.plot_groups pg on pg.id = po.plot_group_id
    where po.project_id = p_project_id and po.status <> 'cancelled' and po.is_outside_boq = false
      and coalesce(lf.rf, 1) > 0
    group by po.id, po.po_no, po.order_date, s.name, po.plot_id, pl.name, po.plot_group_id, pg.name, po.status, (lf.poi_id is not null), coalesce(nullif(btrim(poi.unit), ''), (select unit from master))
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
        end || ' (แยกจากใบสั่งซื้อหลัก)' || case when lf.poi_id is not null then ' (ส่วนที่ไม่ได้ผูกใบขอซื้อ)' else '' end
      ) as plot_label,
      coalesce(poi.quantity_ordered / public.unit_factor(poi.material_type_id, poi.unit), 0) * coalesce(lf.rf, 1) as quantity,
      ow.scope_plots_count::numeric / ow.total_plots as weight,
      po.status as status,
      poi.id as po_item_id,
      null::uuid as purchase_request_id,
      null::integer as pr_no,
      poi.quantity_ordered * coalesce(lf.rf, 1) as raw_quantity,
      coalesce(nullif(btrim(poi.unit), ''), (select unit from master)) as raw_unit,
      public.unit_factor(poi.material_type_id, poi.unit) is not null as convertible,
      ow.total_plots::integer as total_plots
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
      coalesce(a.quantity_allocated / public.unit_factor(poi.material_type_id, poi.unit), 0) as quantity,
      w.scope_plots_count::numeric / w.total_plots as weight,
      po.status as status,
      poi.id as po_item_id,
      pr.id as purchase_request_id,
      pr.pr_no as pr_no,
      a.quantity_allocated as raw_quantity,
      coalesce(nullif(btrim(poi.unit), ''), (select unit from master)) as raw_unit,
      public.unit_factor(poi.material_type_id, poi.unit) is not null as convertible,
      w.total_plots::integer as total_plots
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
      null::integer as pr_no,
      sm.quantity as raw_quantity,
      (select unit from master) as raw_unit,
      true as convertible,
      sw.total_plots::integer as total_plots
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
      sum(coalesce(pri.quantity_requested / public.unit_factor(pri.material_type_id, pri.unit), 0)) as quantity,
      max(pw.scope_plots_count::numeric / pw.total_plots) as weight,
      pr.status as status,
      null::uuid as po_item_id,
      pr.id as purchase_request_id,
      pr.pr_no as pr_no,
      sum(pri.quantity_requested) as raw_quantity,
      coalesce(nullif(btrim(pri.unit), ''), (select unit from master)) as raw_unit,
      bool_and(public.unit_factor(pri.material_type_id, pri.unit) is not null) as convertible,
      max(pw.total_plots)::integer as total_plots
    from public.purchase_requests pr
    join public.purchase_request_items pri on pri.purchase_request_id = pr.id and pri.material_type_id = p_material_type_id
    join pr_weight pw on pw.pr_id = pr.id
    left join public.plots pl on pl.id = pr.plot_id
    left join public.plot_groups pg on pg.id = pr.plot_group_id
    where pr.project_id = p_project_id and pr.status not in ('rejected', 'cancelled') and pri.quantity_requested > 0
    group by pr.id, pr.pr_no, pr.created_at, pr.plot_id, pl.name, pr.plot_group_id, pg.name, pr.status, coalesce(nullif(btrim(pri.unit), ''), (select unit from master))
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
$function$;

revoke all on function public.boq_control_material_detail(uuid, bigint, jsonb) from public, anon;
grant execute on function public.boq_control_material_detail(uuid, bigint, jsonb) to authenticated, service_role;
