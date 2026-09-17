-- Purchasing answers the request, instead of the system computing an answer.
--
-- po_create has always settled a request line by subtracting quantity_ordered
-- from quantity_requested. That only works while both sides count the same
-- way. For small hardware they don't: the foreman asks for 1000 screws
-- (pieces), purchasing buys the 3 boxes that covers it, and the request is
-- left reporting 997 outstanding forever (PR-0023, stuck since 2026-09-15 on
-- 7 of its 12 lines). Earlier attempts at this all tried to make the two
-- numbers reconcile - a catalog pack size, then a typed "how many does this
-- cover" figure - and every one of them puts arithmetic in a human's hands
-- that they can forget or get wrong. The countdown is the problem, not the
-- units.
--
-- Two changes here:
--
-- 1. purchase_order_items.closes_request_line - purchasing ticks a box on the
--    PO line saying this order covers the request line it came from. That is
--    a judgement they already hold at PO time, and it needs no conversion.
--
-- 2. The system never subtracts across two different units. It counts down
--    only when the PO line's unit and the request line's unit genuinely
--    match (the case it has always handled correctly); when they differ it
--    leaves quantity_requested alone and lets the tick box close the line.
--
-- Deliberately non-destructive: ticking the box does NOT zero
-- quantity_requested. "Is this line answered" is derived (see
-- _pr_recompute_status), so unticking reopens the line for free and
-- originalQuantityRequested's reconstruction (outstanding + ordered +
-- settled) stays intact.
--
-- po_create / po_update restated in full from 202609170001, po_delete from
-- 202609090004, pr_item_settle / pr_item_settle_undo from 202609100002 -
-- Postgres has no partial function replace, and this repo's convention is to
-- restate from the latest known definition rather than diff. po_cancel is
-- deliberately untouched: it never refunds quantity or touches the request,
-- so a request closed by a cancelled PO stays closed exactly as it does
-- today.

alter table public.purchase_order_items
  add column if not exists closes_request_line boolean not null default false;

-- ---------------------------------------------------------------------------
-- _pr_recompute_status: the single definition of "is this request finished",
-- so the rule can't drift between the six functions that can change the
-- answer. A line counts as answered when the arithmetic closed it
-- (quantity_requested = 0 - which also covers manual settlements, since
-- those decrement it), or when any PO line raised against it says it is
-- covered.
--
-- Never touches a request that is past ordering (received) or dead
-- (rejected/cancelled).
-- ---------------------------------------------------------------------------
create or replace function public._pr_recompute_status(p_pr_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
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
          where poi.purchase_request_item_id = pri.id
            and poi.closes_request_line
        )
    ) then 'approved'
    else 'ordered'
  end
  where id = p_pr_id
    and status in ('approved', 'ordered');
$$;

