-- BOQ quantity control (Phase 1 of BOQ_CONTROL_PLAN.md) - the join between
-- "what a house model should consume" (BOQ) and "what was really bought"
-- (PO lines + stock issue-outs).
--
-- Schema additions:
--   boq_material_items.waste_percent / organization_settings.default_waste_percent
--     - the control ceiling is BOQ + allowed waste, not the bare BOQ figure,
--       or every cut-waste material (tile, rebar, cement) reads as over.
--   purchase_orders.is_outside_boq / outside_boq_reason
--     - common area, office supplies and machinery have no BOQ line; without
--       this flag they inflate every variance on the control page.
--   po_boq_overrides
--     - the audit trail that makes this a control rather than a report: when
--       an owner signs off on an over-BOQ line, the reason is recorded and
--       printed on the PO. Decision is warn-and-record, never block (see
--       plan section 2) - site work must not stall while BOQ data is still
--       incomplete.
--
-- Functions:
--   boq_control_rollup(project, scope)     - one row per material: planned
--                                             vs ordered/received/issued.
--   boq_control_material_detail(...)       - the documents behind one row.
--   boq_control_unassigned(project)        - PO spend with no plot tag at
--                                             all, so it stays visible
--                                             instead of silently dropped.
--   po_boq_override_set(payload)           - records the owner's sign-off.
--
-- po_create / po_update are restated in full (Postgres has no partial
-- function replace) from their latest definition in
-- 202609120001_supplier_branches.sql, with only is_outside_boq /
-- outside_boq_reason added to the insert/update lists - same convention
-- that migration itself documents for supplier_branch_id.
--
-- Safe to run twice: every statement is `if not exists` / `create or
-- replace`.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.boq_material_items
  add column if not exists waste_percent numeric not null default 0;

alter table public.organization_settings
  add column if not exists default_waste_percent numeric not null default 0;

alter table public.purchase_orders
  add column if not exists is_outside_boq boolean not null default false;
alter table public.purchase_orders
  add column if not exists outside_boq_reason text;

create table if not exists public.po_boq_overrides (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  material_type_id bigint not null references public.material_types(id),
  planned_quantity numeric not null default 0,
  total_after_this_po numeric not null default 0,
  reason text not null,
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  unique (purchase_order_id, material_type_id)
);

create index if not exists po_boq_overrides_po_idx
  on public.po_boq_overrides (purchase_order_id);
create index if not exists purchase_order_items_material_idx
  on public.purchase_order_items (material_type_id);
create index if not exists boq_material_items_material_idx
  on public.boq_material_items (material_type_id);
create index if not exists stock_movements_material_idx
  on public.stock_movements (material_type_id, type);

alter table public.po_boq_overrides enable row level security;

drop policy if exists "po_boq_overrides_select" on public.po_boq_overrides;
create policy "po_boq_overrides_select"
  on public.po_boq_overrides for select to authenticated using (true);

-- Deliberately no insert/update policy - every write goes through
-- po_boq_override_set (security definer), which repeats the pm/admin check
-- as defence in depth.
grant select on public.po_boq_overrides to authenticated;
revoke all on public.po_boq_overrides from anon;

