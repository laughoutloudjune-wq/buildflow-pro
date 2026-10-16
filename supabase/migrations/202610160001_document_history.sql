-- Document history (MATERIAL_TRAIL_PLAN.md, Phase A - "stop erasing history").
--
-- Until now several actions physically deleted procurement rows with no trace:
-- "undo received" deleted the receipts and their stock movements, editing a
-- PR rewrote all its lines, editing a PO dropped lines and allocations,
-- deleting a PO / voiding a payment voucher removed them outright. An auditor
-- could only ever see the final state.
--
-- Rather than restating every one of those RPCs, one generic AFTER trigger on
-- each procurement table copies every insert / update / delete into
-- document_events, tagged with the PR / PO / receipt / voucher it belongs to,
-- who did it (auth.uid()), and which transaction it was part of (so one user
-- action - e.g. "edit PO" touching ten rows - reads back as one entry).
--
-- The RPCs that destroy data now also take a required reason (the parameter
-- defaults to null only so a stale client gets the clear 'reason required'
-- error instead of 'function not found'), which they put
-- in a transaction-local setting the trigger copies onto every row it logs:
--   po_unmark_received(p_id, p_reason)   action 'undo_received'
--   po_delete(p_id, p_reason)            action 'delete_po'
--   payment_voucher_void(p_id, p_reason) action 'void_voucher'
--   po_cancel(p_id, p_reason)            action 'cancel_po' (reason stays optional)

create table if not exists public.document_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  tx_id bigint not null default txid_current(),
  actor_id uuid default auth.uid(),
  table_name text not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  row_id uuid,
  pr_id uuid,
  po_id uuid,
  gr_id uuid,
  pv_id uuid,
  action text,
  reason text,
  -- insert: null / delete: the whole row / update: only the changed columns' old values
  old_data jsonb,
  -- insert and update: the whole new row / delete: null
  new_data jsonb
);

create index if not exists document_events_pr_idx on public.document_events (pr_id) where pr_id is not null;
create index if not exists document_events_po_idx on public.document_events (po_id) where po_id is not null;
create index if not exists document_events_gr_idx on public.document_events (gr_id) where gr_id is not null;
create index if not exists document_events_pv_idx on public.document_events (pv_id) where pv_id is not null;
create index if not exists document_events_row_idx on public.document_events (table_name, row_id);
create index if not exists document_events_occurred_idx on public.document_events (occurred_at desc);

alter table public.document_events enable row level security;
revoke all on table public.document_events from anon, authenticated;
grant select on table public.document_events to authenticated;

drop policy if exists document_events_select on public.document_events;
create policy document_events_select on public.document_events
  for select to authenticated
  using (public._billing_current_role() in ('admin', 'pm', 'foreman'));

-- Parent lookups. Each first reads the live row; if it is already gone (a
-- cascade delete fires the child trigger after its parent was removed) it
-- falls back to the parent's own delete event logged earlier in the same
-- statement.
create or replace function public._doc_event_po_of_item(p_poi uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select purchase_order_id from public.purchase_order_items where id = p_poi),
    (select po_id from public.document_events
      where table_name = 'purchase_order_items' and row_id = p_poi and po_id is not null
      order by id desc limit 1)
  );
$$;

create or replace function public._doc_event_pr_of_item(p_pri uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select purchase_request_id from public.purchase_request_items where id = p_pri),
    (select pr_id from public.document_events
      where table_name = 'purchase_request_items' and row_id = p_pri and pr_id is not null
      order by id desc limit 1)
  );
$$;

create or replace function public._doc_event_po_of_receipt(p_gr uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select purchase_order_id from public.goods_receipts where id = p_gr),
    (select po_id from public.document_events
      where table_name = 'goods_receipts' and row_id = p_gr and po_id is not null
      order by id desc limit 1)
  );
$$;

create or replace function public._doc_event_gr_of_receipt_item(p_gri uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select goods_receipt_id from public.goods_receipt_items where id = p_gri),
    (select gr_id from public.document_events
      where table_name = 'goods_receipt_items' and row_id = p_gri and gr_id is not null
      order by id desc limit 1)
  );
$$;

revoke all on function public._doc_event_po_of_item(uuid) from public, anon, authenticated;
revoke all on function public._doc_event_pr_of_item(uuid) from public, anon, authenticated;
revoke all on function public._doc_event_po_of_receipt(uuid) from public, anon, authenticated;
revoke all on function public._doc_event_gr_of_receipt_item(uuid) from public, anon, authenticated;

