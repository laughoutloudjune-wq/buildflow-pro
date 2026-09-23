-- The "ยกเลิกการรับของ" (undo received) button on a purchase order has
-- always looked like a real undo (its own confirm text says "cancel the
-- receiving and go back to confirmed-order status"), but po_unmark_received
-- only ever flipped purchase_orders.status back to 'sent' - it never
-- touched purchase_order_items.quantity_received, never touched
-- goods_receipts/goods_receipt_items, and never reversed the stock_movements
-- a receipt posted. So after "undo": every line still shows its old
-- received quantity, GoodsReceiptModal's receivableItems (quantity_ordered -
-- quantity_received) is still 0 for all of them, and the user is stuck -
-- exactly the bug reported 2026-09-23 ("when i click undo, each list still
-- show how much received and when i click received there's no material to
-- choose").
--
-- Scope, per the user's own call (asked directly, not guessed): undo
-- everything ever received on the PO, not a picker for one specific
-- delivery among several - matches what the existing single button already
-- promises, needs no new UI.
--
-- Restated in full: same function name/signature so the existing action
-- (unmarkPurchaseOrderReceived) and button need no wiring changes, only
-- their confirm text updated.
--
-- Design notes:
--   - Reverses stock_balances directly (not via a posted correction pair)
--     and deletes the original stock_movements rows outright - this is
--     voiding a data-entry mistake, not recording a real return to
--     supplier, so the ledger should end up clean, not carrying a
--     confusing "received then immediately un-received" pair.
--   - Guards every reversal the same way _stock_movement_post's own 'out'
--     branch does (quantity_on_hand >= amount, else raise) - undoing a
--     receipt whose material has already been withdrawn or issued
--     elsewhere must fail loudly, never silently drive the balance
--     negative. A destination='site' line's paired in+out already nets to
--     zero, so it skips the balance check entirely and only needs its
--     movement rows deleted.
--   - Refuses up front if any of the PO's receipts already have a payment
--     voucher against them (payment_voucher_receipts.goods_receipt_id has
--     no ON DELETE CASCADE - deleting straight through would either throw
--     a raw FK error or, if the constraint is ever loosened later, silently
--     orphan real payment records). Void the payment first.
--   - Reverts a 'received' purchase_requests row to 'ordered' when this was
--     the PO holding it there - _pr_recompute_status doesn't apply (it only
--     ever moves a request between 'approved' and 'ordered', deliberately
--     never touches 'received').
--   - material_types.lead_time_days is left as whatever the voided receipt
--     last overwrote it to - goods_receipt_create overwrites it with no
--     history kept, so there is nothing to restore it to. A known, minor,
--     cosmetic gap.
--   - Now also allowed from 'partially_received', not just 'received' - a
--     bad date/quantity is just as likely on a partial delivery.

create or replace function public.po_unmark_received(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._billing_current_role();
  v_status text;
  v_pr_id uuid;
  v_item record;
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can unmark a purchase order as received' using errcode = '42501';
  end if;

  select status, purchase_request_id into v_status, v_pr_id
  from public.purchase_orders where id = p_id;

  if v_status is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if v_status not in ('received', 'partially_received') then
    raise exception 'Only a purchase order that has already received something can have its receiving undone' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.payment_voucher_receipts pvr
    join public.goods_receipts gr on gr.id = pvr.goods_receipt_id
    where gr.purchase_order_id = p_id
  ) then
    raise exception 'Cannot undo receiving - a payment has already been recorded against one of this order''s receipts' using errcode = '42501';
  end if;

  for v_item in
    select
      gri.id as receipt_item_id,
      gri.purchase_order_item_id,
      poi.material_type_id,
      gri.quantity_received,
      coalesce(gri.destination, gr.default_destination) as eff_destination
    from public.goods_receipt_items gri
    join public.goods_receipts gr on gr.id = gri.goods_receipt_id
    join public.purchase_order_items poi on poi.id = gri.purchase_order_item_id
    where gr.purchase_order_id = p_id
  loop
    -- destination='site' posted a paired in+out that already nets to zero -
    -- nothing to give back, only the movement rows need to go.
    if v_item.eff_destination = 'store' then
      update public.stock_balances
      set quantity_on_hand = quantity_on_hand - v_item.quantity_received,
          updated_at = now()
      where material_type_id = v_item.material_type_id
        and quantity_on_hand >= v_item.quantity_received;

      if not found then
        raise exception 'Cannot undo receiving - some of the received material has already been withdrawn or used elsewhere' using errcode = '22023';
      end if;
    end if;

    delete from public.stock_movements where source_id = v_item.receipt_item_id;

    update public.purchase_order_items
    set quantity_received = quantity_received - v_item.quantity_received
    where id = v_item.purchase_order_item_id;
  end loop;

  delete from public.goods_receipt_items
  where goods_receipt_id in (select id from public.goods_receipts where purchase_order_id = p_id);

  delete from public.goods_receipts where purchase_order_id = p_id;

  update public.purchase_orders
  set status = 'sent', received_at = null, received_by = null
  where id = p_id;

  if v_pr_id is not null then
    update public.purchase_requests set status = 'ordered' where id = v_pr_id and status = 'received';
  end if;

  return jsonb_build_object('id', p_id, 'status', 'sent');
end;
$$;

revoke all on function public.po_unmark_received(uuid) from public;
revoke all on function public.po_unmark_received(uuid) from anon;
grant execute on function public.po_unmark_received(uuid) to authenticated;
grant execute on function public.po_unmark_received(uuid) to service_role;
