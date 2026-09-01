-- Stock ledger (Phase 1 of the Stock Movement integration plan).
--
-- BuildFlow Pro has never had an on-hand balance for any material: a goods
-- receipt closes out a PO line, and material_usage_log records what a
-- foreman used, but nothing ties the two together. This migration adds the
-- ledger and wires the one write path that already exists (receiving a PO)
-- into it. It deliberately does NOT touch material_usage_log yet, and does
-- NOT add a client-facing "withdraw stock for a contractor" RPC yet - both
-- are open decisions for the next phase (see the integration plan), not
-- something to default silently here.
--
-- Same pattern as procurement (202608170001_procurement.sql): a
-- security-definer function does every write so the ledger row and the
-- running balance can never drift apart, and RLS on both new tables is
-- select-only for authenticated - there is deliberately no insert/update
-- policy, matching goods_receipts/goods_receipt_items.
--
-- `type`/`source_type` are narrowed to exactly what this migration's logic
-- produces ('in' / 'goods_receipt'), the same way purchase_orders_status_check
-- grew one value at a time as each feature actually shipped (see
-- 202608180001_po_receive_paid_workflow.sql adding 'paid'). 'out' and
-- 'manual_request' arrive with the quick-request RPC in the next phase,
-- via `alter table ... drop constraint / add constraint`, not pre-declared
-- here.
--
-- Stock is tracked per (material_type_id, project_id) - not per warehouse -
-- because that's the only location dimension either system already has.
-- Confirm this still matches how materials are actually stored on site
-- before the mobile client starts writing to it.
--
-- Safe to run multiple times (uses CREATE OR REPLACE / IF NOT EXISTS).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  material_type_id bigint not null references public.material_types(id),
  project_id uuid not null references public.projects(id),
  plot_id uuid references public.plots(id),
  contractor_id uuid references public.contractors(id),
  type text not null check (type in ('in')),
  source_type text not null check (source_type in ('goods_receipt')),
  -- Polymorphic pointer (goods_receipt_items.id today; purchase_request
  -- items or a future manual-request table later) - no FK, by necessity.
  source_id uuid,
  quantity numeric not null check (quantity > 0),
  prev_qty numeric not null default 0,
  new_qty numeric not null default 0,
  requested_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists stock_movements_material_project_idx
  on public.stock_movements (material_type_id, project_id, created_at desc);
create index if not exists stock_movements_source_idx
  on public.stock_movements (source_type, source_id);

create table if not exists public.stock_balances (
  material_type_id bigint not null references public.material_types(id),
  project_id uuid not null references public.projects(id),
  quantity_on_hand numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (material_type_id, project_id)
);

-- ---------------------------------------------------------------------------
-- RLS - select open to authenticated; every write goes through
-- _stock_movement_post (security definer), never a client-side insert.
-- ---------------------------------------------------------------------------

alter table public.stock_movements enable row level security;
alter table public.stock_balances enable row level security;

drop policy if exists "stock_movements_select" on public.stock_movements;
create policy "stock_movements_select" on public.stock_movements for select to authenticated using (true);

drop policy if exists "stock_balances_select" on public.stock_balances;
create policy "stock_balances_select" on public.stock_balances for select to authenticated using (true);

grant select on public.stock_movements, public.stock_balances to authenticated;

-- ---------------------------------------------------------------------------
-- _stock_movement_post: the one place that writes to either table. Not
-- granted to authenticated - it's an internal helper called from within
-- other security-definer functions (goods_receipt_create today), the same
-- way _jsonb_to_uuid is never called directly from the client either.
-- ---------------------------------------------------------------------------

create or replace function public._stock_movement_post(
  p_material_type_id bigint,
  p_project_id uuid,
  p_type text,
  p_source_type text,
  p_source_id uuid,
  p_quantity numeric,
  p_plot_id uuid default null,
  p_contractor_id uuid default null,
  p_requested_by uuid default null,
  p_approved_by uuid default null,
  p_note text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev numeric;
  v_new numeric;
  v_row public.stock_movements;
begin
  -- Only 'in' is wired up in this phase - see header comment. Widen this
  -- check alongside the table constraint when 'out' ships.
  if p_type <> 'in' then
    raise exception 'Stock movement type % is not wired up yet', p_type using errcode = '22023';
  end if;
  if p_quantity <= 0 then
    raise exception 'Stock movement quantity must be positive' using errcode = '22023';
  end if;

  insert into public.stock_balances (material_type_id, project_id, quantity_on_hand, updated_at)
  values (p_material_type_id, p_project_id, p_quantity, now())
  on conflict (material_type_id, project_id) do update
    set quantity_on_hand = public.stock_balances.quantity_on_hand + p_quantity,
        updated_at = now()
  returning quantity_on_hand - p_quantity, quantity_on_hand into v_prev, v_new;

  insert into public.stock_movements (
    material_type_id, project_id, plot_id, contractor_id,
    type, source_type, source_id,
    quantity, prev_qty, new_qty,
    requested_by, approved_by, note
  ) values (
    p_material_type_id, p_project_id, p_plot_id, p_contractor_id,
    p_type, p_source_type, p_source_id,
    p_quantity, v_prev, v_new,
    p_requested_by, p_approved_by, p_note
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public._stock_movement_post(
  bigint, uuid, text, text, uuid, numeric, uuid, uuid, uuid, uuid, text
) from public;
revoke all on function public._stock_movement_post(
  bigint, uuid, text, text, uuid, numeric, uuid, uuid, uuid, uuid, text
) from anon;

-- ---------------------------------------------------------------------------
-- goods_receipt_create: unchanged logic (copied from
-- 202608180001_po_receive_paid_workflow.sql), plus posting one 'in' stock
-- movement per receipt line right after the PO/PR status cascade. This is
-- the join point the integration plan called out - receiving and stocking-in
-- become one action instead of two ledgers that never talk to each other.
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
  v_project_id uuid;
  v_plot_id uuid;
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

  select purchase_request_id, project_id, plot_id
  into v_pr_id, v_project_id, v_plot_id
  from public.purchase_orders where id = v_po_id;

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

  for v_line in
    select gri.id as receipt_item_id, poi.material_type_id, gri.quantity_received
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
      p_quantity          => v_line.quantity_received,
      p_plot_id           => v_plot_id,
      p_approved_by       => v_uid,
      p_note              => 'Goods receipt' || case
        when coalesce(p_payload->>'delivery_note_no', '') <> '' then ' (' || (p_payload->>'delivery_note_no') || ')'
        else ''
      end
    );
  end loop;

  return jsonb_build_object('id', v_receipt_id, 'po_status', v_new_po_status);
end;
$$;

grant execute on function public.goods_receipt_create(jsonb) to authenticated;
grant execute on function public.goods_receipt_create(jsonb) to service_role;
