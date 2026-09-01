-- Procurement module (office side): suppliers, companies, purchase requests,
-- purchase orders, and goods receipts.
--
-- Mirrors the billing module's approach (see 202604240001_billing_rpcs.sql):
-- every multi-table write goes through a `security definer` RPC so it's
-- atomic, and every RPC recomputes money totals server-side rather than
-- trusting the client. Role checks run inside the functions as defense in
-- depth on top of the TS-side `requireRole` calls.
--
-- Deliberately reuses the existing `material_types` catalog instead of a new
-- materials table, and the existing `_billing_current_role()` helper for
-- role lookups.
--
-- Safe to run multiple times (uses CREATE OR REPLACE / IF NOT EXISTS).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text,
  email text,
  address text,
  tax_id text,
  payment_terms text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_id text,
  address text,
  phone text,
  logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  pr_no serial,
  project_id uuid not null references public.projects(id),
  plot_id uuid references public.plots(id),
  status text not null default 'pending_review'
    check (status in ('pending_review','approved','rejected','ordered','received','cancelled')),
  note text,
  review_note text,
  needed_by_date date,
  requested_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  material_type_id bigint not null references public.material_types(id),
  quantity_requested numeric not null check (quantity_requested > 0),
  note text
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_no serial,
  supplier_id uuid not null references public.suppliers(id),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  purchase_request_id uuid references public.purchase_requests(id),
  status text not null default 'draft'
    check (status in ('draft','sent','partially_received','received','cancelled')),
  order_date date not null default current_date,
  expected_delivery_date date,
  vat_percent numeric not null default 0,
  subtotal numeric not null default 0,
  vat_amount numeric not null default 0,
  total_amount numeric not null default 0,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  material_type_id bigint not null references public.material_types(id),
  purchase_request_item_id uuid references public.purchase_request_items(id),
  quantity_ordered numeric not null check (quantity_ordered > 0),
  unit_price numeric not null default 0,
  -- Maintained only by goods_receipt_create - never edited directly.
  quantity_received numeric not null default 0
);

create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id),
  delivery_note_no text,
  received_by uuid not null references public.profiles(id),
  received_at timestamptz not null default now(),
  note text
);

create table if not exists public.goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
  purchase_order_item_id uuid not null references public.purchase_order_items(id),
  quantity_received numeric not null check (quantity_received > 0),
  unit_price_at_receipt numeric not null default 0
);

create index if not exists purchase_requests_project_idx on public.purchase_requests (project_id, status);
create index if not exists purchase_orders_project_idx on public.purchase_orders (project_id, status);
create index if not exists purchase_order_items_po_idx on public.purchase_order_items (purchase_order_id);
create index if not exists goods_receipt_items_receipt_idx on public.goods_receipt_items (goods_receipt_id);

-- ---------------------------------------------------------------------------
-- notifications: add PR support alongside the existing billing_id column
-- ---------------------------------------------------------------------------

alter table public.notifications add column if not exists purchase_request_id uuid references public.purchase_requests(id) on delete cascade;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_request','billing_approved','billing_rejected','pr_pending_review','pr_approved','pr_rejected'));

-- ---------------------------------------------------------------------------
-- RLS - select open to authenticated; all writes go through the RPCs below
-- ---------------------------------------------------------------------------

alter table public.suppliers enable row level security;
alter table public.companies enable row level security;
alter table public.purchase_requests enable row level security;
alter table public.purchase_request_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_items enable row level security;

drop policy if exists "suppliers_select" on public.suppliers;
create policy "suppliers_select" on public.suppliers for select to authenticated using (true);

drop policy if exists "companies_select" on public.companies;
create policy "companies_select" on public.companies for select to authenticated using (true);

drop policy if exists "purchase_requests_select" on public.purchase_requests;
create policy "purchase_requests_select" on public.purchase_requests for select to authenticated using (true);

drop policy if exists "purchase_request_items_select" on public.purchase_request_items;
create policy "purchase_request_items_select" on public.purchase_request_items for select to authenticated using (true);