create or replace function public._doc_event_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  v_changed jsonb;
  v_pr uuid;
  v_po uuid;
  v_gr uuid;
  v_pv uuid;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(o.key, o.value)
    into v_changed
    from jsonb_each(v_old) o
    where o.value is distinct from v_new -> o.key
      and o.key <> 'updated_at';

    -- Nothing a person would call a change (e.g. only updated_at moved).
    if v_changed is null then
      return null;
    end if;
    v_old := v_changed;
  end if;

  case tg_table_name
    when 'purchase_requests' then
      v_pr := (v_row ->> 'id')::uuid;
    when 'purchase_request_items', 'purchase_request_plots' then
      v_pr := (v_row ->> 'purchase_request_id')::uuid;
    when 'purchase_request_item_settlements' then
      v_pr := public._doc_event_pr_of_item((v_row ->> 'purchase_request_item_id')::uuid);
    when 'purchase_orders' then
      v_po := (v_row ->> 'id')::uuid;
      v_pr := (v_row ->> 'purchase_request_id')::uuid;
    when 'purchase_order_items', 'purchase_order_plots' then
      v_po := (v_row ->> 'purchase_order_id')::uuid;
    when 'purchase_order_item_allocations' then
      v_po := public._doc_event_po_of_item((v_row ->> 'purchase_order_item_id')::uuid);
      v_pr := public._doc_event_pr_of_item((v_row ->> 'purchase_request_item_id')::uuid);
    when 'goods_receipts' then
      v_gr := (v_row ->> 'id')::uuid;
      v_po := (v_row ->> 'purchase_order_id')::uuid;
    when 'goods_receipt_items' then
      v_gr := (v_row ->> 'goods_receipt_id')::uuid;
      v_po := public._doc_event_po_of_receipt(v_gr);
    when 'stock_movements' then
      if v_row ->> 'source_type' in ('goods_receipt', 'direct_to_site') then
        v_gr := public._doc_event_gr_of_receipt_item((v_row ->> 'source_id')::uuid);
        v_po := public._doc_event_po_of_receipt(v_gr);
      end if;
    when 'payment_vouchers' then
      v_pv := (v_row ->> 'id')::uuid;
    when 'payment_voucher_receipts' then
      v_pv := (v_row ->> 'payment_voucher_id')::uuid;
      v_gr := (v_row ->> 'goods_receipt_id')::uuid;
      v_po := public._doc_event_po_of_receipt(v_gr);
    else
      null;
  end case;

  insert into public.document_events (
    table_name, op, row_id, pr_id, po_id, gr_id, pv_id, action, reason, old_data, new_data
  ) values (
    tg_table_name,
    lower(tg_op),
    case when v_row ? 'id' then (v_row ->> 'id')::uuid end,
    v_pr, v_po, v_gr, v_pv,
    nullif(current_setting('app.doc_action', true), ''),
    nullif(current_setting('app.doc_reason', true), ''),
    v_old,
    v_new
  );

  return null;
end;
$$;

revoke all on function public._doc_event_log() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'purchase_requests', 'purchase_request_items', 'purchase_request_plots',
    'purchase_request_item_settlements',
    'purchase_orders', 'purchase_order_items', 'purchase_order_plots',
    'purchase_order_item_allocations',
    'goods_receipts', 'goods_receipt_items',
    'payment_vouchers', 'payment_voucher_receipts'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_doc_event', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public._doc_event_log()',
      t || '_doc_event', t
    );
  end loop;
end;
$$;

-- stock_movements is already a ledger: every insert IS the record. Only log
-- the rows that get changed or removed afterwards.
drop trigger if exists stock_movements_doc_event on public.stock_movements;
create trigger stock_movements_doc_event
  after update or delete on public.stock_movements
  for each row execute function public._doc_event_log();

-- ---------------------------------------------------------------------------
-- Destructive RPCs: same bodies as before, plus a required reason that is
-- stamped on every history row they cause.
-- ---------------------------------------------------------------------------

