-- Audit fixes for the allocation work (202610060004, 202610070001, 202610070002).
--
-- 1. Material history that survives edits and cancels.
--    po_create/po_update copy the PO line's material onto each linked request
--    line (the substitution sync) and nothing ever put it back: cancelling the
--    order, or removing/changing the allocation, left the request showing a
--    material no active order buys. _pri_resync_material now derives the
--    request line's material from its ACTIVE (non-cancelled) allocations:
--      * none      -> the original request,
--      * exactly 1 -> that order line's material,
--      * several different materials (two live orders bought different
--        things for the same request line) -> the original request. One
--        column cannot hold two answers, and the per-order breakdown on the
--        request screen shows each actual material, flagged as mixed.
--    It runs from triggers on the allocations table and on an order being
--    cancelled/reinstated, and the BEFORE trigger on request lines enforces
--    the same rule when the existing sync statement tries to overwrite it.
--    The request line's counting unit is also frozen when its material
--    changes (a null unit would otherwise silently follow the new material's
--    catalogue unit and make the quantity give-back asymmetric).
--
-- 2. Receipts: a consolidated line delivered direct-to-site used to post its
--    whole stock draw-out against the ORDER's plot, so BOQ 'issued' ignored
--    the allocations. _po_receipt_site_slices splits it along the allocations
--    (exact in total; each request's plot/project; ad-hoc multi-plot requests
--    split evenly; any unallocated remainder keeps the order's scope).
--    goods_receipt_create is restated with only that block changed. Receipts
--    themselves are still recorded per PO LINE: a request's share of a
--    part-received line is proportional, and the BOQ rollup now flags it as
--    an estimate (is_estimated) instead of presenting it as exact.
--
-- 3. BOQ detail: the part of a line no allocation covers is labelled
--    "(ส่วนที่ไม่ได้ผูกใบขอซื้อ)" so it is distinguishable from request-linked
--    rows; it is still counted once (line_factor) and the rows reconcile to
--    the PO line quantity.
--
-- Everything else is unchanged; functions are restated from their current
-- definitions (rollup/detail from 202610070001, goods_receipt_create from
-- 202610060004).

-- ---------------------------------------------------------------------------
-- 1. Request line material follows its active allocations.
-- ---------------------------------------------------------------------------
create or replace function public._pri_active_materials(p_pri_id uuid)
returns table (n int, only_material bigint)
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct poi.material_type_id)::int, min(poi.material_type_id)
  from public.purchase_order_item_allocations a
  join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
  join public.purchase_orders po on po.id = poi.purchase_order_id
  where a.purchase_request_item_id = p_pri_id
    and po.status <> 'cancelled';
$$;

revoke all on function public._pri_active_materials(uuid) from public, anon, authenticated;

create or replace function public._pri_keep_original_material()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  v_only bigint;
  v_orig bigint;