drop policy if exists "purchase_orders_select" on public.purchase_orders;
create policy "purchase_orders_select" on public.purchase_orders for select to authenticated using (true);

drop policy if exists "purchase_order_items_select" on public.purchase_order_items;
create policy "purchase_order_items_select" on public.purchase_order_items for select to authenticated using (true);

drop policy if exists "goods_receipts_select" on public.goods_receipts;
create policy "goods_receipts_select" on public.goods_receipts for select to authenticated using (true);

drop policy if exists "goods_receipt_items_select" on public.goods_receipt_items;
create policy "goods_receipt_items_select" on public.goods_receipt_items for select to authenticated using (true);

grant select on public.suppliers, public.companies, public.purchase_requests, public.purchase_request_items,
  public.purchase_orders, public.purchase_order_items, public.goods_receipts, public.goods_receipt_items
  to authenticated;

-- Suppliers/companies CRUD from Settings is plain admin-gated TS (requireRole
-- inside the server action), same as material_types - but that table has no
-- write policy either, relying entirely on the TS role check plus the
-- service role used by createClient() on the server. Match that here too.
grant insert, update, delete on public.suppliers, public.companies to authenticated;
drop policy if exists "suppliers_write" on public.suppliers;
create policy "suppliers_write" on public.suppliers for all to authenticated using (true) with check (true);
drop policy if exists "companies_write" on public.companies;
create policy "companies_write" on public.companies for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- RPC: pr_create - foreman/pm/admin submit a purchase request
-- ---------------------------------------------------------------------------
create or replace function public.pr_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_pr_id uuid;
  v_pr_no text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('foreman','pm','admin') then
    raise exception 'No permission to create purchase request' using errcode = '42501';
  end if;

  insert into public.purchase_requests (project_id, plot_id, note, needed_by_date, requested_by, status)
  values (
    (p_payload->>'project_id')::uuid,
    public._jsonb_to_uuid(p_payload->'plot_id'),
    p_payload->>'note',
    nullif(p_payload->>'needed_by_date', '')::date,
    v_uid,
    'pending_review'
  )
  returning id, pr_no::text into v_pr_id, v_pr_no;

  insert into public.purchase_request_items (purchase_request_id, material_type_id, quantity_requested, note)
  select
    v_pr_id,
    (i->>'material_type_id')::bigint,
    (i->>'quantity_requested')::numeric,
    i->>'note'
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where coalesce((i->>'quantity_requested')::numeric, 0) > 0;

  insert into public.notifications (recipient_id, purchase_request_id, type)
  select p.id, v_pr_id, 'pr_pending_review'
  from public.profiles p
  where p.role in ('pm','admin');

  return jsonb_build_object('id', v_pr_id, 'pr_no', v_pr_no);
end;
$$;

