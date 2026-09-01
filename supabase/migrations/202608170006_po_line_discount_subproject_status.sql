-- Four additions:
--   1. Per-line-item discount (separate from the whole-PO discount that
--      already exists) - real invoices commonly discount individual lines
--      differently from a document-level discount.
--   2. plot_id on purchase_orders ("sub project" - reusing the existing
--      project -> plot relationship already used by purchase_requests,
--      billings, etc., rather than inventing a new concept).
--   3. po_set_status RPC so a PO's status can be manually toggled between
--      draft/sent from the UI (deliberately restricted to those two states -
--      once receiving has started, status only changes through the goods
--      receipt / cancel flows, never a manual override).
--   4. vat_type: whether the entered unit prices already include VAT
--      ('inclusive' - VAT is extracted from the price, total unchanged) or
--      exclude it ('exclusive' - VAT is added on top, the existing default
--      behavior).

alter table public.purchase_order_items add column if not exists discount_type text not null default 'none'
  check (discount_type in ('none', 'percent', 'amount'));
alter table public.purchase_order_items add column if not exists discount_value numeric not null default 0;
alter table public.purchase_order_items add column if not exists discount_amount numeric not null default 0;

alter table public.purchase_orders add column if not exists plot_id uuid references public.plots(id);
alter table public.purchase_orders add column if not exists vat_type text not null default 'exclusive'
  check (vat_type in ('exclusive', 'inclusive'));

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
    -- v_net_of_discounts already includes VAT: extract it, total stays as-is.
    v_taxable := round(v_net_of_discounts / (1 + v_vat_percent / 100), 2);
    v_vat_amount := v_net_of_discounts - v_taxable;
    v_total := v_net_of_discounts;
  else
    -- exclusive (or no VAT at all): VAT is added on top of the net amount.
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
    note, created_by, status
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
    v_status
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
-- po_set_status: manual draft <-> sent toggle only. Once anything has been
-- received, or the PO is cancelled, status changes exclusively through
-- goods_receipt_create / po_cancel - never this function.
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

  update public.purchase_orders set status = p_status where id = p_id;
  return jsonb_build_object('id', p_id, 'status', p_status);
end;
$$;

grant execute on function public.po_set_status(uuid, text) to authenticated;
