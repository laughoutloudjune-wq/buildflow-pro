-- A purchase request line and the purchase order line(s) raised against it
-- have always been assumed to share one unit, inherited from
-- material_types.unit. That's true for most materials (a sheet of drywall is
-- a sheet either way) but false for small hardware bought by the box/bundle/
-- pack while a foreman naturally asks for it by the piece - e.g. PR-0023
-- asked for 1000 (meaning pieces) of a screw whose catalog unit is กล่อง
-- (box); purchasing correctly bought the 3 real boxes that covers it, and
-- po_create subtracted 3 from 1000, leaving the line "outstanding" forever
-- even though it was fully bought.
--
-- Fix: unit becomes an editable field on the request line and the order line
-- themselves, prefilled from the material's catalog unit exactly as today
-- (null = "use the catalog unit", so every line that never touches this is
-- unaffected). When a linked order line's unit no longer matches its request
-- line's unit, quantity_ordered can no longer be compared directly against
-- quantity_requested - quantity_fulfilled is the one number settlement math
-- then trusts: how much of the REQUEST line's unit this order line actually
-- covers, typed by a human (there is no stored conversion factor anywhere in
-- this design - see the plan doc for why). Null (the default, untouched
-- whenever units already match) means "same as quantity_ordered".
--
-- quantity_ordered / unit_price are unchanged in meaning - still the real
-- transaction amount, what's invoiced and paid. Only the counting-unit
-- comparison needed fixing.
--
-- pr_create / pr_update / po_create / po_update / goods_receipt_create /
-- boq_control_rollup / boq_control_material_detail / boq_control_unassigned
-- are restated in full below (Postgres has no partial function replace, and
-- this repo's own convention is to always restate from the latest known
-- definition rather than diff) - each restated from the migration named in
-- its own comment, with only the change described there.
--
-- Safe to run twice: every statement is `if not exists` / `create or
-- replace`.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.purchase_request_items
  add column if not exists unit text;

alter table public.purchase_order_items
  add column if not exists unit text;

alter table public.purchase_order_items
  add column if not exists quantity_fulfilled numeric;
alter table public.purchase_order_items
  add constraint purchase_order_items_quantity_fulfilled_non_negative
  check (quantity_fulfilled is null or quantity_fulfilled >= 0);

