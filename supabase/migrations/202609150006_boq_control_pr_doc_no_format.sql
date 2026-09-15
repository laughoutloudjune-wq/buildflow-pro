-- boq_control_material_detail's PR rows showed the bare pr_no ("4") as
-- doc_no, unlike every other place in the app that displays a request
-- number - PurchaseRequestsPageClient.tsx, the detail page, and
-- NotificationBell.tsx all format it "#0004" (padStart 4, '0'). Match that
-- convention so the drill-down panel's PR link reads the same as
-- everywhere else, instead of looking like a stray unformatted number next
-- to "PO-20260908002" in the same column.
--
-- Only the one expression changes; the rest of the function is restated
-- unchanged (no partial function replace in Postgres) from
-- 202609150001_boq_qty_control.sql.

create or replace function public.boq_control_material_detail(
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
  status text
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
      sum(poi.quantity_ordered) as quantity,
      max(pw.scope_plots_count::numeric / pw.total_plots) as weight,
      po.status as status
    from public.purchase_orders po
    join public.purchase_order_items poi on poi.purchase_order_id = po.id and poi.material_type_id = p_material_type_id
    join po_weight pw on pw.po_id = po.id
    left join public.suppliers s on s.id = po.supplier_id
    left join public.plots pl on pl.id = po.plot_id
    left join public.plot_groups pg on pg.id = po.plot_group_id
    where po.project_id = p_project_id and po.status <> 'cancelled' and po.is_outside_boq = false
    group by po.id, po.po_no, po.order_date, s.name, po.plot_id, pl.name, po.plot_group_id, pg.name, po.status
    having max(pw.scope_plots_count) > 0
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
      'issued'::text as status
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
      pr.status as status
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
  select * from stock_rows
  union all
  select * from pr_rows
  order by doc_date desc nulls last;
$$;

revoke all on function public.boq_control_material_detail(uuid, bigint, jsonb) from public;
revoke all on function public.boq_control_material_detail(uuid, bigint, jsonb) from anon;
grant execute on function public.boq_control_material_detail(uuid, bigint, jsonb) to authenticated;