revoke all on function public._pr_recompute_status(uuid) from public;
revoke all on function public._pr_recompute_status(uuid) from anon;
grant execute on function public._pr_recompute_status(uuid) to authenticated;
grant execute on function public._pr_recompute_status(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- po_create / po_update: restated in full from 202609170001.
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
  if not v_is_outside_boq and v_plot_id is null and v_plot_group_id is null and v_plot_ids_count = 0 then
    raise exception 'A purchase order needs a plot, plot group, or plot selection - mark it outside BOQ if none applies' using errcode = '22023';
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
    unit_price, description, discount_type, discount_value, discount_amount
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
    end
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
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
  -- instead (see this migration's header) - subtracting a box count from a
  -- piece count is the bug this replaces.
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
  if not v_is_outside_boq and v_plot_id is null and v_plot_group_id is null and v_plot_ids_count = 0 then
    raise exception 'A purchase order needs a plot, plot group, or plot selection - mark it outside BOQ if none applies' using errcode = '22023';
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

  -- Give back what this PO's current lines consumed before they're replaced,
  -- on the same unit-matched basis the re-consume pass below uses - a line
  -- that never consumed anything (different unit) has nothing to refund, and
  -- refunding it would invent quantity.
  if v_pr_id is not null then
    update public.purchase_request_items pri
    set quantity_requested = pri.quantity_requested + old_ordered.qty
    from (
      select poi.purchase_request_item_id, sum(poi.quantity_ordered) as qty
      from public.purchase_order_items poi
      join public.purchase_request_items pri2 on pri2.id = poi.purchase_request_item_id
      join public.material_types mt on mt.id = poi.material_type_id
      where poi.purchase_order_id = p_id
        and poi.purchase_request_item_id is not null
        and coalesce(poi.unit, mt.unit) is not distinct from coalesce(pri2.unit, mt.unit)
      group by poi.purchase_request_item_id
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
    unit = nullif(i->>'unit', ''),
    closes_request_line = coalesce((i->>'closes_request_line')::boolean, false),
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
    purchase_order_id, material_type_id, purchase_request_item_id, quantity_ordered, unit, closes_request_line,
    unit_price, description, discount_type, discount_value, discount_amount
  )
  select
    p_id,
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
    end
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where coalesce((i->>'quantity_ordered')::numeric, 0) > 0
    and public._jsonb_to_uuid(i->'id') is null;

  delete from public.purchase_order_plots where purchase_order_id = p_id;

  insert into public.purchase_order_plots (purchase_order_id, plot_id)
  select p_id, elem::uuid
  from jsonb_array_elements_text(coalesce(p_payload->'plot_ids', '[]'::jsonb)) as elem
  where elem <> '';

  -- Material substitution sync - see 202609150003_pr_material_substitution.sql.
  update public.purchase_request_items pri
  set material_type_id = poi.material_type_id
  from public.purchase_order_items poi
  where poi.purchase_order_id = p_id
    and poi.purchase_request_item_id = pri.id
    and pri.material_type_id <> poi.material_type_id;

  -- Re-consume on the now-current lines, same unit-matched basis as above.
  if v_pr_id is not null then
    update public.purchase_request_items pri
    set quantity_requested = greatest(0, pri.quantity_requested - new_ordered.qty)
    from (
      select poi.purchase_request_item_id, sum(poi.quantity_ordered) as qty
      from public.purchase_order_items poi
      join public.purchase_request_items pri2 on pri2.id = poi.purchase_request_item_id
      join public.material_types mt on mt.id = poi.material_type_id
      where poi.purchase_order_id = p_id
        and poi.purchase_request_item_id is not null
        and coalesce(poi.unit, mt.unit) is not distinct from coalesce(pri2.unit, mt.unit)
      group by poi.purchase_request_item_id
    ) new_ordered
    where pri.id = new_ordered.purchase_request_item_id
      and pri.purchase_request_id = v_pr_id;

    perform public._pr_recompute_status(v_pr_id);
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

-- ---------------------------------------------------------------------------
-- po_delete: restated in full from 202609090004_po_partial_fulfillment.sql.
-- Same unit gate on its refund as po_update's, and the shared status rule -
-- the PO's rows (including any closes_request_line) are gone by the time the
-- status is recomputed, so a request closed only by this PO reopens.
-- ---------------------------------------------------------------------------
create or replace function public.po_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._billing_current_role();
  v_status text;
  v_po_no text;
  v_pr_id uuid;
  v_has_receipts boolean;
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can delete a purchase order' using errcode = '42501';
  end if;

  select status, po_no, purchase_request_id into v_status, v_po_no, v_pr_id
  from public.purchase_orders where id = p_id;

  if v_status is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if v_status not in ('draft', 'sent', 'cancelled') then
    raise exception 'Cannot delete a purchase order that has already been received or paid' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.goods_receipts where purchase_order_id = p_id
  ) into v_has_receipts;
  if v_has_receipts then
    raise exception 'Cannot delete a purchase order that already has goods received' using errcode = '42501';
  end if;

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

  delete from public.purchase_orders where id = p_id;

  if v_pr_id is not null then
    perform public._pr_recompute_status(v_pr_id);
  end if;

  return jsonb_build_object('id', p_id, 'po_no', v_po_no);
end;
$$;

revoke all on function public.po_delete(uuid) from public;
revoke all on function public.po_delete(uuid) from anon;
grant execute on function public.po_delete(uuid) to authenticated;
grant execute on function public.po_delete(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- pr_item_settle / pr_item_settle_undo: restated in full from
-- 202609100002_pr_item_manual_settlement.sql. Their own logic is unchanged
-- (they work in the request's own unit); only the status recompute moves to
-- the shared rule, so a line already answered by a PO's tick box isn't
-- wrongly reopened when an unrelated settlement is undone.
-- ---------------------------------------------------------------------------
create or replace function public.pr_item_settle(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_pr_id uuid := public._jsonb_to_uuid(p_payload->'purchase_request_id');
  v_reason text := coalesce(nullif(p_payload->>'reason', ''), 'ordered');
  v_po_ref text := nullif(btrim(coalesce(p_payload->>'po_ref', '')), '');
  v_note text := nullif(btrim(coalesce(p_payload->>'note', '')), '');
  v_status text;
  v_settled int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can settle a purchase request line' using errcode = '42501';
  end if;
  if v_reason not in ('ordered', 'cancelled') then
    raise exception 'Unknown settlement reason' using errcode = '22023';
  end if;

  select status into v_status from public.purchase_requests where id = v_pr_id;
  if v_status is null then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;
  if v_status <> 'approved' then
    raise exception 'Only an approved purchase request can be settled by hand' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    join public.purchase_request_items pri
      on pri.id = public._jsonb_to_uuid(i->'purchase_request_item_id')
    where pri.purchase_request_id = v_pr_id
      and coalesce((i->>'quantity')::numeric, 0) > pri.quantity_requested
  ) then
    raise exception 'Settled quantity exceeds what is still outstanding' using errcode = '22023';
  end if;

  with picked as (
    select
      public._jsonb_to_uuid(i->'purchase_request_item_id') as item_id,
      coalesce((i->>'quantity')::numeric, 0) as qty
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  ),
  valid as (
    select picked.item_id, picked.qty
    from picked
    join public.purchase_request_items pri on pri.id = picked.item_id
    where pri.purchase_request_id = v_pr_id
      and picked.qty > 0
  ),
  inserted as (
    insert into public.purchase_request_item_settlements
      (purchase_request_item_id, quantity, reason, po_ref, note, settled_by)
    select item_id, qty, v_reason, v_po_ref, v_note, v_uid from valid
    returning 1
  )
  select count(*) into v_settled from inserted;

  if v_settled = 0 then
    raise exception 'Select at least one line to settle' using errcode = '22023';
  end if;

  update public.purchase_request_items pri
  set quantity_requested = greatest(0, pri.quantity_requested - picked.qty)
  from (
    select
      public._jsonb_to_uuid(i->'purchase_request_item_id') as item_id,
      sum(coalesce((i->>'quantity')::numeric, 0)) as qty
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    group by 1
  ) picked
  where pri.id = picked.item_id
    and pri.purchase_request_id = v_pr_id;

  perform public._pr_recompute_status(v_pr_id);

  return jsonb_build_object('id', v_pr_id, 'settled', v_settled);
end;
$fn$;

revoke all on function public.pr_item_settle(jsonb) from public;
revoke all on function public.pr_item_settle(jsonb) from anon;
grant execute on function public.pr_item_settle(jsonb) to authenticated;

create or replace function public.pr_item_settle_undo(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_item_id uuid;
  v_qty numeric;
  v_pr_id uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can undo a settlement' using errcode = '42501';
  end if;

  select s.purchase_request_item_id, s.quantity, pri.purchase_request_id, pr.status
  into v_item_id, v_qty, v_pr_id, v_status
  from public.purchase_request_item_settlements s
  join public.purchase_request_items pri on pri.id = s.purchase_request_item_id
  join public.purchase_requests pr on pr.id = pri.purchase_request_id
  where s.id = p_id;

  if v_item_id is null then
    raise exception 'Settlement not found' using errcode = 'P0002';
  end if;
  if v_status not in ('approved', 'ordered') then
    raise exception 'Cannot undo a settlement once the request has been received or closed' using errcode = '42501';
  end if;

  delete from public.purchase_request_item_settlements where id = p_id;

  update public.purchase_request_items
  set quantity_requested = quantity_requested + v_qty
  where id = v_item_id;

  perform public._pr_recompute_status(v_pr_id);

  return jsonb_build_object('id', v_pr_id);
end;
$fn$;

revoke all on function public.pr_item_settle_undo(uuid) from public;
revoke all on function public.pr_item_settle_undo(uuid) from anon;
grant execute on function public.pr_item_settle_undo(uuid) to authenticated;