drop function if exists public.po_unmark_received(uuid);
create or replace function public.po_unmark_received(p_id uuid, p_reason text default null)
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
  v_alloc_pr uuid;
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can unmark a purchase order as received' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required' using errcode = '22023';
  end if;

  perform set_config('app.doc_action', 'undo_received', true);
  perform set_config('app.doc_reason', btrim(p_reason), true);

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

  -- Every request this order is linked to goes back from 'received' to
  -- 'ordered' - not just the legacy header one.
  foreach v_alloc_pr in array public._po_alloc_pr_ids(p_id)
  loop
    update public.purchase_requests set status = 'ordered' where id = v_alloc_pr and status = 'received';
  end loop;

  return jsonb_build_object('id', p_id, 'status', 'sent');
end;
$$;

drop function if exists public.po_delete(uuid);
create or replace function public.po_delete(p_id uuid, p_reason text default null)
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
  v_pr_ids uuid[];
  v_pr uuid;
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can delete a purchase order' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required' using errcode = '22023';
  end if;

  perform set_config('app.doc_action', 'delete_po', true);
  perform set_config('app.doc_reason', btrim(p_reason), true);

  select status, po_no into v_status, v_po_no
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

  v_pr_ids := public._po_alloc_pr_ids(p_id);

  if v_status <> 'cancelled' then
    perform public._po_alloc_lock(public._po_alloc_pri_ids(p_id));
    perform public._po_alloc_apply_qty(p_id, 1);
  end if;

  delete from public.purchase_orders where id = p_id;

  foreach v_pr in array v_pr_ids
  loop
    perform public._pr_recompute_status(v_pr);
  end loop;

  return jsonb_build_object('id', p_id, 'po_no', v_po_no);
end;
$$;

drop function if exists public.payment_voucher_void(uuid);
create or replace function public.payment_voucher_void(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._billing_current_role();
  v_po_ids uuid[];
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can void a payment voucher' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required' using errcode = '22023';
  end if;

  perform set_config('app.doc_action', 'void_voucher', true);
  perform set_config('app.doc_reason', btrim(p_reason), true);

  select array_agg(distinct gr.purchase_order_id) into v_po_ids
  from public.payment_voucher_receipts pvr
  join public.goods_receipts gr on gr.id = pvr.goods_receipt_id
  where pvr.payment_voucher_id = p_id;

  if v_po_ids is null then
    raise exception 'Payment voucher not found' using errcode = 'P0002';
  end if;

  delete from public.payment_vouchers where id = p_id;

  update public.purchase_orders
  set status = 'received', paid_at = null, paid_by = null
  where id = any(v_po_ids) and status = 'paid';

  return jsonb_build_object('id', p_id, 'voided', true);
end;
$$;

-- po_cancel keeps its signature and optional reason; it only gains the tag.
create or replace function public.po_cancel(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._billing_current_role();
  v_status text;
  v_has_receipts boolean;
  v_pr_ids uuid[];
  v_pr uuid;
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can cancel a purchase order' using errcode = '42501';
  end if;

  perform set_config('app.doc_action', 'cancel_po', true);
  perform set_config('app.doc_reason', coalesce(btrim(p_reason), ''), true);

  select status into v_status from public.purchase_orders where id = p_id;

  if v_status is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.purchase_order_items where purchase_order_id = p_id and quantity_received > 0
  ) into v_has_receipts;

  if v_has_receipts then
    raise exception 'Cannot cancel a purchase order that already has goods received' using errcode = '42501';
  end if;

  v_pr_ids := public._po_alloc_pr_ids(p_id);

  if v_status <> 'cancelled' then
    perform public._po_alloc_lock(public._po_alloc_pri_ids(p_id));
    perform public._po_alloc_apply_qty(p_id, 1);
  end if;

  update public.purchase_orders
  set status = 'cancelled', note = coalesce(note || E'\n', '') || coalesce('Cancelled: ' || p_reason, 'Cancelled')
  where id = p_id;

  foreach v_pr in array v_pr_ids
  loop
    perform public._pr_recompute_status(v_pr);
  end loop;

  return jsonb_build_object('id', p_id, 'status', 'cancelled');
end;
$$;

revoke all on function public.po_unmark_received(uuid, text) from public, anon;
revoke all on function public.po_delete(uuid, text) from public, anon;
revoke all on function public.payment_voucher_void(uuid, text) from public, anon;
grant execute on function public.po_unmark_received(uuid, text) to authenticated, service_role;
grant execute on function public.po_delete(uuid, text) to authenticated, service_role;
grant execute on function public.payment_voucher_void(uuid, text) to authenticated, service_role;
