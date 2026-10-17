-- Procurement redesign, step 4: units converted at receiving, cost frozen on
-- every stock movement.
--
-- 1. goods_receipt_items.stock_quantity: how much arrived in the stock unit
--    (material_types.unit) when the PO line is bought in another unit. NULL
--    means "same as quantity_received". The PO keeps its own unit.
-- 2. _stock_movement_post takes an optional unit cost. A receipt into the
--    store updates the weighted-average cost on stock_balances. Every 'out'
--    freezes the cost it was issued at (average, or the receipt price for a
--    straight-to-site delivery). Falls back to the old store_material_unit_cost
--    and flags the row as estimated.
-- 3. boq_control_issued_value uses the frozen cost.
--
-- Existing function text is patched in place; any expected fragment that is
-- missing fails the migration loudly instead of silently doing nothing.

alter table public.goods_receipt_items
  add column if not exists stock_quantity numeric check (stock_quantity is null or stock_quantity > 0);

-- ---------------------------------------------------------------------------
-- _stock_movement_post with p_unit_cost
-- ---------------------------------------------------------------------------
drop function if exists public._stock_movement_post(
  bigint, uuid, text, text, uuid, numeric, uuid, uuid, uuid, uuid, text, uuid
);

create or replace function public._stock_movement_post(
  p_material_type_id bigint,
  p_project_id uuid,
  p_type text,
  p_source_type text,
  p_source_id uuid,
  p_quantity numeric,
  p_plot_id uuid default null,
  p_contractor_id uuid default null,
  p_requested_by uuid default null,
  p_approved_by uuid default null,
  p_note text default null,
  p_plot_group_id uuid default null,
  p_unit_cost numeric default null
) returns public.stock_movements
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prev numeric;
  v_new numeric;
  v_avg numeric;
  v_cost numeric;
  v_estimated boolean := false;
  v_row public.stock_movements;
