-- Handover plan Phase 2.2, 2.3, 2.4.
--
-- 2.3 (H-05): po_cancel only flipped the status to 'cancelled' - it never
-- gave the ordered quantity back to the purchase request the way po_delete
-- already does, so a cancelled PO left its request looking "ordered" forever
-- and nobody re-bought the material. Also, _pr_recompute_status counted
-- closes_request_line from cancelled POs too, which would have kept masking
-- this even after the give-back was added.
--
-- 2.4 (M-08): goods_receipt_create didn't check the PO was actually
-- receivable (sent/partially_received), and didn't check a receipt line's
-- purchase_order_item_id actually belongs to the PO being received against -
-- only the screen prevented either. Over-delivery itself stays allowed
-- (Q-05: "allowed, but rare") - only the status and line-ownership checks are
-- added here.
--
-- 2.2 (H-06, H-07): plot_sales/sale_payments/plot_sale_events all cascaded
-- from plots/plot_sales, so deleting a plot with a sale (or the sale itself)
-- silently wiped every down-payment row and every numbered receipt with no
-- way back. Switches those three links to RESTRICT and adds void columns to
-- sale_payments so a paid, receipted payment can be voided (kept, marked
-- cancelled) instead of deleted or silently overwritten.

-- 2.3 -----------------------------------------------------------------

create or replace function public.po_cancel(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text := public._billing_current_role();
  v_status text;
  v_pr_id uuid;
  v_has_receipts boolean;
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can cancel a purchase order' using errcode = '42501';
  end if;

  select status, purchase_request_id into v_status, v_pr_id
  from public.purchase_orders where id = p_id;

  if v_status is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.purchase_order_items where purchase_order_id = p_id and quantity_received > 0
  ) into v_has_receipts;

  if v_has_receipts then
    raise exception 'Cannot cancel a purchase order that already has goods received' using errcode = '42501';
  end if;

  -- Same give-back as po_delete (same-unit lines only).
  if v_pr_id is not null then
    update public.purchase_request_items pri
    set quantity_requested = pri.quantity_requested + ordered.qty
    from (
      select poi.purchase_request_item_id, sum(poi.quantity_ordered) as qty
      from public.purchase_order_items poi
      join public.purchase_request_items pri2 on pri2.id = poi.purchase_request_item_id
      join public.material_types mt on mt.id = poi.material_type_id
      where poi.purchase_order_id = p_id
        and poi.purchase_request_item_id is not null
        and coalesce(poi.unit, mt.unit) is not distinct from coalesce(pri2.unit, mt.unit)
      group by poi.purchase_request_item_id
    ) ordered
    where pri.id = ordered.purchase_request_item_id
      and pri.purchase_request_id = v_pr_id;
  end if;

  update public.purchase_orders
  set status = 'cancelled', note = coalesce(note || E'\n', '') || coalesce('Cancelled: ' || p_reason, 'Cancelled')
  where id = p_id;

  if v_pr_id is not null then
    perform public._pr_recompute_status(v_pr_id);
  end if;

  return jsonb_build_object('id', p_id, 'status', 'cancelled');
end;
$function$;