-- ---------------------------------------------------------------------------
-- boq_control_rollup: one row per material_type touched by either side
-- (planned or actual) of the scope, per plan section 5.
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
  -- Resolve the scope to a concrete plot set (plan 5.1): explicit plot_ids
  -- win, else a saved plot_group_id, else every plot in the project.
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
  -- Budget side: each plot in scope contributes its whole house model's BOQ
  -- (two plots of the same model contribute twice). Allowance falls back to
  -- the org-wide default when a line's own waste_percent is 0/unset.
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
  -- Actual side, POs: expand each non-cancelled, non-outside-BOQ PO's plot
  -- scope to its member plots (one of the 3 mutually-exclusive shapes -
  -- plan 5.3), then weight = |document_plots (intersect) scope_plots| /
  -- |document_plots|. A PO with no plot tag at all contributes zero rows
  -- here (weight 0 for every material), which is what routes it to
  -- boq_control_unassigned() instead.
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
  ordered as (
    select
      poi.material_type_id,
      sum(poi.quantity_ordered * pw.scope_plots_count::numeric / pw.total_plots) as ordered_qty,
      sum(poi.quantity_received * pw.scope_plots_count::numeric / pw.total_plots) as received_qty,
      sum(poi.quantity_ordered * poi.unit_price * pw.scope_plots_count::numeric / pw.total_plots) as ordered_value,
      sum(poi.quantity_received * poi.unit_price * pw.scope_plots_count::numeric / pw.total_plots) as received_value,
      bool_or(pw.scope_plots_count < pw.total_plots and pw.scope_plots_count > 0) as is_estimated
    from po_weight pw
    join public.purchase_order_items poi on poi.purchase_order_id = pw.po_id
    where pw.scope_plots_count > 0
    group by poi.material_type_id
  ),
  -- Actual side, stock issue-outs: same weight rule. stock_movements only
  -- ever carries plot_id XOR plot_group_id (no ad-hoc multi-plot shape), so
  -- there are two branches, not three.
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
  -- Union of planned + actual material ids (plan 5.5 / the
  -- getMaterialVarianceForJob convention): a material bought but never
  -- budgeted, or budgeted but never bought, must still show up.
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
-- boq_control_material_detail: the documents behind one row of the rollup,
-- for the expanded panel. Also surfaces open purchase requests for the same
-- material (doc_kind 'pr') so a pending ask is visible even before it
-- becomes a PO - shown for context only, never counted in the rollup
-- totals above.
-- ---------------------------------------------------------------------------

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
      pr.pr_no::text as doc_no,
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