grant execute on function public.pr_create(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: pr_approve / pr_reject
-- ---------------------------------------------------------------------------
create or replace function public.pr_approve(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_requested_by uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can approve a purchase request' using errcode = '42501';
  end if;

  select status, requested_by into v_status, v_requested_by
  from public.purchase_requests where id = p_id;

  if v_status is null then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'Only a pending request can be approved' using errcode = '42501';
  end if;

  update public.purchase_requests
  set status = 'approved', reviewed_by = v_uid, reviewed_at = now()
  where id = p_id;

  insert into public.notifications (recipient_id, purchase_request_id, type)
  values (v_requested_by, p_id, 'pr_approved');

  return jsonb_build_object('id', p_id, 'status', 'approved');
end;
$$;

grant execute on function public.pr_approve(uuid) to authenticated;

create or replace function public.pr_reject(p_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_requested_by uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can reject a purchase request' using errcode = '42501';
  end if;

  select status, requested_by into v_status, v_requested_by
  from public.purchase_requests where id = p_id;

  if v_status is null then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'Only a pending request can be rejected' using errcode = '42501';
  end if;

  update public.purchase_requests
  set status = 'rejected', reviewed_by = v_uid, reviewed_at = now(), review_note = p_note
  where id = p_id;

  insert into public.notifications (recipient_id, purchase_request_id, type)
  values (v_requested_by, p_id, 'pr_rejected');

  return jsonb_build_object('id', p_id, 'status', 'rejected');
end;
$$;

grant execute on function public.pr_reject(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: po_create - build a PO, optionally from an approved request.
-- Totals are always recomputed here from the submitted items, never trusted
-- from the client (same rule as billing_approve).
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
  v_pr_id uuid := public._jsonb_to_uuid(p_payload->'purchase_request_id');
  v_vat_percent numeric := coalesce((p_payload->>'vat_percent')::numeric, 0);
  v_subtotal numeric := 0;
  v_vat_amount numeric := 0;
  v_total numeric := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can create a purchase order' using errcode = '42501';
  end if;

  select coalesce(sum(coalesce((i->>'quantity_ordered')::numeric, 0) * coalesce((i->>'unit_price')::numeric, 0)), 0)
  into v_subtotal
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i;

  v_vat_amount := round(v_subtotal * v_vat_percent / 100, 2);
  v_total := v_subtotal + v_vat_amount;

  insert into public.purchase_orders (
    supplier_id, company_id, project_id, purchase_request_id,
    order_date, expected_delivery_date, vat_percent, subtotal, vat_amount, total_amount,
    note, created_by, status
  ) values (
    (p_payload->>'supplier_id')::uuid,
    (p_payload->>'company_id')::uuid,
    (p_payload->>'project_id')::uuid,
    v_pr_id,
    coalesce(nullif(p_payload->>'order_date', '')::date, current_date),
    nullif(p_payload->>'expected_delivery_date', '')::date,
    v_vat_percent,
    v_subtotal,
    v_vat_amount,
    v_total,
    p_payload->>'note',
    v_uid,
    'draft'
  )
  returning id, po_no::text into v_po_id, v_po_no;

  insert into public.purchase_order_items (
    purchase_order_id, material_type_id, purchase_request_item_id, quantity_ordered, unit_price
  )
  select
    v_po_id,
    (i->>'material_type_id')::bigint,
    public._jsonb_to_uuid(i->'purchase_request_item_id'),
    (i->>'quantity_ordered')::numeric,
    coalesce((i->>'unit_price')::numeric, 0)
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
-- RPC: po_send / po_cancel
-- ---------------------------------------------------------------------------
create or replace function public.po_send(p_id uuid)
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
    raise exception 'Only PM/Admin can send a purchase order' using errcode = '42501';
  end if;

  update public.purchase_orders set status = 'sent'
  where id = p_id and status = 'draft'
  returning status into v_status;

  if v_status is null then
    raise exception 'Purchase order not found or not in draft status' using errcode = '42501';
  end if;

  return jsonb_build_object('id', p_id, 'status', v_status);
end;
$$;

grant execute on function public.po_send(uuid) to authenticated;

create or replace function public.po_cancel(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._billing_current_role();
  v_has_receipts boolean;
  v_status text;
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can cancel a purchase order' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.purchase_order_items where purchase_order_id = p_id and quantity_received > 0
  ) into v_has_receipts;

  if v_has_receipts then
    raise exception 'Cannot cancel a purchase order that already has goods received' using errcode = '42501';
  end if;

  update public.purchase_orders
  set status = 'cancelled', note = coalesce(note || E'\n', '') || coalesce('Cancelled: ' || p_reason, 'Cancelled')
  where id = p_id
  returning status into v_status;

  if v_status is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('id', p_id, 'status', v_status);
end;
$$;

grant execute on function public.po_cancel(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: goods_receipt_create - the join point between procurement and stock.
-- Inserts the receipt, bumps each line's received quantity, recomputes the
-- PO's status, and cascades to the source request's status when everything
-- on the PO has arrived.
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

  update public.purchase_orders set status = v_new_po_status where id = v_po_id;

  if v_new_po_status = 'received' and v_pr_id is not null then
    update public.purchase_requests set status = 'received' where id = v_pr_id;
  end if;

  return jsonb_build_object('id', v_receipt_id, 'po_status', v_new_po_status);
end;
$$;

grant execute on function public.goods_receipt_create(jsonb) to authenticated;