create or replace function public._pr_recompute_status(p_pr_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.purchase_requests
  set status = case
    when exists (
      select 1
      from public.purchase_request_items pri
      where pri.purchase_request_id = p_pr_id
        and pri.quantity_requested > 0
        and not exists (
          select 1
          from public.purchase_order_items poi
          join public.purchase_orders po on po.id = poi.purchase_order_id
          where poi.purchase_request_item_id = pri.id
            and poi.closes_request_line
            and po.status <> 'cancelled'
        )
    ) then 'approved'
    else 'ordered'
  end
  where id = p_pr_id
    and status in ('approved', 'ordered');
$function$;

-- 2.4 -----------------------------------------------------------------

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
  v_project_id uuid;
  v_plot_id uuid;
  v_plot_group_id uuid;
  v_order_date date;
  v_po_status text;
  v_all_received boolean;
  v_any_received boolean;
  v_new_po_status text;
  v_line record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can record a goods receipt' using errcode = '42501';
  end if;

  select purchase_request_id, project_id, plot_id, plot_group_id, order_date, status
  into v_pr_id, v_project_id, v_plot_id, v_plot_group_id, v_order_date, v_po_status
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
    (i->>'purchase_order_item_id')::uuid,
    (i->>'quantity_received')::numeric,
    coalesce((i->>'unit_price_at_receipt')::numeric, 0),
    nullif(i->>'destination', '')
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where coalesce((i->>'quantity_received')::numeric, 0) > 0;

  update public.purchase_order_items poi
  set quantity_received = poi.quantity_received + gri.quantity_received
  from public.goods_receipt_items gri
  where gri.goods_receipt_id = v_receipt_id
    and gri.purchase_order_item_id = poi.id
    and poi.purchase_order_id = v_po_id;

  -- Actual lead time for this delivery: days from when the PO was placed to
  -- when it showed up. Overwrites every material received on this RI, even
  -- if it never had an estimate before.
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
  -- 202609220001).
  if v_new_po_status = 'received' and v_pr_id is not null then
    update public.purchase_requests pr
    set status = 'received'
    where pr.id = v_pr_id
      and not exists (
        select 1 from public.purchase_orders po2
        where po2.purchase_request_id = v_pr_id
          and po2.status <> 'cancelled'
          and po2.status <> 'received'
      );
  end if;

  for v_line in
    select
      gri.id as receipt_item_id,
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

    -- Never entered the store: pull it straight back out so "what did this
    -- house consume" stays one rule (all 'out' movements) and the balance
    -- reads correctly at every instant - see MATERIAL_FLOW_PLAN.md 4.2.
    if v_line.eff_destination = 'site' then
      perform public._stock_movement_post(
        p_material_type_id => v_line.material_type_id,
        p_project_id        => v_line.eff_project_id,
        p_type              => 'out',
        p_source_type       => 'direct_to_site',
        p_source_id         => v_line.receipt_item_id,
        p_quantity          => v_line.quantity_received,
        p_plot_id           => v_line.eff_plot_id,
        p_approved_by       => v_uid,
        p_note              => 'ส่งตรงหน้างาน' || case
          when coalesce(p_payload->>'delivery_note_no', '') <> '' then ' (' || (p_payload->>'delivery_note_no') || ')'
          else ''
        end,
        p_plot_group_id     => v_line.eff_plot_group_id
      );
    end if;
  end loop;

  return jsonb_build_object('id', v_receipt_id, 'ri_no', v_ri_no, 'po_status', v_new_po_status);
end;
$function$;

-- 2.2 -----------------------------------------------------------------

alter table public.plot_sales
  drop constraint plot_sales_plot_id_fkey,
  add constraint plot_sales_plot_id_fkey foreign key (plot_id) references public.plots(id) on delete restrict;

alter table public.sale_payments
  drop constraint sale_payments_plot_sale_id_fkey,
  add constraint sale_payments_plot_sale_id_fkey foreign key (plot_sale_id) references public.plot_sales(id) on delete restrict;

alter table public.plot_sale_events
  drop constraint plot_sale_events_plot_sale_id_fkey,
  add constraint plot_sale_events_plot_sale_id_fkey foreign key (plot_sale_id) references public.plot_sales(id) on delete restrict;

alter table public.sale_payments
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text;

