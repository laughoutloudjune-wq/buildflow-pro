-- The PO list page's row selection had no bulk action on the main "PO" tab
-- (only "mark as paid" on the Receive tab) - this adds the ability to
-- delete a purchase order outright. Deletion is only safe before any
-- receiving has happened: once goods_receipt_create or po_mark_received has
-- touched the order, its numbers are load-bearing for stock and billing
-- history, so cancel (po_cancel, keeps the record with a 'cancelled' status)
-- is the right tool instead. Both the status and a direct goods_receipts
-- check are enforced, mirroring po_update's belt-and-suspenders pattern -
-- po_mark_received can flip status straight to 'received'/'paid' without
-- ever creating a goods_receipts row, so the status check alone isn't
-- sufficient.
--
-- purchase_order_items cascades on delete already (see 202608170001), so no
-- separate cleanup is needed there. goods_receipts does NOT cascade - if
-- receipts exist, the guard below rejects before the delete is attempted.
--
-- If the order was created from an approved purchase request, deleting it
-- reverts that request back to 'approved' so it can be re-ordered - unlike
-- cancel, delete leaves no PO record behind to explain why the request is
-- stuck at 'ordered'.

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

  delete from public.purchase_orders where id = p_id;

  if v_pr_id is not null then
    update public.purchase_requests set status = 'approved' where id = v_pr_id and status = 'ordered';
  end if;

  return jsonb_build_object('id', p_id, 'po_no', v_po_no);
end;
$$;

revoke all on function public.po_delete(uuid) from public;
revoke all on function public.po_delete(uuid) from anon;
grant execute on function public.po_delete(uuid) to authenticated;
grant execute on function public.po_delete(uuid) to service_role;