-- ---------------------------------------------------------------------------
-- pr_create / pr_update: restated in full from 202609150004_pr_item_boq_job.sql
-- (pr_update's grants also carry forward 202609150005_pr_update_revoke_anon.sql),
-- adding only `unit` to the item insert.
-- ---------------------------------------------------------------------------

create or replace function public.pr_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_pr_id uuid;
  v_pr_no text;
  v_plot_ids_count int := jsonb_array_length(coalesce(p_payload->'plot_ids', '[]'::jsonb));
  v_plot_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_id') end;
  v_plot_group_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_group_id') end;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('foreman','pm','admin') then
    raise exception 'No permission to create purchase request' using errcode = '42501';
  end if;
  if v_plot_id is not null and v_plot_group_id is not null then
    raise exception 'Choose either a single plot or a plot group, not both' using errcode = '22023';
  end if;

  insert into public.purchase_requests (project_id, plot_id, plot_group_id, note, needed_by_date, requested_by, status)
  values (
    (p_payload->>'project_id')::uuid,
    v_plot_id,
    v_plot_group_id,
    p_payload->>'note',
    nullif(p_payload->>'needed_by_date', '')::date,
    v_uid,
    'pending_review'
  )
  returning id, pr_no::text into v_pr_id, v_pr_no;

  insert into public.purchase_request_items (purchase_request_id, material_type_id, quantity_requested, note, boq_id, unit)
  select
    v_pr_id,
    (i->>'material_type_id')::bigint,
    (i->>'quantity_requested')::numeric,
    i->>'note',
    public._jsonb_to_uuid(i->'boq_id'),
    nullif(i->>'unit', '')
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where coalesce((i->>'quantity_requested')::numeric, 0) > 0;

  insert into public.purchase_request_plots (purchase_request_id, plot_id)
  select v_pr_id, elem::uuid
  from jsonb_array_elements_text(coalesce(p_payload->'plot_ids', '[]'::jsonb)) as elem
  where elem <> '';

  insert into public.notifications (recipient_id, purchase_request_id, type)
  select p.id, v_pr_id, 'pr_pending_review'
  from public.profiles p
  where p.role in ('pm','admin');

  return jsonb_build_object('id', v_pr_id, 'pr_no', v_pr_no);
end;
$$;

grant execute on function public.pr_create(jsonb) to authenticated;

create or replace function public.pr_update(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_pr_no text;
  v_plot_ids_count int := jsonb_array_length(coalesce(p_payload->'plot_ids', '[]'::jsonb));
  v_plot_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_id') end;
  v_plot_group_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_group_id') end;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('foreman','pm','admin') then
    raise exception 'No permission to edit this purchase request' using errcode = '42501';
  end if;
  if v_plot_id is not null and v_plot_group_id is not null then
    raise exception 'Choose either a single plot or a plot group, not both' using errcode = '22023';
  end if;

  select status, pr_no::text into v_status, v_pr_no from public.purchase_requests where id = p_id;
  if v_status is null then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'Cannot edit a purchase request that has already been reviewed' using errcode = '42501';
  end if;

  update public.purchase_requests set
    project_id = (p_payload->>'project_id')::uuid,
    plot_id = v_plot_id,
    plot_group_id = v_plot_group_id,
    note = p_payload->>'note',
    needed_by_date = nullif(p_payload->>'needed_by_date', '')::date
  where id = p_id;

  delete from public.purchase_request_items where purchase_request_id = p_id;
  insert into public.purchase_request_items (purchase_request_id, material_type_id, quantity_requested, note, boq_id, unit)
  select
    p_id,
    (i->>'material_type_id')::bigint,
    (i->>'quantity_requested')::numeric,
    i->>'note',
    public._jsonb_to_uuid(i->'boq_id'),
    nullif(i->>'unit', '')
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where coalesce((i->>'quantity_requested')::numeric, 0) > 0;

  delete from public.purchase_request_plots where purchase_request_id = p_id;
  insert into public.purchase_request_plots (purchase_request_id, plot_id)
  select p_id, elem::uuid
  from jsonb_array_elements_text(coalesce(p_payload->'plot_ids', '[]'::jsonb)) as elem
  where elem <> '';

  return jsonb_build_object('id', p_id, 'pr_no', v_pr_no);
end;
$$;

revoke all on function public.pr_update(uuid, jsonb) from public;
revoke all on function public.pr_update(uuid, jsonb) from anon;
grant execute on function public.pr_update(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- po_create / po_update: restated in full from
-- 202609150003_pr_material_substitution.sql, adding `unit` and
-- `quantity_fulfilled` to every purchase_order_items insert/update, and
-- switching every place that moves a request line's quantity_requested from
-- summing quantity_ordered to summing coalesce(quantity_fulfilled,
-- quantity_ordered).
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
    purchase_order_id, material_type_id, purchase_request_item_id, quantity_ordered, unit, quantity_fulfilled,
    unit_price, description, discount_type, discount_value, discount_amount
  )
  select
    v_po_id,
    (i->>'material_type_id')::bigint,
    public._jsonb_to_uuid(i->'purchase_request_item_id'),
    (i->>'quantity_ordered')::numeric,
    nullif(i->>'unit', ''),
    (i->>'quantity_fulfilled')::numeric,
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

  -- Consume the request by what this PO line is actually worth in the
  -- request line's own unit (coalesce(quantity_fulfilled, quantity_ordered)),
  -- not the raw transaction quantity - see this migration's header comment.
  if v_pr_id is not null then
    update public.purchase_request_items pri
    set quantity_requested = greatest(0, pri.quantity_requested - ordered.qty)
    from (
      select purchase_request_item_id, sum(coalesce(quantity_fulfilled, quantity_ordered)) as qty
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

  -- Give back whatever this PO's current lines had consumed - by their
  -- coalesce(quantity_fulfilled, quantity_ordered), same basis as the
  -- re-consume pass below - before those lines are replaced.
  if v_pr_id is not null then
    update public.purchase_request_items pri
    set quantity_requested = pri.quantity_requested + old_ordered.qty
    from (
      select purchase_request_item_id, sum(coalesce(quantity_fulfilled, quantity_ordered)) as qty
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
    unit = nullif(i->>'unit', ''),
    quantity_fulfilled = (i->>'quantity_fulfilled')::numeric,
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
    purchase_order_id, material_type_id, purchase_request_item_id, quantity_ordered, unit, quantity_fulfilled,
    unit_price, description, discount_type, discount_value, discount_amount
  )
  select
    p_id,
    (i->>'material_type_id')::bigint,
    public._jsonb_to_uuid(i->'purchase_request_item_id'),
    (i->>'quantity_ordered')::numeric,
    nullif(i->>'unit', ''),
    (i->>'quantity_fulfilled')::numeric,
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

  -- Re-consume based on the now-current lines.
  if v_pr_id is not null then
    update public.purchase_request_items pri
    set quantity_requested = greatest(0, pri.quantity_requested - new_ordered.qty)
    from (
      select purchase_request_item_id, sum(coalesce(quantity_fulfilled, quantity_ordered)) as qty
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

-- ---------------------------------------------------------------------------
-- goods_receipt_create: restated in full from
-- 202609090003_goods_receipt_actual_lead_time.sql (the confirmed latest -
-- not the older 202608220001_stock_movements.sql, which is missing ri_no /
-- lead-time logic added since). Stock 'in' movements posted the raw
-- transaction quantity (quantity_received) unconverted; now prorates by
-- quantity_fulfilled / quantity_ordered, reducing to quantity_received
-- unchanged whenever quantity_fulfilled is null (units already matched).
-- ---------------------------------------------------------------------------

create or replace function public.goods_receipt_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_po_id uuid := (p_payload->>'purchase_order_id')::uuid;
  v_received_at timestamptz := coalesce(nullif(p_payload->>'received_at', '')::timestamptz, now());
  v_receipt_id uuid;
  v_ri_no text;
  v_seq int;
  v_pr_id uuid;
  v_project_id uuid;
  v_plot_id uuid;
  v_order_date date;
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

  select purchase_request_id, project_id, plot_id, order_date
  into v_pr_id, v_project_id, v_plot_id, v_order_date
  from public.purchase_orders where id = v_po_id;

  if not found then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;

  insert into public.goods_receipt_number_counters (receipt_date, counter)
  values (v_received_at::date, 1)
  on conflict (receipt_date) do update set counter = goods_receipt_number_counters.counter + 1
  returning counter into v_seq;

  v_ri_no := 'RI-' || to_char(v_received_at::date, 'YYYYMMDD') || lpad(v_seq::text, 3, '0');

  insert into public.goods_receipts (purchase_order_id, ri_no, delivery_note_no, received_by, note, received_at)
  values (v_po_id, v_ri_no, p_payload->>'delivery_note_no', v_uid, p_payload->>'note', v_received_at)
  returning id into v_receipt_id;

  insert into public.goods_receipt_items (goods_receipt_id, purchase_order_item_id, quantity_received, unit_price_at_receipt)
  select
    v_receipt_id,
    (i->>'purchase_order_item_id')::uuid,
    (i->>'quantity_received')::numeric,
    coalesce((i->>'unit_price_at_receipt')::numeric, 0)
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

  if v_new_po_status = 'received' and v_pr_id is not null then
    update public.purchase_requests set status = 'received' where id = v_pr_id;
  end if;

  -- Stock 'in' posts in the material's catalog unit. Prorates this receipt's
  -- share of the line by quantity_fulfilled / quantity_ordered, so a partial
  -- receipt across several RIs still sums correctly; reduces to
  -- quantity_received unchanged whenever quantity_fulfilled is null (the
  -- common case - units already matched).
  for v_line in
    select gri.id as receipt_item_id, poi.material_type_id, gri.quantity_received,
           poi.quantity_ordered, poi.quantity_fulfilled
    from public.goods_receipt_items gri
    join public.purchase_order_items poi on poi.id = gri.purchase_order_item_id
    where gri.goods_receipt_id = v_receipt_id
  loop
    perform public._stock_movement_post(
      p_material_type_id => v_line.material_type_id,
      p_project_id        => v_project_id,
      p_type              => 'in',
      p_source_type       => 'goods_receipt',
      p_source_id         => v_line.receipt_item_id,
      p_quantity          => v_line.quantity_received
        * coalesce(v_line.quantity_fulfilled, v_line.quantity_ordered)
        / nullif(v_line.quantity_ordered, 0),
      p_plot_id           => v_plot_id,
      p_approved_by       => v_uid,
      p_note              => 'Goods receipt' || case
        when coalesce(p_payload->>'delivery_note_no', '') <> '' then ' (' || (p_payload->>'delivery_note_no') || ')'
        else ''
      end
    );
  end loop;

  return jsonb_build_object('id', v_receipt_id, 'ri_no', v_ri_no, 'po_status', v_new_po_status);
end;
$$;

grant execute on function public.goods_receipt_create(jsonb) to authenticated;
grant execute on function public.goods_receipt_create(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- boq_control_rollup: restated in full from 202609150001_boq_qty_control.sql,
-- changing only the `ordered` CTE's ordered_qty line to
-- coalesce(quantity_fulfilled, quantity_ordered). received_qty deliberately
-- left unconverted - not rendered as a raw quantity anywhere today
-- (components/cost-control/QtyControlTab.tsx only uses ordered+issued for
-- status/percent) - a future caller must apply the same care before
-- displaying it next to `unit`.
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
      sum(coalesce(poi.quantity_fulfilled, poi.quantity_ordered) * pw.scope_plots_count::numeric / pw.total_plots) as ordered_qty,
      sum(poi.quantity_received * pw.scope_plots_count::numeric / pw.total_plots) as received_qty,
      sum(poi.quantity_ordered * poi.unit_price * pw.scope_plots_count::numeric / pw.total_plots) as ordered_value,
      sum(poi.quantity_received * poi.unit_price * pw.scope_plots_count::numeric / pw.total_plots) as received_value,
      bool_or(pw.scope_plots_count < pw.total_plots and pw.scope_plots_count > 0) as is_estimated
    from po_weight pw
    join public.purchase_order_items poi on poi.purchase_order_id = pw.po_id
    where pw.scope_plots_count > 0
    group by poi.material_type_id
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
-- boq_control_material_detail: restated in full from
-- 202609150006_boq_control_pr_doc_no_format.sql (itself the latest
-- restatement of 202609150001's version), changing only the `po_rows` CTE's
-- quantity line to coalesce(quantity_fulfilled, quantity_ordered).
-- stock_rows/pr_rows are untouched - neither reads quantity_ordered.
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
      sum(coalesce(poi.quantity_fulfilled, poi.quantity_ordered)) as quantity,
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

-- ---------------------------------------------------------------------------
-- boq_control_unassigned: restated in full from
-- 202609150001_boq_qty_control.sql, changing only the final select's
-- ordered_qty line to coalesce(quantity_fulfilled, quantity_ordered).
-- ordered_value is unchanged (money, still quantity_ordered x unit_price).
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
    sum(coalesce(poi.quantity_fulfilled, poi.quantity_ordered)) as ordered_qty,
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