-- ---------------------------------------------------------------------------
-- boq_control_unassigned: PO spend with no plot tag at all (plan 5.4/7.3) -
-- the complement of po_plots above. Never folded into a house's number, but
-- must stay visible rather than silently dropped (214 historical imports
-- will sit here permanently - that's correct, not a bug).
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
  with unassigned_pos as (
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
  )
  select
    poi.material_type_id,
    mt.name as material_name,
    mt.unit,
    sum(poi.quantity_ordered) as ordered_qty,
    sum(poi.quantity_ordered * poi.unit_price) as ordered_value,
    count(distinct poi.purchase_order_id)::int as po_count
  from unassigned_pos up
  join public.purchase_order_items poi on poi.purchase_order_id = up.id
  join public.material_types mt on mt.id = poi.material_type_id
  group by poi.material_type_id, mt.name, mt.unit
  order by mt.name;
$$;

revoke all on function public.boq_control_unassigned(uuid) from public;
revoke all on function public.boq_control_unassigned(uuid) from anon;
grant execute on function public.boq_control_unassigned(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- po_boq_override_set: records the owner's sign-off on an over-BOQ line.
-- PM/admin only; upserts on the (purchase_order_id, material_type_id) key
-- so re-acknowledging the same line (e.g. after editing the PO) updates the
-- existing record rather than erroring or duplicating.
-- ---------------------------------------------------------------------------

create or replace function public.po_boq_override_set(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_po_id uuid := public._jsonb_to_uuid(p_payload->'purchase_order_id');
  v_material_type_id bigint := (p_payload->>'material_type_id')::bigint;
  v_reason text := trim(both from coalesce(p_payload->>'reason', ''));
  v_row public.po_boq_overrides;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm', 'admin') then
    raise exception 'Only PM/Admin can approve a purchase over BOQ' using errcode = '42501';
  end if;
  if v_po_id is null or v_material_type_id is null then
    raise exception 'purchase_order_id and material_type_id are required' using errcode = '22023';
  end if;
  if v_reason = '' then
    raise exception 'A reason is required to approve a purchase over BOQ' using errcode = '22023';
  end if;

  insert into public.po_boq_overrides (
    purchase_order_id, material_type_id, planned_quantity, total_after_this_po, reason, approved_by, approved_at
  ) values (
    v_po_id,
    v_material_type_id,
    coalesce((p_payload->>'planned_quantity')::numeric, 0),
    coalesce((p_payload->>'total_after_this_po')::numeric, 0),
    v_reason,
    v_uid,
    now()
  )
  on conflict (purchase_order_id, material_type_id) do update set
    planned_quantity = excluded.planned_quantity,
    total_after_this_po = excluded.total_after_this_po,
    reason = excluded.reason,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'purchase_order_id', v_row.purchase_order_id,
    'material_type_id', v_row.material_type_id,
    'reason', v_row.reason,
    'approved_by', v_row.approved_by,
    'approved_at', v_row.approved_at
  );
end;
$$;

revoke all on function public.po_boq_override_set(jsonb) from public;
revoke all on function public.po_boq_override_set(jsonb) from anon;
grant execute on function public.po_boq_override_set(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- po_create / po_update: restated in full from 202609120001's definitions
-- (the latest as of this migration), adding only is_outside_boq and
-- outside_boq_reason to the insert/update lists. See the header comment on
-- why this can't be a partial ALTER.
-- ---------------------------------------------------------------------------

create or replace function public.po_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_supplier_branch_id uuid := public._jsonb_to_uuid(p_payload->'supplier_branch_id');
  v_role text := public._billing_current_role();
  v_po_id uuid;
  v_po_no text;
  v_order_date date := coalesce(nullif(p_payload->>'order_date', '')::date, current_date);
  v_seq int;
  v_pr_id uuid := public._jsonb_to_uuid(p_payload->'purchase_request_id');
  v_plot_ids_count int := jsonb_array_length(coalesce(p_payload->'plot_ids', '[]'::jsonb));
  v_plot_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_id') end;
  v_plot_group_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_group_id') end;
  v_vat_percent numeric := coalesce((p_payload->>'vat_percent')::numeric, 0);
  v_vat_type text := case when p_payload->>'vat_type' = 'inclusive' then 'inclusive' else 'exclusive' end;
  v_po_discount_type text := coalesce(nullif(p_payload->>'discount_type', ''), 'none');
  v_po_discount_value numeric := coalesce((p_payload->>'discount_value')::numeric, 0);
  v_subtotal numeric := 0;
  v_line_discount_total numeric := 0;
  v_after_line_discounts numeric;
  v_po_discount_amount numeric := 0;
  v_combined_discount numeric;
  v_net_of_discounts numeric;
  v_taxable numeric;
  v_vat_amount numeric;
  v_total numeric;
  v_status text := coalesce(nullif(p_payload->>'status', ''), 'sent');
  v_is_outside_boq boolean := coalesce((p_payload->>'is_outside_boq')::boolean, false);
  v_outside_boq_reason text := nullif(trim(both from coalesce(p_payload->>'outside_boq_reason', '')), '');
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can create a purchase order' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'sent') then
    v_status := 'sent';
  end if;
  if v_plot_id is not null and v_plot_group_id is not null then
    raise exception 'Choose either a single plot or a plot group, not both' using errcode = '22023';
  end if;
  if v_is_outside_boq and v_outside_boq_reason is null then
    raise exception 'A reason is required when marking a purchase order outside BOQ' using errcode = '22023';
  end if;

  select
    coalesce(sum(coalesce((i->>'quantity_ordered')::numeric, 0) * coalesce((i->>'unit_price')::numeric, 0)), 0),
    coalesce(sum(
      case coalesce(nullif(i->>'discount_type', ''), 'none')
        when 'percent' then round(
          coalesce((i->>'quantity_ordered')::numeric, 0) * coalesce((i->>'unit_price')::numeric, 0)
            * least(greatest(coalesce((i->>'discount_value')::numeric, 0), 0), 100) / 100, 2)
        when 'amount' then least(
          greatest(coalesce((i->>'discount_value')::numeric, 0), 0),
          coalesce((i->>'quantity_ordered')::numeric, 0) * coalesce((i->>'unit_price')::numeric, 0))
        else 0
      end
    ), 0)
  into v_subtotal, v_line_discount_total
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i;

  v_after_line_discounts := v_subtotal - v_line_discount_total;

  v_po_discount_amount := case
    when v_po_discount_type = 'percent' then round(v_after_line_discounts * least(greatest(v_po_discount_value, 0), 100) / 100, 2)
    when v_po_discount_type = 'amount' then least(greatest(v_po_discount_value, 0), v_after_line_discounts)
    else 0
  end;

  v_combined_discount := v_line_discount_total + v_po_discount_amount;
  v_net_of_discounts := v_after_line_discounts - v_po_discount_amount;

  if v_vat_type = 'inclusive' and v_vat_percent > 0 then
    v_taxable := round(v_net_of_discounts / (1 + v_vat_percent / 100), 2);
    v_vat_amount := v_net_of_discounts - v_taxable;
    v_total := v_net_of_discounts;
  else
    v_taxable := v_net_of_discounts;
    v_vat_amount := round(v_taxable * v_vat_percent / 100, 2);
    v_total := v_taxable + v_vat_amount;
  end if;

  insert into public.purchase_order_number_counters (order_date, counter)
  values (v_order_date, 1)
  on conflict (order_date) do update set counter = purchase_order_number_counters.counter + 1
  returning counter into v_seq;

  v_po_no := 'PO-' || to_char(v_order_date, 'YYYYMMDD') || lpad(v_seq::text, 3, '0');

  -- A branch is only meaningful for the supplier it belongs to; accepting a
  -- mismatched one would put the wrong branch on the tax invoice.
  if v_supplier_branch_id is not null and not exists (
    select 1 from public.supplier_branches
    where id = v_supplier_branch_id
      and supplier_id = (p_payload->>'supplier_id')::uuid
      and is_active
  ) then
    raise exception 'Branch does not belong to this supplier' using errcode = '22023';
  end if;

  insert into public.purchase_orders (
    po_no, supplier_id, company_id, project_id, plot_id, plot_group_id, purchase_request_id,
    order_date, expected_delivery_date, delivery_address, vat_percent, vat_type, payment_terms,
    discount_type, discount_value, discount_amount,
    subtotal, vat_amount, total_amount,
    note, created_by, status, confirmed_at, supplier_branch_id,
    is_outside_boq, outside_boq_reason
  ) values (
    v_po_no,
    (p_payload->>'supplier_id')::uuid,
    (p_payload->>'company_id')::uuid,
    (p_payload->>'project_id')::uuid,
    v_plot_id,
    v_plot_group_id,
    v_pr_id,
    v_order_date,
    nullif(p_payload->>'expected_delivery_date', '')::date,
    nullif(p_payload->>'delivery_address', ''),
    v_vat_percent,
    v_vat_type,
    p_payload->>'payment_terms',
    v_po_discount_type,
    v_po_discount_value,
    v_combined_discount,
    v_subtotal,
    v_vat_amount,
    v_total,
    p_payload->>'note',
    v_uid,
    v_status,
    case when v_status = 'sent' then now() else null end,
    v_supplier_branch_id,
    v_is_outside_boq,
    v_outside_boq_reason
  )
  returning id into v_po_id;

  insert into public.purchase_order_items (
    purchase_order_id, material_type_id, purchase_request_item_id, quantity_ordered, unit_price, description,
    discount_type, discount_value, discount_amount
  )
  select
    v_po_id,
    (i->>'material_type_id')::bigint,
    public._jsonb_to_uuid(i->'purchase_request_item_id'),
    (i->>'quantity_ordered')::numeric,
    coalesce((i->>'unit_price')::numeric, 0),
    nullif(i->>'description', ''),
    coalesce(nullif(i->>'discount_type', ''), 'none'),
    coalesce((i->>'discount_value')::numeric, 0),
    case coalesce(nullif(i->>'discount_type', ''), 'none')
      when 'percent' then round(
        (i->>'quantity_ordered')::numeric * coalesce((i->>'unit_price')::numeric, 0)
          * least(greatest(coalesce((i->>'discount_value')::numeric, 0), 0), 100) / 100, 2)
      when 'amount' then least(
        greatest(coalesce((i->>'discount_value')::numeric, 0), 0),
        (i->>'quantity_ordered')::numeric * coalesce((i->>'unit_price')::numeric, 0))
      else 0
    end
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where coalesce((i->>'quantity_ordered')::numeric, 0) > 0;

  insert into public.purchase_order_plots (purchase_order_id, plot_id)
  select v_po_id, elem::uuid
  from jsonb_array_elements_text(coalesce(p_payload->'plot_ids', '[]'::jsonb)) as elem
  where elem <> '';

  if v_pr_id is not null then
    update public.purchase_request_items pri
    set quantity_requested = greatest(0, pri.quantity_requested - ordered.qty)
    from (
      select purchase_request_item_id, sum(quantity_ordered) as qty
      from public.purchase_order_items
      where purchase_order_id = v_po_id and purchase_request_item_id is not null
      group by purchase_request_item_id
    ) ordered
    where pri.id = ordered.purchase_request_item_id
      and pri.purchase_request_id = v_pr_id;

    update public.purchase_requests
    set status = case
      when exists (
        select 1 from public.purchase_request_items
        where purchase_request_id = v_pr_id and quantity_requested > 0
      ) then 'approved'
      else 'ordered'
    end
    where id = v_pr_id and status = 'approved';
  end if;

  return jsonb_build_object('id', v_po_id, 'po_no', v_po_no);
end;
$$;

revoke all on function public.po_create(jsonb) from public;
revoke all on function public.po_create(jsonb) from anon;
grant execute on function public.po_create(jsonb) to authenticated;
grant execute on function public.po_create(jsonb) to service_role;

create or replace function public.po_update(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_supplier_branch_id uuid := public._jsonb_to_uuid(p_payload->'supplier_branch_id');
  v_role text := public._billing_current_role();
  v_status text;
  v_po_no text;
  v_pr_id uuid;
  v_plot_ids_count int := jsonb_array_length(coalesce(p_payload->'plot_ids', '[]'::jsonb));
  v_plot_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_id') end;
  v_plot_group_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_group_id') end;
  v_vat_percent numeric := coalesce((p_payload->>'vat_percent')::numeric, 0);
  v_vat_type text := case when p_payload->>'vat_type' = 'inclusive' then 'inclusive' else 'exclusive' end;
  v_po_discount_type text := coalesce(nullif(p_payload->>'discount_type', ''), 'none');
  v_po_discount_value numeric := coalesce((p_payload->>'discount_value')::numeric, 0);
  v_subtotal numeric := 0;
  v_line_discount_total numeric := 0;
  v_after_line_discounts numeric;
  v_po_discount_amount numeric := 0;
  v_combined_discount numeric;
  v_net_of_discounts numeric;
  v_taxable numeric;
  v_vat_amount numeric;
  v_total numeric;
  v_line record;
  v_incoming_qty numeric;
  v_all_received boolean;
  v_any_received boolean;
  v_is_outside_boq boolean := coalesce((p_payload->>'is_outside_boq')::boolean, false);
  v_outside_boq_reason text := nullif(trim(both from coalesce(p_payload->>'outside_boq_reason', '')), '');
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can edit a purchase order' using errcode = '42501';
  end if;
  if v_plot_id is not null and v_plot_group_id is not null then
    raise exception 'Choose either a single plot or a plot group, not both' using errcode = '22023';
  end if;
  if v_is_outside_boq and v_outside_boq_reason is null then
    raise exception 'A reason is required when marking a purchase order outside BOQ' using errcode = '22023';
  end if;

  select status, po_no, purchase_request_id into v_status, v_po_no, v_pr_id from public.purchase_orders where id = p_id;
  if v_status is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if v_status not in ('draft', 'sent', 'partially_received', 'received') then
    raise exception 'Cannot edit a purchase order that has already been paid or cancelled' using errcode = '42501';
  end if;

  for v_line in
    select id, quantity_received
    from public.purchase_order_items
    where purchase_order_id = p_id and quantity_received > 0
  loop
    select (i->>'quantity_ordered')::numeric into v_incoming_qty
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    where public._jsonb_to_uuid(i->'id') = v_line.id;

    if v_incoming_qty is null then
      raise exception 'Cannot remove a line that already has goods received - reduce its quantity instead' using errcode = '42501';
    end if;
    if v_incoming_qty < v_line.quantity_received then
      raise exception 'Cannot set ordered quantity below the quantity already received' using errcode = '42501';
    end if;
  end loop;

  select
    coalesce(sum(coalesce((i->>'quantity_ordered')::numeric, 0) * coalesce((i->>'unit_price')::numeric, 0)), 0),
    coalesce(sum(
      case coalesce(nullif(i->>'discount_type', ''), 'none')
        when 'percent' then round(
          coalesce((i->>'quantity_ordered')::numeric, 0) * coalesce((i->>'unit_price')::numeric, 0)
            * least(greatest(coalesce((i->>'discount_value')::numeric, 0), 0), 100) / 100, 2)
        when 'amount' then least(
          greatest(coalesce((i->>'discount_value')::numeric, 0), 0),
          coalesce((i->>'quantity_ordered')::numeric, 0) * coalesce((i->>'unit_price')::numeric, 0))
        else 0
      end
    ), 0)
  into v_subtotal, v_line_discount_total
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i;

  v_after_line_discounts := v_subtotal - v_line_discount_total;

  v_po_discount_amount := case
    when v_po_discount_type = 'percent' then round(v_after_line_discounts * least(greatest(v_po_discount_value, 0), 100) / 100, 2)
    when v_po_discount_type = 'amount' then least(greatest(v_po_discount_value, 0), v_after_line_discounts)
    else 0
  end;

  v_combined_discount := v_line_discount_total + v_po_discount_amount;
  v_net_of_discounts := v_after_line_discounts - v_po_discount_amount;

  if v_vat_type = 'inclusive' and v_vat_percent > 0 then
    v_taxable := round(v_net_of_discounts / (1 + v_vat_percent / 100), 2);
    v_vat_amount := v_net_of_discounts - v_taxable;
    v_total := v_net_of_discounts;
  else
    v_taxable := v_net_of_discounts;
    v_vat_amount := round(v_taxable * v_vat_percent / 100, 2);
    v_total := v_taxable + v_vat_amount;
  end if;

  -- A branch is only meaningful for the supplier it belongs to; accepting a
  -- mismatched one would put the wrong branch on the tax invoice.
  if v_supplier_branch_id is not null and not exists (
    select 1 from public.supplier_branches
    where id = v_supplier_branch_id
      and supplier_id = (p_payload->>'supplier_id')::uuid
      and is_active
  ) then
    raise exception 'Branch does not belong to this supplier' using errcode = '22023';
  end if;

  update public.purchase_orders set
    supplier_id = (p_payload->>'supplier_id')::uuid,
    company_id = (p_payload->>'company_id')::uuid,
    project_id = (p_payload->>'project_id')::uuid,
    plot_id = v_plot_id,
    plot_group_id = v_plot_group_id,
    order_date = coalesce(nullif(p_payload->>'order_date', '')::date, order_date),
    expected_delivery_date = nullif(p_payload->>'expected_delivery_date', '')::date,
    delivery_address = nullif(p_payload->>'delivery_address', ''),
    vat_percent = v_vat_percent,
    vat_type = v_vat_type,
    payment_terms = p_payload->>'payment_terms',
    discount_type = v_po_discount_type,
    discount_value = v_po_discount_value,
    discount_amount = v_combined_discount,
    subtotal = v_subtotal,
    vat_amount = v_vat_amount,
    total_amount = v_total,
    note = p_payload->>'note',
    supplier_branch_id = v_supplier_branch_id,
    is_outside_boq = v_is_outside_boq,
    outside_boq_reason = v_outside_boq_reason
  where id = p_id;

  -- Give back whatever this PO's current lines had consumed from the source
  -- request before those lines are replaced below (same idea as po_delete) -
  -- otherwise the re-consume pass further down would double-count the old
  -- and new amounts.
  if v_pr_id is not null then
    update public.purchase_request_items pri
    set quantity_requested = pri.quantity_requested + old_ordered.qty
    from (
      select purchase_request_item_id, sum(quantity_ordered) as qty
      from public.purchase_order_items
      where purchase_order_id = p_id and purchase_request_item_id is not null
      group by purchase_request_item_id
    ) old_ordered
    where pri.id = old_ordered.purchase_request_item_id
      and pri.purchase_request_id = v_pr_id;
  end if;

  -- Existing unreceived lines dropped from the payload: safe to delete
  -- outright (nothing references them).
  delete from public.purchase_order_items
  where purchase_order_id = p_id
    and quantity_received = 0
    and id not in (
      select public._jsonb_to_uuid(i->'id')
      from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
      where public._jsonb_to_uuid(i->'id') is not null
    );

  -- Existing lines (received or not) present in the payload: update in
  -- place so the row's id - and therefore quantity_received and any
  -- goods_receipt_items FK pointing at it - survives untouched.
  update public.purchase_order_items poi set
    material_type_id = (i->>'material_type_id')::bigint,
    purchase_request_item_id = public._jsonb_to_uuid(i->'purchase_request_item_id'),
    quantity_ordered = (i->>'quantity_ordered')::numeric,
    unit_price = coalesce((i->>'unit_price')::numeric, 0),
    description = nullif(i->>'description', ''),
    discount_type = coalesce(nullif(i->>'discount_type', ''), 'none'),
    discount_value = coalesce((i->>'discount_value')::numeric, 0),
    discount_amount = case coalesce(nullif(i->>'discount_type', ''), 'none')
      when 'percent' then round(
        (i->>'quantity_ordered')::numeric * coalesce((i->>'unit_price')::numeric, 0)
          * least(greatest(coalesce((i->>'discount_value')::numeric, 0), 0), 100) / 100, 2)
      when 'amount' then least(
        greatest(coalesce((i->>'discount_value')::numeric, 0), 0),
        (i->>'quantity_ordered')::numeric * coalesce((i->>'unit_price')::numeric, 0))
      else 0
    end
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where poi.purchase_order_id = p_id
    and public._jsonb_to_uuid(i->'id') = poi.id;

  -- Brand-new lines (no id): insert fresh.
  insert into public.purchase_order_items (
    purchase_order_id, material_type_id, purchase_request_item_id, quantity_ordered, unit_price, description,
    discount_type, discount_value, discount_amount
  )
  select
    p_id,
    (i->>'material_type_id')::bigint,
    public._jsonb_to_uuid(i->'purchase_request_item_id'),
    (i->>'quantity_ordered')::numeric,
    coalesce((i->>'unit_price')::numeric, 0),
    nullif(i->>'description', ''),
    coalesce(nullif(i->>'discount_type', ''), 'none'),
    coalesce((i->>'discount_value')::numeric, 0),
    case coalesce(nullif(i->>'discount_type', ''), 'none')
      when 'percent' then round(
        (i->>'quantity_ordered')::numeric * coalesce((i->>'unit_price')::numeric, 0)
          * least(greatest(coalesce((i->>'discount_value')::numeric, 0), 0), 100) / 100, 2)
      when 'amount' then least(
        greatest(coalesce((i->>'discount_value')::numeric, 0), 0),
        (i->>'quantity_ordered')::numeric * coalesce((i->>'unit_price')::numeric, 0))
      else 0
    end
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where coalesce((i->>'quantity_ordered')::numeric, 0) > 0
    and public._jsonb_to_uuid(i->'id') is null;

  delete from public.purchase_order_plots where purchase_order_id = p_id;

  insert into public.purchase_order_plots (purchase_order_id, plot_id)
  select p_id, elem::uuid
  from jsonb_array_elements_text(coalesce(p_payload->'plot_ids', '[]'::jsonb)) as elem
  where elem <> '';

  -- Re-consume based on the now-current lines.
  if v_pr_id is not null then
    update public.purchase_request_items pri
    set quantity_requested = greatest(0, pri.quantity_requested - new_ordered.qty)
    from (
      select purchase_request_item_id, sum(quantity_ordered) as qty
      from public.purchase_order_items
      where purchase_order_id = p_id and purchase_request_item_id is not null
      group by purchase_request_item_id
    ) new_ordered
    where pri.id = new_ordered.purchase_request_item_id
      and pri.purchase_request_id = v_pr_id;

    update public.purchase_requests
    set status = case
      when exists (
        select 1 from public.purchase_request_items
        where purchase_request_id = v_pr_id and quantity_requested > 0
      ) then 'approved'
      else 'ordered'
    end
    where id = v_pr_id and status in ('approved', 'ordered');
  end if;

  select
    bool_and(quantity_received >= quantity_ordered),
    bool_or(quantity_received > 0)
  into v_all_received, v_any_received
  from public.purchase_order_items
  where purchase_order_id = p_id;

  update public.purchase_orders set
    status = case
      when v_all_received then 'received'
      when v_any_received then 'partially_received'
      else status
    end,
    received_at = case when v_all_received and status <> 'received' then current_date else received_at end,
    received_by = case when v_all_received and status <> 'received' then v_uid else received_by end
  where id = p_id;

  return jsonb_build_object('id', p_id, 'po_no', v_po_no);
end;
$$;

revoke all on function public.po_update(uuid, jsonb) from public;
revoke all on function public.po_update(uuid, jsonb) from anon;
grant execute on function public.po_update(uuid, jsonb) to authenticated;
grant execute on function public.po_update(uuid, jsonb) to service_role;
