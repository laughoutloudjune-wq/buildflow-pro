-- Handover plan Phase 3.4 (H-01): supplier payment vouchers ignored PO
-- discounts. po_create/po_update work out the PO total net of both the
-- line-level and header-level discounts, but goods_receipt_create was
-- saving the *gross* unit_price on every receipt line, and
-- payment_voucher_create sums quantity_received x unit_price_at_receipt +
-- VAT straight off that - so on any discounted PO the voucher total came
-- out higher than the PO total, and that's what actually gets paid.
--
-- Fix: goods_receipt_create now computes and stores a *net* unit price per
-- line - unit_price minus that line's own discount per unit, then minus the
-- line's share of the PO's header discount (share = this line's net total
-- over the sum of every line's net total on the PO), using the exact same
-- discount math po_create/po_update already use. The client-sent
-- unit_price_at_receipt is no longer trusted - it's ignored in favour of
-- this database-computed net price. payment_voucher_create also gets a
-- backstop: the total ever paid against a PO (across every voucher) can
-- never exceed purchase_orders.total_amount by more than ฿1 of rounding.
--
-- Existing data is untouched: the 43 live receipts keep their already-gross
-- unit_price_at_receipt (only one PO among them was ever discounted, and no
-- payment voucher has been created yet, so nothing has actually been paid
-- wrong) - this only changes how *new* receipts are priced from here on.

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

  -- Same discount math as po_create/po_update: every line's own discount is
  -- already in purchase_order_items.discount_amount; the header discount is
  -- worked out on what's left after those, then split across lines by each
  -- line's share of that remainder.
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

  -- unit_price_at_receipt is computed here, not taken from the payload -
  -- the line's net unit price (its own discount, then its share of the PO
  -- header discount), same VAT-exclusive basis po_create's total_amount
  -- uses, so a fully received discounted PO reconciles to the cent.
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

create or replace function public.payment_voucher_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_supplier_id uuid := (p_payload->>'supplier_id')::uuid;
  v_company_id uuid := (p_payload->>'company_id')::uuid;
  v_payment_date date := coalesce(nullif(p_payload->>'payment_date', '')::date, current_date);
  v_payment_method text := coalesce(nullif(p_payload->>'payment_method', ''), 'cash');
  v_receipt_ids uuid[];
  v_pp_no text;
  v_voucher_id uuid;
  v_subtotal numeric := 0;
  v_vat_amount numeric := 0;
  v_total numeric := 0;
  v_bad_count int;
  v_po record;
  v_all_paid boolean;
  v_po_total_paid numeric;
  v_po_total_amount numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can create a payment voucher' using errcode = '42501';
  end if;
  if v_supplier_id is null then
    raise exception 'Supplier is required' using errcode = '22004';
  end if;

  select array_agg(distinct value::uuid) into v_receipt_ids
  from jsonb_array_elements_text(coalesce(p_payload->'receipt_ids', '[]'::jsonb));

  if v_receipt_ids is null or array_length(v_receipt_ids, 1) is null then
    raise exception 'Select at least one receipt to pay' using errcode = '22004';
  end if;

  select count(*) into v_bad_count
  from unnest(v_receipt_ids) rid
  where not exists (
    select 1 from public.goods_receipts gr
    join public.purchase_orders po on po.id = gr.purchase_order_id
    where gr.id = rid and po.supplier_id = v_supplier_id
  ) or exists (
    select 1 from public.payment_voucher_receipts pvr where pvr.goods_receipt_id = rid
  );
  if v_bad_count > 0 then
    raise exception 'One or more selected receipts are invalid, belong to a different supplier, or are already paid' using errcode = '22023';
  end if;

  v_pp_no := 'PP-' || lpad(nextval('public.payment_voucher_no_seq')::text, 9, '0');

  insert into public.payment_vouchers (pp_no, supplier_id, company_id, payment_date, payment_method, note, created_by)
  values (v_pp_no, v_supplier_id, v_company_id, v_payment_date, v_payment_method, nullif(p_payload->>'note', ''), v_uid)
  returning id into v_voucher_id;

  with receipt_totals as (
    select
      gr.id as receipt_id,
      gr.purchase_order_id,
      po.vat_percent,
      po.vat_type,
      coalesce(sum(gri.quantity_received * gri.unit_price_at_receipt), 0) as line_total
    from public.goods_receipts gr
    join public.purchase_orders po on po.id = gr.purchase_order_id
    join public.goods_receipt_items gri on gri.goods_receipt_id = gr.id
    where gr.id = any(v_receipt_ids)
    group by gr.id, gr.purchase_order_id, po.vat_percent, po.vat_type
  ),
  computed as (
    select
      receipt_id,
      case when vat_type = 'inclusive' and vat_percent > 0
        then round(line_total / (1 + vat_percent / 100), 2)
        else line_total
      end as r_subtotal,
      case when vat_type = 'inclusive' and vat_percent > 0
        then line_total - round(line_total / (1 + vat_percent / 100), 2)
        else round(line_total * vat_percent / 100, 2)
      end as r_vat,
      case when vat_type = 'inclusive'
        then line_total
        else line_total + round(line_total * vat_percent / 100, 2)
      end as r_total
    from receipt_totals
  )
  insert into public.payment_voucher_receipts (payment_voucher_id, goods_receipt_id, subtotal, vat_amount, amount)
  select v_voucher_id, receipt_id, r_subtotal, r_vat, r_total from computed;

  select coalesce(sum(subtotal), 0), coalesce(sum(vat_amount), 0), coalesce(sum(amount), 0)
  into v_subtotal, v_vat_amount, v_total
  from public.payment_voucher_receipts where payment_voucher_id = v_voucher_id;

  update public.payment_vouchers
  set subtotal = v_subtotal, vat_amount = v_vat_amount, total_amount = v_total
  where id = v_voucher_id;

  for v_po in
    select distinct gr.purchase_order_id as id
    from public.goods_receipts gr
    where gr.id = any(v_receipt_ids)
  loop
    -- H-01 backstop: even with the receipt-time net pricing above, this
    -- catches anything that still slips through (a receipt priced before
    -- this fix, a manually edited PO) before it actually gets paid out.
    select coalesce(sum(pvr.amount), 0) into v_po_total_paid
    from public.payment_voucher_receipts pvr
    join public.goods_receipts gr2 on gr2.id = pvr.goods_receipt_id
    where gr2.purchase_order_id = v_po.id;

    select total_amount into v_po_total_amount from public.purchase_orders where id = v_po.id;

    if v_po_total_paid > v_po_total_amount + 1 then
      raise exception 'Total paid on this purchase order would exceed its total amount' using errcode = '22023';
    end if;

    select bool_and(pvr.id is not null) into v_all_paid
    from public.goods_receipts gr
    left join public.payment_voucher_receipts pvr on pvr.goods_receipt_id = gr.id
    where gr.purchase_order_id = v_po.id;

    if v_all_paid then
      update public.purchase_orders
      set status = 'paid', paid_at = v_payment_date, paid_by = v_uid
      where id = v_po.id and status = 'received';
    end if;
  end loop;

  return jsonb_build_object('id', v_voucher_id, 'pp_no', v_pp_no, 'total_amount', v_total);
end;
$function$;
