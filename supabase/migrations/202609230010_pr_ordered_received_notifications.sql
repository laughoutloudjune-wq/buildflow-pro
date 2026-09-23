-- Handover plan Phase 4.1 (M-14, part of W-01): po_create and
-- goods_receipt_create never notified anyone - the foreman who asked for
-- material had no way to know it was ordered or arrived short of asking the
-- office directly. Adds two notification types and the inserts that use
-- them: 'pr_ordered' when a PO is raised against a foreman's purchase
-- request, 'pr_received' the moment that request's linked PO(s) are all
-- fully received (the same condition that already flips the request's own
-- status to 'received').

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'new_request', 'billing_approved', 'billing_rejected',
    'pr_pending_review', 'pr_approved', 'pr_rejected', 'pr_ordered', 'pr_received',
    'work_request_new', 'work_request_done'
  ]));

create or replace function public.po_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_supplier_branch_id uuid := public._jsonb_to_uuid(p_payload->'supplier_branch_id');
  v_role text := public._billing_current_role();
  v_po_id uuid;
  v_po_no text;
  v_order_date date := coalesce(nullif(p_payload->>'order_date', '')::date, current_date);
  v_seq int;
  v_pr_id uuid := public._jsonb_to_uuid(p_payload->'purchase_request_id');
  v_pr_requested_by uuid;
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
  if not v_is_outside_boq and v_plot_id is null and v_plot_group_id is null and v_plot_ids_count = 0 then
    raise exception 'A purchase order needs a plot, plot group, or plot selection - mark it outside BOQ if none applies' using errcode = '22023';
  end if;

  -- Per-line scope override validation: an item may reference a plot or a
  -- plot group (never both), and either must actually exist. A missing
  -- project_id alongside a valid plot/group is fine - it's derived from the
  -- plot below.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    where public._jsonb_to_uuid(i->'plot_id') is not null
      and public._jsonb_to_uuid(i->'plot_group_id') is not null
  ) then
    raise exception 'An order line cannot be scoped to both a plot and a plot group' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    where public._jsonb_to_uuid(i->'plot_id') is not null
      and not exists (select 1 from public.plots p where p.id = public._jsonb_to_uuid(i->'plot_id'))
  ) then
    raise exception 'One of the order lines references a plot that does not exist' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    where public._jsonb_to_uuid(i->'plot_group_id') is not null
      and not exists (select 1 from public.plot_groups g where g.id = public._jsonb_to_uuid(i->'plot_group_id'))
  ) then
    raise exception 'One of the order lines references a plot group that does not exist' using errcode = '22023';
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
    purchase_order_id, material_type_id, purchase_request_item_id, quantity_ordered, unit, closes_request_line,
    unit_price, description, discount_type, discount_value, discount_amount,
    project_id, plot_id, plot_group_id, intended_destination
  )
  select
    v_po_id,
    (i->>'material_type_id')::bigint,
    public._jsonb_to_uuid(i->'purchase_request_item_id'),
    (i->>'quantity_ordered')::numeric,
    nullif(i->>'unit', ''),
    coalesce((i->>'closes_request_line')::boolean, false),
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
    end,
    coalesce(item_plot.project_id, item_group.project_id, public._jsonb_to_uuid(i->'project_id')),
    item_plot.id,
    item_group.id,
    nullif(i->>'intended_destination', '')
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  left join public.plots item_plot on item_plot.id = public._jsonb_to_uuid(i->'plot_id')
  left join public.plot_groups item_group on item_group.id = public._jsonb_to_uuid(i->'plot_group_id')
  where coalesce((i->>'quantity_ordered')::numeric, 0) > 0;

  insert into public.purchase_order_plots (purchase_order_id, plot_id)
  select v_po_id, elem::uuid
  from jsonb_array_elements_text(coalesce(p_payload->'plot_ids', '[]'::jsonb)) as elem
  where elem <> '';

  -- Material substitution sync - see 202609150003_pr_material_substitution.sql.
  update public.purchase_request_items pri
  set material_type_id = poi.material_type_id
  from public.purchase_order_items poi
  where poi.purchase_order_id = v_po_id
    and poi.purchase_request_item_id = pri.id
    and pri.material_type_id <> poi.material_type_id;

  -- Count down only where both sides speak the same unit. A line bought in a
  -- different unit than it was asked for is answered by closes_request_line
  -- instead (see 202609170003) - subtracting a box count from a piece count
  -- is the bug this replaces. A line's own project/plot override never
  -- affects this - it's orthogonal to which request line it answers.
  if v_pr_id is not null then
    update public.purchase_request_items pri
    set quantity_requested = greatest(0, pri.quantity_requested - ordered.qty)
    from (
      select poi.purchase_request_item_id, sum(poi.quantity_ordered) as qty
      from public.purchase_order_items poi
      join public.purchase_request_items pri2 on pri2.id = poi.purchase_request_item_id
      join public.material_types mt on mt.id = poi.material_type_id
      where poi.purchase_order_id = v_po_id
        and poi.purchase_request_item_id is not null
        and coalesce(poi.unit, mt.unit) is not distinct from coalesce(pri2.unit, mt.unit)
      group by poi.purchase_request_item_id
    ) ordered
    where pri.id = ordered.purchase_request_item_id
      and pri.purchase_request_id = v_pr_id;

    perform public._pr_recompute_status(v_pr_id);

    -- M-14/W-01: tell the foreman who asked for this that it's on its way.
    select requested_by into v_pr_requested_by from public.purchase_requests where id = v_pr_id;
    if v_pr_requested_by is not null then
      insert into public.notifications (recipient_id, purchase_request_id, type)
      values (v_pr_requested_by, v_pr_id, 'pr_ordered');
    end if;
  end if;

  return jsonb_build_object('id', v_po_id, 'po_no', v_po_no);
end;
$function$;

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
  if v_new_po_status = 'received' and v_pr_id is not null then
    update public.purchase_requests pr
    set status = 'received'
    where pr.id = v_pr_id
      and pr.status <> 'received'
      and not exists (
        select 1 from public.purchase_orders po2
        where po2.purchase_request_id = v_pr_id
          and po2.status <> 'cancelled'
          and po2.status <> 'received'
      )
    returning pr.requested_by into v_pr_requested_by;

    if v_pr_requested_by is not null then
      insert into public.notifications (recipient_id, purchase_request_id, type)
      values (v_pr_requested_by, v_pr_id, 'pr_received');
    end if;
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
