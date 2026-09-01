-- Purchase orders currently scope to at most one plot (plot_id). Real
-- orders regularly cover a whole batch of houses built together (e.g.
-- "98-102") - BuildFlow Pro already has a concept for this, plot_groups
-- (see 202607160002_plot_groups.sql), already wired into stock_movements
-- (202608310005_stock_movements_plot_group.sql). This brings purchase_orders
-- to the same shape: plot_id and plot_group_id are mutually exclusive, both
-- stay nullable (plenty of real orders - site-wide supplies, shared
-- infrastructure - aren't tied to any one house or batch).
--
-- po_create and po_update are reproduced verbatim from their previous
-- definitions (202608180002_po_delivery_fields.sql) with only plot_group_id
-- added - Postgres has no partial function replace.

alter table public.purchase_orders
  add column if not exists plot_group_id uuid references public.plot_groups(id);

alter table public.purchase_orders drop constraint if exists purchase_orders_plot_xor_group;
alter table public.purchase_orders add constraint purchase_orders_plot_xor_group
  check (plot_id is null or plot_group_id is null);

-- ---------------------------------------------------------------------------
-- po_create: accept plot_group_id alongside plot_id
-- ---------------------------------------------------------------------------
create or replace function public.po_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_po_id uuid;
  v_po_no text;
  v_order_date date := coalesce(nullif(p_payload->>'order_date', '')::date, current_date);
  v_seq int;
  v_pr_id uuid := public._jsonb_to_uuid(p_payload->'purchase_request_id');
  v_plot_id uuid := public._jsonb_to_uuid(p_payload->'plot_id');
  v_plot_group_id uuid := public._jsonb_to_uuid(p_payload->'plot_group_id');
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

  insert into public.purchase_orders (
    po_no, supplier_id, company_id, project_id, plot_id, plot_group_id, purchase_request_id,
    order_date, expected_delivery_date, delivery_address, vat_percent, vat_type, payment_terms,
    discount_type, discount_value, discount_amount,
    subtotal, vat_amount, total_amount,
    note, created_by, status, confirmed_at
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
    case when v_status = 'sent' then now() else null end
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

  if v_pr_id is not null then
    update public.purchase_requests set status = 'ordered' where id = v_pr_id and status = 'approved';
  end if;

  return jsonb_build_object('id', v_po_id, 'po_no', v_po_no);
end;
$$;

grant execute on function public.po_create(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- po_update: accept plot_group_id alongside plot_id
-- ---------------------------------------------------------------------------
create or replace function public.po_update(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._billing_current_role();
  v_status text;
  v_po_no text;
  v_has_receipts boolean;
  v_plot_id uuid := public._jsonb_to_uuid(p_payload->'plot_id');
  v_plot_group_id uuid := public._jsonb_to_uuid(p_payload->'plot_group_id');
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
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can edit a purchase order' using errcode = '42501';
  end if;
  if v_plot_id is not null and v_plot_group_id is not null then
    raise exception 'Choose either a single plot or a plot group, not both' using errcode = '22023';
  end if;

  select status, po_no into v_status, v_po_no from public.purchase_orders where id = p_id;
  if v_status is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if v_status not in ('draft', 'sent') then
    raise exception 'Cannot edit a purchase order that has already been received or cancelled' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.purchase_order_items where purchase_order_id = p_id and quantity_received > 0
  ) into v_has_receipts;
  if v_has_receipts then
    raise exception 'Cannot edit a purchase order that already has goods received' using errcode = '42501';
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
    note = p_payload->>'note'
  where id = p_id;

  delete from public.purchase_order_items where purchase_order_id = p_id;

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
  where coalesce((i->>'quantity_ordered')::numeric, 0) > 0;

  return jsonb_build_object('id', p_id, 'po_no', v_po_no);
end;
$$;

grant execute on function public.po_update(uuid, jsonb) to authenticated;