begin
  if new.material_type_id is distinct from old.material_type_id then
    v_orig := coalesce(old.original_material_type_id, old.material_type_id);

    -- Several active orders that bought DIFFERENT materials for this one
    -- request line: it cannot show one of them, so it keeps the original
    -- request (the per-order breakdown shows each actual material).
    select n, only_material into v_n, v_only from public._pri_active_materials(old.id);
    if v_n > 1 then
      new.material_type_id := v_orig;
    end if;

    -- Freeze the unit the line was asked in before its material (and so its
    -- catalogue unit) changes.
    if new.unit is null and new.material_type_id is distinct from old.material_type_id then
      select mt.unit into new.unit from public.material_types mt where mt.id = old.material_type_id;
    end if;

    if new.material_type_id is distinct from old.material_type_id and new.original_material_type_id is null then
      new.original_material_type_id := old.material_type_id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public._pri_resync_material(p_pri_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig bigint;
  v_cur bigint;
  v_n int;
  v_only bigint;
  v_target bigint;
begin
  select coalesce(original_material_type_id, material_type_id), material_type_id
  into v_orig, v_cur
  from public.purchase_request_items where id = p_pri_id;
  if not found then
    return;
  end if;

  select n, only_material into v_n, v_only from public._pri_active_materials(p_pri_id);
  v_target := case when v_n = 1 then v_only else v_orig end;

  if v_target is distinct from v_cur then
    update public.purchase_request_items
    set material_type_id = v_target,
        original_material_type_id = v_orig
    where id = p_pri_id;
  end if;
end;
$$;

revoke all on function public._pri_resync_material(uuid) from public, anon, authenticated;

create or replace function public._alloc_resync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- OLD only exists for UPDATE/DELETE and NEW only for INSERT/UPDATE, so each
  -- is touched strictly inside its own branch.
  if tg_op = 'INSERT' then
    perform public._pri_resync_material(new.purchase_request_item_id);
  elsif tg_op = 'DELETE' then
    perform public._pri_resync_material(old.purchase_request_item_id);
  else
    perform public._pri_resync_material(old.purchase_request_item_id);
    if new.purchase_request_item_id is distinct from old.purchase_request_item_id then
      perform public._pri_resync_material(new.purchase_request_item_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists purchase_order_item_allocations_resync_material on public.purchase_order_item_allocations;
create trigger purchase_order_item_allocations_resync_material
  after insert or update or delete on public.purchase_order_item_allocations
  for each row execute function public._alloc_resync_trigger();

create or replace function public._po_status_resync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pri uuid;
begin
  for v_pri in
    select distinct a.purchase_request_item_id
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
    where poi.purchase_order_id = new.id
  loop
    perform public._pri_resync_material(v_pri);
  end loop;
  return null;
end;
$$;

drop trigger if exists purchase_orders_resync_material on public.purchase_orders;
create trigger purchase_orders_resync_material
  after update of status on public.purchase_orders
  for each row
  when (old.status is distinct from new.status and (new.status = 'cancelled' or old.status = 'cancelled'))
  execute function public._po_status_resync_trigger();

-- ---------------------------------------------------------------------------
-- 2a. Direct-to-site draw-out split along the allocations.
-- ---------------------------------------------------------------------------
create or replace function public._po_receipt_site_slices(
  p_poi_id uuid,
  p_qty numeric,
  p_default_project uuid,
  p_default_plot uuid,
  p_default_group uuid
)
returns table (project_id uuid, plot_id uuid, plot_group_id uuid, qty numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ordered numeric;
  v_alloc_total numeric := 0;
  v_remainder numeric;
  v_weight_total numeric;
  v_assigned numeric := 0;
  v_part numeric;
  v_a record;
  v_plots uuid[];
  v_k int;
  v_i int;
  v_sub numeric;
  v_sub_assigned numeric;
  v_slices_left int;
begin
  select quantity_ordered into v_ordered from public.purchase_order_items where id = p_poi_id;
  select coalesce(sum(quantity_allocated), 0) into v_alloc_total
  from public.purchase_order_item_allocations where purchase_order_item_id = p_poi_id;

  -- No allocations: one slice, the order's own scope (previous behaviour).
  if v_alloc_total <= 0 then
    return query select p_default_project, p_default_plot, p_default_group, p_qty;
    return;
  end if;

  v_remainder := greatest(0, coalesce(v_ordered, 0) - v_alloc_total);
  v_weight_total := v_alloc_total + v_remainder;
  v_slices_left := (select count(*) from public.purchase_order_item_allocations where purchase_order_item_id = p_poi_id)
                   + case when v_remainder > 0 then 1 else 0 end;

  for v_a in
    select a.quantity_allocated as q, pr.project_id as pr_project, pr.plot_id as pr_plot, pr.plot_group_id as pr_group, pr.id as pr_id
    from public.purchase_order_item_allocations a
    join public.purchase_request_items pri on pri.id = a.purchase_request_item_id
    join public.purchase_requests pr on pr.id = pri.purchase_request_id
    where a.purchase_order_item_id = p_poi_id
    order by a.created_at, a.id
  loop
    v_slices_left := v_slices_left - 1;
    -- Last slice absorbs the rounding so the parts add back to p_qty exactly.
    if v_slices_left = 0 then
      v_part := greatest(0, p_qty - v_assigned);
    else
      v_part := round(p_qty * v_a.q / v_weight_total, 4);
    end if;
    v_assigned := v_assigned + v_part;
    if v_part <= 0 then
      continue;
    end if;

    if v_a.pr_plot is not null then
      return query select v_a.pr_project, v_a.pr_plot, null::uuid, v_part;
    elsif v_a.pr_group is not null then
      return query select v_a.pr_project, null::uuid, v_a.pr_group, v_part;
    else
      select coalesce(array_agg(prp.plot_id order by prp.plot_id), '{}') into v_plots
      from public.purchase_request_plots prp where prp.purchase_request_id = v_a.pr_id;
      v_k := coalesce(cardinality(v_plots), 0);
      if v_k = 0 then
        -- A request naming no plots: charged to the project, no plot.
        return query select v_a.pr_project, null::uuid, null::uuid, v_part;
      else
        v_sub_assigned := 0;
        for v_i in 1..v_k loop
          if v_i = v_k then
            v_sub := greatest(0, v_part - v_sub_assigned);
          else
            v_sub := round(v_part / v_k, 4);
          end if;
          v_sub_assigned := v_sub_assigned + v_sub;
          if v_sub > 0 then
            return query select v_a.pr_project, v_plots[v_i], null::uuid, v_sub;
          end if;
        end loop;
      end if;
    end if;
  end loop;

  if v_remainder > 0 then
    v_part := greatest(0, p_qty - v_assigned);
    if v_part > 0 then
      return query select p_default_project, p_default_plot, p_default_group, v_part;
    end if;
  end if;
end;
$$;

revoke all on function public._po_receipt_site_slices(uuid, numeric, uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2b. goods_receipt_create: restated from 202610060004; only the direct-to-
-- site draw-out block differs.
-- ---------------------------------------------------------------------------
create or replace function public.goods_receipt_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_po_id uuid := (p_payload->>'purchase_order_id')::uuid;
  v_received_at timestamptz := coalesce(nullif(p_payload->>'received_at', '')::timestamptz, now());
  v_default_destination text := coalesce(nullif(p_payload->>'default_destination', ''), 'store');
  v_receipt_id uuid;
  v_ri_no text;
  v_seq int;
  v_pr_id uuid;
  v_pr_requested_by uuid;
  v_alloc_pr uuid;
  v_project_id uuid;
  v_plot_id uuid;
  v_plot_group_id uuid;
  v_order_date date;
  v_po_status text;
  v_po_discount_type text;
  v_po_discount_value numeric;
  v_after_line_discounts numeric;
  v_po_discount_amount numeric;
  v_all_received boolean;
  v_any_received boolean;
  v_new_po_status text;
  v_line record;
  v_slice record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can record a goods receipt' using errcode = '42501';
  end if;

  select purchase_request_id, project_id, plot_id, plot_group_id, order_date, status, discount_type, discount_value
  into v_pr_id, v_project_id, v_plot_id, v_plot_group_id, v_order_date, v_po_status, v_po_discount_type, v_po_discount_value
  from public.purchase_orders where id = v_po_id;

  if not found then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;

  if v_po_status not in ('sent', 'partially_received') then
    raise exception 'Can only receive against a purchase order that is sent or partially received' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    where coalesce((i->>'quantity_received')::numeric, 0) > 0
      and not exists (
        select 1 from public.purchase_order_items poi
        where poi.id = (i->>'purchase_order_item_id')::uuid
          and poi.purchase_order_id = v_po_id
      )
  ) then
    raise exception 'One or more receipt lines do not belong to this purchase order' using errcode = '42501';
  end if;

  select coalesce(sum(quantity_ordered * unit_price - coalesce(discount_amount, 0)), 0)
  into v_after_line_discounts
  from public.purchase_order_items
  where purchase_order_id = v_po_id;

  v_po_discount_amount := case
    when v_po_discount_type = 'percent' then round(v_after_line_discounts * least(greatest(coalesce(v_po_discount_value, 0), 0), 100) / 100, 2)
    when v_po_discount_type = 'amount' then least(greatest(coalesce(v_po_discount_value, 0), 0), v_after_line_discounts)
    else 0
  end;

  insert into public.goods_receipt_number_counters (receipt_date, counter)
  values (v_received_at::date, 1)
  on conflict (receipt_date) do update set counter = goods_receipt_number_counters.counter + 1
  returning counter into v_seq;

  v_ri_no := 'RI-' || to_char(v_received_at::date, 'YYYYMMDD') || lpad(v_seq::text, 3, '0');

  insert into public.goods_receipts (purchase_order_id, ri_no, delivery_note_no, received_by, note, received_at, default_destination)
  values (v_po_id, v_ri_no, p_payload->>'delivery_note_no', v_uid, p_payload->>'note', v_received_at, v_default_destination)
  returning id into v_receipt_id;

  insert into public.goods_receipt_items (goods_receipt_id, purchase_order_item_id, quantity_received, unit_price_at_receipt, destination)
  select
    v_receipt_id,
    poi.id,
    (i->>'quantity_received')::numeric,
    case when poi.quantity_ordered > 0 then
      (
        (poi.quantity_ordered * poi.unit_price - coalesce(poi.discount_amount, 0))
        - case when v_after_line_discounts > 0
            then v_po_discount_amount * ((poi.quantity_ordered * poi.unit_price - coalesce(poi.discount_amount, 0)) / v_after_line_discounts)
            else 0
          end
      ) / poi.quantity_ordered
    else 0 end,
    nullif(i->>'destination', '')
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  join public.purchase_order_items poi on poi.id = (i->>'purchase_order_item_id')::uuid
  where coalesce((i->>'quantity_received')::numeric, 0) > 0;

  update public.purchase_order_items poi
  set quantity_received = poi.quantity_received + gri.quantity_received
  from public.goods_receipt_items gri
  where gri.goods_receipt_id = v_receipt_id
    and gri.purchase_order_item_id = poi.id
    and poi.purchase_order_id = v_po_id;

  if v_order_date is not null then
    update public.material_types mt
    set lead_time_days = greatest(0, (v_received_at::date - v_order_date))
    from public.purchase_order_items poi
    join public.goods_receipt_items gri on gri.purchase_order_item_id = poi.id
    where gri.goods_receipt_id = v_receipt_id
      and poi.material_type_id = mt.id;
  end if;

  select
    bool_and(quantity_received >= quantity_ordered),
    bool_or(quantity_received > 0)
  into v_all_received, v_any_received
  from public.purchase_order_items
  where purchase_order_id = v_po_id;

  v_new_po_status := case
    when v_all_received then 'received'
    when v_any_received then 'partially_received'
    else 'sent'
  end;

  update public.purchase_orders
  set status = v_new_po_status,
      received_at = case when v_new_po_status = 'received' then v_received_at::date else received_at end,
      received_by = case when v_new_po_status = 'received' then v_uid else received_by end
  where id = v_po_id;

  -- Only close out the request once every non-cancelled PO raised against it
  -- - not just the one this receipt touched - is fully received (see
  -- 202609220001). M-14/W-01: notify the requester exactly when this
  -- actually flips the request to 'received' (the where clause's own
  -- status <> 'received' keeps a second, unrelated PO against the same
  -- request from re-notifying).
  -- Every request this order is linked to - through its allocations, plus
  -- the legacy header link - is checked on its own. A request only closes
  -- once it is fully ordered (status 'ordered', not still 'approved' with
  -- quantity waiting for a later PO) and every order linked to it is fully
  -- received.
  if v_new_po_status = 'received' then
    foreach v_alloc_pr in array public._po_alloc_pr_ids(v_po_id)
    loop
      v_pr_requested_by := null;
      update public.purchase_requests pr
      set status = 'received'
      where pr.id = v_alloc_pr
        and pr.status = 'ordered'
        and not exists (
          select 1 from public.purchase_orders po2
          where po2.status not in ('cancelled', 'received', 'paid')
            and public._po_linked_to_pr(po2.id, v_alloc_pr)
        )
      returning pr.requested_by into v_pr_requested_by;

      if v_pr_requested_by is not null then
        insert into public.notifications (recipient_id, purchase_request_id, type)
        values (v_pr_requested_by, v_alloc_pr, 'pr_received');
      end if;
    end loop;
  end if;

  for v_line in
    select
      gri.id as receipt_item_id,
      poi.id as poi_id,
      poi.material_type_id,
      gri.quantity_received,
      coalesce(poi.project_id, v_project_id) as eff_project_id,
      case when poi.project_id is not null then poi.plot_id else v_plot_id end as eff_plot_id,
      case when poi.project_id is not null then poi.plot_group_id else v_plot_group_id end as eff_plot_group_id,
      coalesce(gri.destination, v_default_destination) as eff_destination
    from public.goods_receipt_items gri
    join public.purchase_order_items poi on poi.id = gri.purchase_order_item_id
    where gri.goods_receipt_id = v_receipt_id
  loop
    perform public._stock_movement_post(
      p_material_type_id => v_line.material_type_id,
      p_project_id        => v_line.eff_project_id,
      p_type              => 'in',
      p_source_type       => 'goods_receipt',
      p_source_id         => v_line.receipt_item_id,
      p_quantity          => v_line.quantity_received,
      p_plot_id           => v_line.eff_plot_id,
      p_approved_by       => v_uid,
      p_note              => 'Goods receipt' || case
        when coalesce(p_payload->>'delivery_note_no', '') <> '' then ' (' || (p_payload->>'delivery_note_no') || ')'
        else ''
      end,
      p_plot_group_id     => v_line.eff_plot_group_id
    );

    if v_line.eff_destination = 'site' then
      -- Direct to site: the draw-out is split along the line's allocations so
      -- each request's plot (and project) is charged only its own share; any
      -- part no allocation covers keeps the order's own scope. A line with no
      -- allocations yields exactly one slice - the previous behaviour.
      for v_slice in
        select * from public._po_receipt_site_slices(
          v_line.poi_id, v_line.quantity_received, v_line.eff_project_id, v_line.eff_plot_id, v_line.eff_plot_group_id
        )
      loop
        perform public._stock_movement_post(
          p_material_type_id => v_line.material_type_id,
          p_project_id        => v_slice.project_id,
          p_type              => 'out',
          p_source_type       => 'direct_to_site',
          p_source_id         => v_line.receipt_item_id,
          p_quantity          => v_slice.qty,
          p_plot_id           => v_slice.plot_id,
          p_approved_by       => v_uid,
          p_note              => 'ส่งตรงหน้างาน' || case
            when coalesce(p_payload->>'delivery_note_no', '') <> '' then ' (' || (p_payload->>'delivery_note_no') || ')'
            else ''
          end,
          p_plot_group_id     => v_slice.plot_group_id
        );
      end loop;
    end if;
  end loop;

  return jsonb_build_object('id', v_receipt_id, 'ri_no', v_ri_no, 'po_status', v_new_po_status);
end;
$function$;

grant execute on function public.goods_receipt_create(jsonb) to authenticated;
grant execute on function public.goods_receipt_create(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. BOQ: estimate flag for part-received consolidated lines (rollup) and
-- labelled unallocated remainder (detail). Restated from 202610070001.
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
      -- An estimate when the request covers several plots (even split), OR
      -- when a consolidated line is only part-received: receipts are recorded
      -- against the PO line, not against a request, so each request's share of
      -- what arrived is proportional, not an exact site receipt.
      bool_or(
        w.scope_plots_count < w.total_plots
        or (alloc_n.n > 1 and poi.quantity_received > 0 and poi.quantity_received < poi.quantity_ordered)
      ) as is_estimated
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
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
      end || case when lf.poi_id is not null then ' (ส่วนที่ไม่ได้ผูกใบขอซื้อ)' else '' end as plot_label,
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
    group by po.id, po.po_no, po.order_date, s.name, po.plot_id, pl.name, po.plot_group_id, pg.name, po.status, (lf.poi_id is not null)
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