begin
  if p_type not in ('in', 'out') then
    raise exception 'Stock movement type % is not wired up yet', p_type using errcode = '22023';
  end if;
  if p_quantity <= 0 then
    raise exception 'Stock movement quantity must be positive' using errcode = '22023';
  end if;
  if p_plot_id is not null and p_plot_group_id is not null then
    raise exception 'A movement cannot be scoped to both a plot and a plot group' using errcode = '22023';
  end if;

  if p_type = 'in' then
    select avg_cost into v_avg from public.stock_balances where material_type_id = p_material_type_id;

    insert into public.stock_balances (material_type_id, quantity_on_hand, updated_at)
    values (p_material_type_id, p_quantity, now())
    on conflict (material_type_id) do update
      set quantity_on_hand = public.stock_balances.quantity_on_hand + p_quantity,
          updated_at = now()
    returning quantity_on_hand - p_quantity, quantity_on_hand into v_prev, v_new;

    -- Weighted average only moves when this receipt brings a price.
    if p_unit_cost is not null then
      update public.stock_balances
      set avg_cost = case
            when v_prev <= 0 or v_avg is null then p_unit_cost
            else round((v_prev * v_avg + p_quantity * p_unit_cost) / v_new, 6)
          end
      where material_type_id = p_material_type_id;
    end if;
    v_cost := p_unit_cost;
  else
    select avg_cost into v_avg from public.stock_balances where material_type_id = p_material_type_id;

    update public.stock_balances
    set quantity_on_hand = quantity_on_hand - p_quantity,
        updated_at = now()
    where material_type_id = p_material_type_id
      and quantity_on_hand >= p_quantity
    returning quantity_on_hand + p_quantity, quantity_on_hand into v_prev, v_new;

    if not found then
      raise exception 'Not enough stock on hand to withdraw % of material %', p_quantity, p_material_type_id
        using errcode = '22023';
    end if;

    v_cost := coalesce(p_unit_cost, nullif(v_avg, 0));
    if v_cost is null then
      v_cost := public.store_material_unit_cost(p_material_type_id);
      v_estimated := true;
    end if;
  end if;

  insert into public.stock_movements (
    material_type_id, project_id, plot_id, plot_group_id, contractor_id,
    type, source_type, source_id,
    quantity, prev_qty, new_qty,
    requested_by, approved_by, note,
    unit_cost, unit_cost_estimated
  ) values (
    p_material_type_id, p_project_id, p_plot_id, p_plot_group_id, p_contractor_id,
    p_type, p_source_type, p_source_id,
    p_quantity, v_prev, v_new,
    p_requested_by, p_approved_by, p_note,
    v_cost, v_estimated
  )
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public._stock_movement_post(
  bigint, uuid, text, text, uuid, numeric, uuid, uuid, uuid, uuid, text, uuid, numeric
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- goods_receipt_create: stock quantity + costs
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_def text;
  v_new text;
  procedure_oid oid := 'public.goods_receipt_create(jsonb)'::regprocedure;

begin
  v_def := pg_get_functiondef(procedure_oid);
  v_new := v_def;

  -- 1. insert column list
  if (length(v_new) - length(replace(v_new, 'quantity_received, unit_price_at_receipt, destination)', ''))) <> length('quantity_received, unit_price_at_receipt, destination)') then
    raise exception 'goods_receipt_create: insert column list not found exactly once';
  end if;
  v_new := replace(v_new, 'quantity_received, unit_price_at_receipt, destination)',
                          'quantity_received, unit_price_at_receipt, destination, stock_quantity)');

  -- 2. insert value
  if (length(v_new) - length(replace(v_new, E'nullif(i->>''destination'', '''')\n  from jsonb_array_elements', ''))) <> length(E'nullif(i->>''destination'', '''')\n  from jsonb_array_elements') then
    raise exception 'goods_receipt_create: destination value not found exactly once';
  end if;
  v_new := replace(v_new, E'nullif(i->>''destination'', '''')\n  from jsonb_array_elements',
                          E'nullif(i->>''destination'', ''''),\n    nullif(i->>''stock_quantity'', '''')::numeric\n  from jsonb_array_elements');

  -- 3. loop select
  if (length(v_new) - length(replace(v_new, E'      gri.quantity_received,\n      coalesce(poi.project_id, v_project_id) as eff_project_id', ''))) <> length(E'      gri.quantity_received,\n      coalesce(poi.project_id, v_project_id) as eff_project_id') then
    raise exception 'goods_receipt_create: loop select not found exactly once';
  end if;
  v_new := replace(v_new, E'      gri.quantity_received,\n      coalesce(poi.project_id, v_project_id) as eff_project_id',
    E'      gri.quantity_received,\n      coalesce(gri.stock_quantity, gri.quantity_received) as stock_qty,\n      gri.unit_price_at_receipt * gri.quantity_received / coalesce(gri.stock_quantity, gri.quantity_received) as stock_unit_cost,\n      coalesce(poi.project_id, v_project_id) as eff_project_id');

  -- 4. 'in' posting: stock quantity, price only for goods that land in the store
  if (length(v_new) - length(replace(v_new, 'p_quantity          => v_line.quantity_received,', ''))) <> length('p_quantity          => v_line.quantity_received,') then
    raise exception 'goods_receipt_create: in-posting quantity not found exactly once';
  end if;
  v_new := replace(v_new, 'p_quantity          => v_line.quantity_received,',
    E'p_quantity          => v_line.stock_qty,\n      p_unit_cost         => case when v_line.eff_destination = ''store'' then v_line.stock_unit_cost else null end,');

  -- 5. site slices split the stock quantity
  if (length(v_new) - length(replace(v_new, 'v_line.poi_id, v_line.quantity_received, v_line.eff_project_id', ''))) <> length('v_line.poi_id, v_line.quantity_received, v_line.eff_project_id') then
    raise exception 'goods_receipt_create: site slices call not found exactly once';
  end if;
  v_new := replace(v_new, 'v_line.poi_id, v_line.quantity_received, v_line.eff_project_id',
                          'v_line.poi_id, v_line.stock_qty, v_line.eff_project_id');

  -- 6. site out carries the receipt price
  if (length(v_new) - length(replace(v_new, 'p_quantity          => v_slice.qty,', ''))) <> length('p_quantity          => v_slice.qty,') then
    raise exception 'goods_receipt_create: site out quantity not found exactly once';
  end if;
  v_new := replace(v_new, 'p_quantity          => v_slice.qty,',
    E'p_quantity          => v_slice.qty,\n          p_unit_cost         => v_line.stock_unit_cost,');

  execute v_new;
end
$patch$;

-- ---------------------------------------------------------------------------
-- boq_control_issued_value: frozen cost per movement
-- ---------------------------------------------------------------------------
create or replace function public.boq_control_issued_value(p_project_id uuid, p_scope jsonb default '{}'::jsonb)
returns table(material_type_id bigint, issued_value numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
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
  )
  select
    sm.material_type_id,
    sum(sm.quantity * sw.scope_plots_count::numeric / sw.total_plots
        * coalesce(sm.unit_cost, public.store_material_unit_cost(sm.material_type_id)))
  from stock_weight sw
  join public.stock_movements sm on sm.id = sw.sm_id
  where sw.scope_plots_count > 0
  group by sm.material_type_id;
$function$;
