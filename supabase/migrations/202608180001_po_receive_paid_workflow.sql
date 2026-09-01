-- Reshapes the PO lifecycle into an explicit linear pipeline that the UI's
-- three tabs (PO / Receive Bill / Paid Bill) read directly off `status`:
--   draft -> sent -> received -> paid
-- with cancellation possible from draft/sent, and reverting exactly one
-- step at a time via the *_unmark_* RPCs below. No new tables - tab
-- membership is just a status filter (see actions/procurement/orders.ts).

alter table public.purchase_orders add column if not exists confirmed_at timestamptz;
alter table public.purchase_orders add column if not exists received_at date;
alter table public.purchase_orders add column if not exists received_by uuid references public.profiles(id);
alter table public.purchase_orders add column if not exists paid_at date;
alter table public.purchase_orders add column if not exists paid_by uuid references public.profiles(id);

alter table public.purchase_orders drop constraint if exists purchase_orders_status_check;
alter table public.purchase_orders add constraint purchase_orders_status_check
  check (status in ('draft', 'sent', 'partially_received', 'received', 'paid', 'cancelled'));

-- ---------------------------------------------------------------------------
-- po_create: same as before, plus stamping confirmed_at when created
-- directly as 'sent' (the default - see actions/procurement/orders.ts).
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
    po_no, supplier_id, company_id, project_id, plot_id, purchase_request_id,
    order_date, expected_delivery_date, vat_percent, vat_type, payment_terms,
    discount_type, discount_value, discount_amount,
    subtotal, vat_amount, total_amount,
    note, created_by, status, confirmed_at
  ) values (
    v_po_no,
    (p_payload->>'supplier_id')::uuid,
    (p_payload->>'company_id')::uuid,
    (p_payload->>'project_id')::uuid,
    public._jsonb_to_uuid(p_payload->'plot_id'),
    v_pr_id,
    v_order_date,
    nullif(p_payload->>'expected_delivery_date', '')::date,
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
-- po_set_status: same draft<->sent toggle as before, now also stamps
-- confirmed_at when moving into 'sent'.
-- ---------------------------------------------------------------------------
create or replace function public.po_set_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._billing_current_role();
  v_current text;
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can change purchase order status' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'sent') then
    raise exception 'Status can only be set to draft or sent here' using errcode = '42501';
  end if;

  select status into v_current from public.purchase_orders where id = p_id;
  if v_current is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if v_current not in ('draft', 'sent') then
    raise exception 'Cannot change status once receiving has started or the order is cancelled' using errcode = '42501';
  end if;

  update public.purchase_orders
  set status = p_status,
      confirmed_at = case when p_status = 'sent' then now() else confirmed_at end
  where id = p_id;

  return jsonb_build_object('id', p_id, 'status', p_status);
end;
$$;

grant execute on function public.po_set_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- goods_receipt_create: unchanged logic, plus stamping received_at/by when
-- it auto-completes a PO, so the Receive tab's date column is always
-- populated regardless of which of the two receiving paths finished it.
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
  v_receipt_id uuid;
  v_pr_id uuid;
  v_all_received boolean;
  v_any_received boolean;
  v_new_po_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can record a goods receipt' using errcode = '42501';
  end if;

  select purchase_request_id into v_pr_id from public.purchase_orders where id = v_po_id;
  if not found then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;

  insert into public.goods_receipts (purchase_order_id, delivery_note_no, received_by, note)
  values (v_po_id, p_payload->>'delivery_note_no', v_uid, p_payload->>'note')
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
      received_at = case when v_new_po_status = 'received' then current_date else received_at end,
      received_by = case when v_new_po_status = 'received' then v_uid else received_by end
  where id = v_po_id;

  if v_new_po_status = 'received' and v_pr_id is not null then
    update public.purchase_requests set status = 'received' where id = v_pr_id;
  end if;

  return jsonb_build_object('id', v_receipt_id, 'po_status', v_new_po_status);
end;
$$;

grant execute on function public.goods_receipt_create(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- po_mark_received / po_unmark_received: the new whole-document "I'm
-- calling this received, on this date" action, independent of per-line
-- quantity entry.
-- ---------------------------------------------------------------------------
create or replace function public.po_mark_received(p_id uuid, p_received_at date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can mark a purchase order as received' using errcode = '42501';
  end if;

  select status into v_status from public.purchase_orders where id = p_id;
  if v_status is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if v_status not in ('sent', 'partially_received') then
    raise exception 'Only a sent or partially received purchase order can be marked received' using errcode = '42501';
  end if;

  update public.purchase_orders
  set status = 'received',
      received_at = coalesce(p_received_at, current_date),
      received_by = v_uid
  where id = p_id;

  return jsonb_build_object('id', p_id, 'status', 'received');
end;
$$;

grant execute on function public.po_mark_received(uuid, date) to authenticated;

create or replace function public.po_unmark_received(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._billing_current_role();
  v_status text;
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can unmark a purchase order as received' using errcode = '42501';
  end if;

  select status into v_status from public.purchase_orders where id = p_id;
  if v_status is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if v_status <> 'received' then
    raise exception 'Only a received purchase order can be unmarked (undo paid first if it has been paid)' using errcode = '42501';
  end if;

  update public.purchase_orders
  set status = 'sent', received_at = null, received_by = null
  where id = p_id;

  return jsonb_build_object('id', p_id, 'status', 'sent');
end;
$$;

grant execute on function public.po_unmark_received(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- po_mark_paid (bulk) / po_unmark_paid
-- ---------------------------------------------------------------------------
create or replace function public.po_mark_paid(p_ids uuid[], p_paid_at date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_count int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can mark purchase orders as paid' using errcode = '42501';
  end if;

  update public.purchase_orders
  set status = 'paid',
      paid_at = coalesce(p_paid_at, current_date),
      paid_by = v_uid
  where id = any(p_ids) and status = 'received';

  get diagnostics v_count = row_count;

  return jsonb_build_object('updated', v_count);
end;
$$;

grant execute on function public.po_mark_paid(uuid[], date) to authenticated;

create or replace function public.po_unmark_paid(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._billing_current_role();
  v_status text;
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can unmark a purchase order as paid' using errcode = '42501';
  end if;

  select status into v_status from public.purchase_orders where id = p_id;
  if v_status is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if v_status <> 'paid' then
    raise exception 'Only a paid purchase order can be unmarked' using errcode = '42501';
  end if;

  update public.purchase_orders
  set status = 'received', paid_at = null, paid_by = null
  where id = p_id;

  return jsonb_build_object('id', p_id, 'status', 'received');
end;
$$;

grant execute on function public.po_unmark_paid(uuid) to authenticated;