-- get_sales_dashboard's "collected"/"outstanding"/"overdue" figures must not
-- count a voided payment - it keeps its paid_at/amount_paid so the receipt
-- number and history stay intact, but the money never really moved.
create or replace function get_sales_dashboard(p_project_id uuid default null)
returns jsonb
language sql
stable
as $$
  with sale_base as (
    select
      p.id as plot_id,
      p.project_id,
      pr.name as project_name,
      p.list_price,
      coalesce(hm.name, 'ไม่ระบุแบบ') as house_model_name,
      ps.id as sale_id,
      ps.status_code,
      ps.sale_price,
      ps.sales_rep_id,
      rep.full_name as rep_name,
      coalesce(st.stage, 'open') as stage,
      coalesce(st.label, 'ว่าง') as status_label,
      coalesce(st.color, 'slate') as status_color,
      coalesce(st.sort_order, 10) as sort_order
    from public.plots p
    join public.projects pr on pr.id = p.project_id
    left join public.house_models hm on hm.id = p.house_model_id
    left join public.plot_sales ps on ps.plot_id = p.id and ps.cancelled_at is null
    left join public.sale_statuses st on st.code = coalesce(ps.status_code, 'available')
    left join public.profiles rep on rep.id = ps.sales_rep_id
    where p.is_sellable = true
      and (p_project_id is null or p.project_id = p_project_id)
  ),
  totals as (
    select
      count(*) as total_plots,
      count(*) filter (where stage = 'open') as available_count,
      count(*) filter (where stage in ('reserved','contracted','closing')) as in_progress_count,
      count(*) filter (where stage = 'closed') as sold_count,
      count(*) filter (where stage = 'lost') as lost_count,
      coalesce(sum(list_price), 0) as total_inventory_value,
      coalesce(sum(coalesce(sale_price, list_price, 0)) filter (where stage not in ('open', 'lost')), 0) as total_deal_value
    from sale_base
  ),
  by_status as (
    select status_code, status_label, status_color, sort_order,
      count(*) as n,
      coalesce(sum(coalesce(sale_price, list_price, 0)), 0) as value
    from sale_base
    group by status_code, status_label, status_color, sort_order
  ),
  by_project as (
    select project_name,
      count(*) as total,
      count(*) filter (where stage = 'closed') as sold,
      coalesce(sum(coalesce(sale_price, list_price, 0)) filter (where stage not in ('open', 'lost')), 0) as value
    from sale_base
    group by project_name
  ),
  by_model as (
    select house_model_name,
      count(*) as total,
      count(*) filter (where stage = 'closed') as sold
    from sale_base
    group by house_model_name
  ),
  by_rep as (
    select rep_name,
      count(*) as deals,
      coalesce(sum(coalesce(sale_price, list_price, 0)), 0) as value
    from sale_base
    where rep_name is not null and stage not in ('open', 'lost')
    group by rep_name
  ),
  payments as (
    select
      coalesce(sum(sp.amount_paid) filter (where sp.paid_at is not null), 0) as collected,
      coalesce(sum(sp.amount_due) filter (where sp.paid_at is null), 0) as outstanding,
      coalesce(sum(sp.amount_due) filter (where sp.paid_at is null and sp.due_date < current_date), 0) as overdue_amount,
      count(*) filter (where sp.paid_at is null and sp.due_date < current_date) as overdue_count
    from public.sale_payments sp
    join public.plot_sales ps on ps.id = sp.plot_sale_id and ps.cancelled_at is null
    join public.plots p on p.id = ps.plot_id
    where sp.voided_at is null
      and (p_project_id is null or p.project_id = p_project_id)
  )
  select jsonb_build_object(
    'totals', (select row_to_json(t) from totals t),
    'byStatus', (select coalesce(jsonb_agg(row_to_json(s) order by s.sort_order), '[]'::jsonb) from by_status s),
    'byProject', (select coalesce(jsonb_agg(row_to_json(pj) order by pj.value desc), '[]'::jsonb) from by_project pj),
    'byModel', (select coalesce(jsonb_agg(row_to_json(m) order by m.sold desc), '[]'::jsonb) from by_model m),
    'byRep', (select coalesce(jsonb_agg(row_to_json(r) order by r.value desc), '[]'::jsonb) from by_rep r),
    'payments', (select row_to_json(pm) from payments pm)
  );
$$;
