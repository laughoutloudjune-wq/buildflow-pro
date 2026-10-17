-- Undoing a receipt must reverse the stock by what actually went into stock
-- (goods_receipt_items.stock_quantity, else quantity_received), not by the PO
-- unit quantity, and must put the store's average cost back in line with the
-- receipts that remain.
--
-- po_unmark_received is patched in place from its live text; any expected
-- fragment that is missing fails the migration loudly instead of silently
-- doing nothing.
--
-- The average cost after an undo is the quantity-weighted mean of the priced
-- store receipts that remain. That is exact when stock was only ever received
-- at those prices and a close approximation otherwise (opening balances carry
-- no price and are left out). The balance's old average is kept when no priced
-- receipt remains.

do $patch$
declare
  v_def text;
  v_new text;

begin
  v_def := pg_get_functiondef('public.po_unmark_received(uuid,text)'::regprocedure);
  v_new := v_def;

  if (length(v_new) - length(replace(v_new, E'      gri.quantity_received,\n      coalesce(gri.destination, gr.default_destination) as eff_destination', ''))) <> length(E'      gri.quantity_received,\n      coalesce(gri.destination, gr.default_destination) as eff_destination') then
    raise exception 'po_unmark_received: loop select not found exactly once';
  end if;
  v_new := replace(v_new, E'      gri.quantity_received,\n      coalesce(gri.destination, gr.default_destination) as eff_destination',
    E'      gri.quantity_received,\n      coalesce(gri.stock_quantity, gri.quantity_received) as stock_qty,\n      coalesce(gri.destination, gr.default_destination) as eff_destination');

  if (length(v_new) - length(replace(v_new, 'set quantity_on_hand = quantity_on_hand - v_item.quantity_received,', ''))) <> length('set quantity_on_hand = quantity_on_hand - v_item.quantity_received,') then
    raise exception 'po_unmark_received: balance reversal not found exactly once';
  end if;
  v_new := replace(v_new, 'set quantity_on_hand = quantity_on_hand - v_item.quantity_received,',
                          'set quantity_on_hand = quantity_on_hand - v_item.stock_qty,');

  if (length(v_new) - length(replace(v_new, 'and quantity_on_hand >= v_item.quantity_received;', ''))) <> length('and quantity_on_hand >= v_item.quantity_received;') then
    raise exception 'po_unmark_received: balance guard not found exactly once';
  end if;
  v_new := replace(v_new, 'and quantity_on_hand >= v_item.quantity_received;',
                          'and quantity_on_hand >= v_item.stock_qty;');

  if (length(v_new) - length(replace(v_new, E'  delete from public.goods_receipt_items\n  where goods_receipt_id in', ''))) <> length(E'  delete from public.goods_receipt_items\n  where goods_receipt_id in') then
    raise exception 'po_unmark_received: receipt item delete not found exactly once';
  end if;
  v_new := replace(v_new, E'  delete from public.goods_receipt_items\n  where goods_receipt_id in',
    E'  update public.stock_balances sb\n  set avg_cost = coalesce((\n    select sum(sm.quantity * sm.unit_cost) / nullif(sum(sm.quantity), 0)\n    from public.stock_movements sm\n    where sm.material_type_id = sb.material_type_id\n      and sm.type = ''in''\n      and sm.source_type = ''goods_receipt''\n      and sm.unit_cost is not null\n  ), sb.avg_cost)\n  where sb.material_type_id in (\n    select poi.material_type_id from public.purchase_order_items poi where poi.purchase_order_id = p_id\n  );\n  delete from public.goods_receipt_items\n  where goods_receipt_id in');

  execute v_new;
end
$patch$;
