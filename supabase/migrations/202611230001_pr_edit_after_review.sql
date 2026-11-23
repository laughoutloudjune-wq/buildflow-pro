-- Edit a purchase request after it has been approved (e.g. a material ran out
-- and the foreman needs more). pr_update only allows pending_review requests
-- and rewrites every line, which would orphan PO links, allocations and
-- settlements, so this is a separate function that works IN PLACE:
--   * lines sent with an "id" are updated (quantity, note, job/purpose, unit);
--     their material never changes, and the unit cannot change once the line
--     is linked to a PO (allocations are matched by unit);
--   * asking for MORE on a line a PO already covers (ordered/arrived/closed)
--     leaves that line as ordered and adds the extra quantity as a new open
--     line, so the PO side stays true and the extra shows up as still to buy;
--   * lines sent without an id are added;
--   * lines not mentioned are left exactly as they are, nothing is removed
--     (a line nobody wants any more is closed with the existing
--     "ไม่ซื้อรายการ" action, which keeps the paper trail);
--   * project and plot stay as approved (BOQ control and POs hang off them).
-- Afterwards every line state and the request status are recomputed, so more
-- quantity (or a new line) puts the request back in "waiting for a PO" and a
-- request already marked received/ordered reopens. Purpose is kept/updated.
-- Only admin/pm (the purchasing side) may do this.
-- Contains no DROP/DELETE. Safe to run twice.
create or replace function public.pr_edit_reviewed(p_id uuid, p_payload jsonb)
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
  v_item jsonb;
  v_id uuid;
  v_old public.purchase_request_items%rowtype;
  v_qty numeric;
  v_unit text;
  v_linked boolean;
  v_pri uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'No permission to edit this purchase request' using errcode = '42501';
  end if;

  select status, pr_no::text into v_status, v_pr_no from public.purchase_requests where id = p_id for update;
  if v_status is null then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;
  if v_status not in ('approved','ordered','received') then
    raise exception 'ใบนี้แก้ไขไม่ได้ในสถานะปัจจุบัน' using errcode = '42501';
  end if;

  update public.purchase_requests set
    note = p_payload->>'note',
    needed_by_date = nullif(p_payload->>'needed_by_date', '')::date
  where id = p_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) loop
    v_qty := (v_item->>'quantity_requested')::numeric;
    if coalesce(v_qty, 0) <= 0 then
      raise exception 'จำนวนต้องมากกว่า 0 (ถ้าไม่ต้องการรายการนี้แล้ว ให้ใช้ "ไม่ซื้อรายการ")' using errcode = '22023';
    end if;
    v_id := public._jsonb_to_uuid(v_item->'id');
    v_unit := nullif(v_item->>'unit', '');

    if v_id is null then
      insert into public.purchase_request_items
        (purchase_request_id, material_type_id, quantity_requested, quantity_requested_original, note, boq_id, unit, purpose)
      values (
        p_id,
        (v_item->>'material_type_id')::bigint,
        v_qty,
        v_qty,
        v_item->>'note',
        public._jsonb_to_uuid(v_item->'boq_id'),
        v_unit,
        nullif(btrim(v_item->>'purpose'), '')
      )
      returning id into v_pri;
      perform public._pri_resync_material(v_pri);
    else
      select * into v_old from public.purchase_request_items where id = v_id and purchase_request_id = p_id;
      if not found then
        raise exception 'ไม่พบรายการที่ต้องการแก้ไข' using errcode = 'P0002';
      end if;
      v_linked := exists (select 1 from public.purchase_order_items where purchase_request_item_id = v_id)
        or exists (select 1 from public.purchase_order_item_allocations where purchase_request_item_id = v_id)
        or exists (select 1 from public.purchase_request_item_settlements where purchase_request_item_id = v_id);
      if v_linked and coalesce(v_unit, '') is distinct from coalesce(v_old.unit, '') then
        raise exception 'รายการที่ผูกกับใบสั่งซื้อแล้วเปลี่ยนหน่วยไม่ได้' using errcode = '22023';
      end if;
      if v_old.line_status <> 'open' and v_qty > v_old.quantity_requested then
        -- covered line asked for more: keep it as ordered, extra becomes a new line
        insert into public.purchase_request_items
          (purchase_request_id, material_type_id, quantity_requested, quantity_requested_original, note, boq_id, unit, purpose)
        values (
          p_id, v_old.material_type_id, v_qty - v_old.quantity_requested, v_qty - v_old.quantity_requested,
          v_item->>'note', public._jsonb_to_uuid(v_item->'boq_id'), v_old.unit, nullif(btrim(v_item->>'purpose'), '')
        )
        returning id into v_pri;
        perform public._pri_resync_material(v_pri);
        v_qty := v_old.quantity_requested;
      end if;
      update public.purchase_request_items set
        quantity_requested = v_qty,
        quantity_requested_original = case when quantity_requested_original is not null then v_qty else null end,
        note = v_item->>'note',
        boq_id = public._jsonb_to_uuid(v_item->'boq_id'),
        unit = v_unit,
        purpose = nullif(btrim(v_item->>'purpose'), '')
      where id = v_id;
      perform public._pri_resync_material(v_id);
    end if;
  end loop;

  -- A received request that gained something to buy is no longer finished.
  if v_status = 'received' and exists (
    select 1 from public.purchase_request_items where purchase_request_id = p_id and line_status = 'open'
  ) then
    update public.purchase_requests set status = 'ordered' where id = p_id;
  end if;
  perform public._pr_recompute_status(p_id);

  return jsonb_build_object('id', p_id, 'pr_no', v_pr_no);
end;
$$;

revoke all on function public.pr_edit_reviewed(uuid, jsonb) from public;
revoke all on function public.pr_edit_reviewed(uuid, jsonb) from anon;
grant execute on function public.pr_edit_reviewed(uuid, jsonb) to authenticated;
