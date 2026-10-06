-- Multi-PR purchase orders: one PO line can now draw on several purchase
-- request lines.
--
-- The PO line stays the supplier-facing total ("Cement - 23 bags"); its rows
-- in purchase_order_item_allocations are the internal breakdown tying each
-- slice of that quantity to the request line (and so the request's plot or
-- batch) it came from:
--
--   PO line: Cement 23 bags
--     PR-101 (Plot 1)  10
--     PR-108 (Plot 2)   5
--     PR-112 (Plot 3)   8
--
-- purchase_orders.purchase_request_id can only name one request, so it is no
-- longer the source of truth - allocations are. The header column and
-- purchase_order_items.purchase_request_item_id are kept as a compatible read
-- path for older code and for the single-request shortcut: the line column
-- mirrors the allocation when a line has exactly one (null otherwise).
--
-- Quantity bookkeeping is unchanged in kind: a request line's
-- quantity_requested is its OUTSTANDING quantity and creating/editing an
-- order counts it down by the allocated quantity (same-unit lines only, as
-- before - see 202609170003). What changes is that the countdown, its
-- reversal (edit / cancel / delete / close-short) and the status recompute
-- all run per allocation, across every request an order touches.
--
-- Validation of explicit allocations (payload item.allocations) happens here,
-- inside the transaction, with the request lines row-locked in a fixed order:
-- the request must be approved, belong to the order's project, and the
-- quantity must be positive, in the line's material and unit, within what is
-- still outstanding, and sum exactly to the PO line quantity. A line that
-- only carries the old purchase_request_item_id (single-request flow) is
-- treated as one lenient allocation of its whole quantity, which keeps
-- material substitution and different-unit lines (closes_request_line)
-- working exactly as before.

create table if not exists public.purchase_order_item_allocations (
  id uuid primary key default gen_random_uuid(),
  purchase_order_item_id uuid not null references public.purchase_order_items(id) on delete cascade,
  purchase_request_item_id uuid not null references public.purchase_request_items(id) on delete restrict,
  quantity_allocated numeric not null check (quantity_allocated > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_order_item_allocations_unique_pair unique (purchase_order_item_id, purchase_request_item_id)
);

create index if not exists purchase_order_item_allocations_pri_idx
  on public.purchase_order_item_allocations (purchase_request_item_id);

alter table public.purchase_order_item_allocations enable row level security;
drop policy if exists purchase_order_item_allocations_select on public.purchase_order_item_allocations;
create policy purchase_order_item_allocations_select on public.purchase_order_item_allocations
  for select to authenticated using (true);
-- No write policies: allocations are only ever written by the security
-- definer po_* functions below.
revoke all on public.purchase_order_item_allocations from anon;
revoke insert, update, delete on public.purchase_order_item_allocations from authenticated;

-- Existing line-level links become allocations of the line's whole quantity.
-- Only explicit purchase_request_item_id links are migrated; lines with no
-- link (standalone / manual POs) stay unlinked - nothing is inferred from
-- notes, PO numbers or the header.
insert into public.purchase_order_item_allocations (
  purchase_order_item_id, purchase_request_item_id, quantity_allocated, created_by, created_at
)
select poi.id, poi.purchase_request_item_id, poi.quantity_ordered, po.created_by, po.created_at
from public.purchase_order_items poi
join public.purchase_orders po on po.id = poi.purchase_order_id
where poi.purchase_request_item_id is not null
  and poi.quantity_ordered > 0
on conflict (purchase_order_item_id, purchase_request_item_id) do nothing;

-- ---------------------------------------------------------------------------
-- Helpers (internal: only callable from the security definer po_* functions)
-- ---------------------------------------------------------------------------

-- Does this payload item carry an explicit allocations array? (Only those get
-- the strict validation.)
create or replace function public._po_item_is_explicit(p_item jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p_item->'allocations') = 'array' and jsonb_array_length(p_item->'allocations') > 0;
$$;

-- The allocation list for a payload item: its explicit allocations, else the
-- legacy single purchase_request_item_id as one allocation of the line's
-- whole quantity, else an empty list (standalone line).
create or replace function public._po_item_alloc_json(p_item jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when public._po_item_is_explicit(p_item) then p_item->'allocations'
    when public._jsonb_to_uuid(p_item->'purchase_request_item_id') is not null then
      jsonb_build_array(jsonb_build_object(
        'purchase_request_item_id', p_item->>'purchase_request_item_id',
        'quantity', p_item->>'quantity_ordered'
      ))
    else '[]'::jsonb
  end;
$$;

create or replace function public._po_alloc_json_pri_ids(p_allocs jsonb)
returns uuid[]
language sql
immutable
as $$
  select coalesce(array_agg(public._jsonb_to_uuid(e->'purchase_request_item_id'))
                  filter (where public._jsonb_to_uuid(e->'purchase_request_item_id') is not null), '{}')
  from jsonb_array_elements(coalesce(p_allocs, '[]'::jsonb)) e;
$$;

-- Every request line a payload's items point at (explicitly or via the legacy
-- link).
create or replace function public._po_payload_pri_ids(p_items jsonb)
returns uuid[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct x), '{}')
  from (
    select unnest(public._po_alloc_json_pri_ids(public._po_item_alloc_json(i))) as x
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  ) s;
$$;

create or replace function public._po_alloc_pri_ids(p_po_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct a.purchase_request_item_id), '{}')
  from public.purchase_order_item_allocations a
  join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
  where poi.purchase_order_id = p_po_id;
$$;

-- Every purchase request an order is linked to: through its allocations, plus
-- the legacy header link.
create or replace function public._po_alloc_pr_ids(p_po_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct x), '{}')
  from (
    select pri.purchase_request_id as x
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
    join public.purchase_request_items pri on pri.id = a.purchase_request_item_id
    where poi.purchase_order_id = p_po_id
    union
    select po.purchase_request_id from public.purchase_orders po
    where po.id = p_po_id and po.purchase_request_id is not null
  ) s;
$$;

create or replace function public._po_linked_to_pr(p_po_id uuid, p_pr_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.purchase_orders po where po.id = p_po_id and po.purchase_request_id = p_pr_id
  ) or exists (
    select 1
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
    join public.purchase_request_items pri on pri.id = a.purchase_request_item_id
    where poi.purchase_order_id = p_po_id and pri.purchase_request_id = p_pr_id
  );
$$;

-- Row-lock request lines in id order so concurrent orders serialise on them
-- (and cannot deadlock). Everything read after this call in the same
-- transaction sees the other writer's committed result.
create or replace function public._po_alloc_lock(p_pri_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_pri_ids is null or cardinality(p_pri_ids) = 0 then
    return;
  end if;
  perform 1
  from public.purchase_request_items
  where id = any(p_pri_ids)
  order by id
  for update;
end;
$$;

-- Count this order's allocations up (+1: give back) or down (-1: consume)
-- against their request lines' outstanding quantity. Same-unit lines only: a
-- line bought in a different unit than it was asked for is answered by
-- closes_request_line instead (see 202609170003), and subtracting a box count
-- from a piece count is the bug that rule exists to avoid.
create or replace function public._po_alloc_apply_qty(p_po_id uuid, p_sign int)
returns void
language sql
security definer
set search_path = public
as $$
  update public.purchase_request_items pri
  set quantity_requested = case
    when p_sign > 0 then pri.quantity_requested + t.qty
    else greatest(0, pri.quantity_requested - t.qty)
  end
  from (
    select a.purchase_request_item_id as pri_id, sum(a.quantity_allocated) as qty
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
    join public.purchase_request_items pri2 on pri2.id = a.purchase_request_item_id
    join public.material_types mt on mt.id = poi.material_type_id
    where poi.purchase_order_id = p_po_id
      and coalesce(poi.unit, mt.unit) is not distinct from coalesce(pri2.unit, mt.unit)
    group by a.purchase_request_item_id
  ) t
  where pri.id = t.pri_id;
$$;

-- Replace one PO line's allocations with p_allocs ([{purchase_request_item_id,
-- quantity}]). p_strict is true for lines whose payload carried an explicit
-- allocations array: those are fully validated here. A lenient (legacy
-- single-link) line only needs the request line to exist.
create or replace function public._po_item_set_allocations(
  p_po_id uuid,
  p_poi_id uuid,
  p_allocs jsonb,
  p_strict boolean,
  p_po_project_id uuid,
  p_prior_pairs jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_qty numeric;
  v_line_material bigint;
  v_line_unit text;
  v_a record;
  v_pr_status text;
  v_pr_project uuid;
  v_pri_material bigint;
  v_pri_unit text;
  v_sum numeric := 0;
  v_count int := 0;
  v_sole uuid;
begin
  delete from public.purchase_order_item_allocations where purchase_order_item_id = p_poi_id;

  select poi.quantity_ordered, poi.material_type_id, coalesce(poi.unit, mt.unit)
  into v_line_qty, v_line_material, v_line_unit
  from public.purchase_order_items poi
  join public.material_types mt on mt.id = poi.material_type_id
  where poi.id = p_poi_id and poi.purchase_order_id = p_po_id;
  if not found then
    raise exception 'Purchase order line not found' using errcode = 'P0002';
  end if;

  if p_allocs is not null and jsonb_typeof(p_allocs) = 'array' and jsonb_array_length(p_allocs) > 0 then
    if exists (
      select 1 from jsonb_array_elements(p_allocs) e
      group by e->>'purchase_request_item_id' having count(*) > 1
    ) then
      raise exception 'A request line can only be allocated once per order line' using errcode = '22023';
    end if;

    for v_a in
      select public._jsonb_to_uuid(e->'purchase_request_item_id') as pri_id,
             nullif(e->>'quantity', '')::numeric as qty
      from jsonb_array_elements(p_allocs) e
    loop
      if v_a.pri_id is null then
        raise exception 'Allocation is missing its purchase request line' using errcode = '22023';
      end if;
      if v_a.qty is null or v_a.qty <= 0 then
        if p_strict then
          raise exception 'Allocated quantity must be greater than zero' using errcode = '22023';
        end if;
        continue;
      end if;

      select pr.status, pr.project_id, pri.material_type_id, coalesce(pri.unit, mt.unit)
      into v_pr_status, v_pr_project, v_pri_material, v_pri_unit
      from public.purchase_request_items pri
      join public.purchase_requests pr on pr.id = pri.purchase_request_id
      join public.material_types mt on mt.id = pri.material_type_id
      where pri.id = v_a.pri_id;
      if not found then
        raise exception 'Purchase request line not found' using errcode = 'P0002';
      end if;

      if p_strict then
        if v_pr_status not in ('approved', 'ordered') and not exists (
          select 1 from jsonb_array_elements(coalesce(p_prior_pairs, '[]'::jsonb)) pp
          where public._jsonb_to_uuid(pp->'poi') = p_poi_id
            and public._jsonb_to_uuid(pp->'pri') = v_a.pri_id
        ) then
          raise exception 'Only an approved purchase request can be ordered' using errcode = '22023';
        end if;
        if v_pr_project is distinct from p_po_project_id then
          raise exception 'A purchase request line belongs to a different project than this order' using errcode = '22023';
        end if;
        if v_pri_material <> v_line_material then
          raise exception 'A purchase request line is for a different material than the order line' using errcode = '22023';
        end if;
        if v_pri_unit is distinct from v_line_unit then
          raise exception 'A purchase request line is in a different unit than the order line' using errcode = '22023';
        end if;
      end if;

      insert into public.purchase_order_item_allocations (
        purchase_order_item_id, purchase_request_item_id, quantity_allocated, created_by
      ) values (p_poi_id, v_a.pri_id, v_a.qty, auth.uid());

      v_sum := v_sum + v_a.qty;
      v_count := v_count + 1;
      v_sole := v_a.pri_id;
    end loop;
  end if;

  if p_strict and abs(v_sum - v_line_qty) > 0.0001 then
    raise exception 'The order line quantity must equal the sum of its request allocations' using errcode = '22023';
  end if;

  -- Keep the legacy line-level link as a read path: set only when the line
  -- answers exactly one request line.
  update public.purchase_order_items
  set purchase_request_item_id = case when v_count = 1 then v_sole else null end
  where id = p_poi_id;
end;
$$;

-- After every line's allocations are saved and the request lines' outstanding
-- quantities restored (create: untouched, update: given back), check that
-- the explicit allocations fit inside what is outstanding and that none lands
-- on a line another order already closed.
create or replace function public._po_alloc_validate(p_po_id uuid, p_strict_pris uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
begin
  if p_strict_pris is null or cardinality(p_strict_pris) = 0 then
    return;
  end if;

  for v_r in
    select pri.id as pri_id, pri.quantity_requested as remaining, sum(a.quantity_allocated) as alloc
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
    join public.purchase_request_items pri on pri.id = a.purchase_request_item_id
    where poi.purchase_order_id = p_po_id
      and a.purchase_request_item_id = any(p_strict_pris)
    group by pri.id, pri.quantity_requested
  loop
    if v_r.alloc > v_r.remaining + 0.0001 then
      raise exception 'Allocated quantity exceeds the remaining quantity on a purchase request line' using errcode = '22023';
    end if;
    if exists (
      select 1
      from public.purchase_order_item_allocations a2
      join public.purchase_order_items i2 on i2.id = a2.purchase_order_item_id
      join public.purchase_orders p2 on p2.id = i2.purchase_order_id
      where a2.purchase_request_item_id = v_r.pri_id
        and i2.closes_request_line
        and p2.status <> 'cancelled'
        and p2.id <> p_po_id
    ) then
      raise exception 'A purchase request line has already been closed by another purchase order' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public._po_item_is_explicit(jsonb) from public, anon, authenticated;
revoke all on function public._po_item_alloc_json(jsonb) from public, anon, authenticated;
revoke all on function public._po_alloc_json_pri_ids(jsonb) from public, anon, authenticated;
revoke all on function public._po_payload_pri_ids(jsonb) from public, anon, authenticated;
revoke all on function public._po_alloc_pri_ids(uuid) from public, anon, authenticated;
revoke all on function public._po_alloc_pr_ids(uuid) from public, anon, authenticated;
revoke all on function public._po_linked_to_pr(uuid, uuid) from public, anon, authenticated;
revoke all on function public._po_alloc_lock(uuid[]) from public, anon, authenticated;
revoke all on function public._po_alloc_apply_qty(uuid, int) from public, anon, authenticated;
revoke all on function public._po_item_set_allocations(uuid, uuid, jsonb, boolean, uuid, jsonb) from public, anon, authenticated;
revoke all on function public._po_alloc_validate(uuid, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- _pr_recompute_status: restated from 202609230006. A line counts as answered
-- by a PO's tick box (closes_request_line) through that PO line's
-- allocations - not just the legacy line-level link.
-- ---------------------------------------------------------------------------
create or replace function public._pr_recompute_status(p_pr_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.purchase_requests
  set status = case
    when exists (
      select 1
      from public.purchase_request_items pri
      where pri.purchase_request_id = p_pr_id
        and pri.quantity_requested > 0
        and not exists (
          select 1
          from public.purchase_order_item_allocations a
          join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
          join public.purchase_orders po on po.id = poi.purchase_order_id
          where a.purchase_request_item_id = pri.id
            and poi.closes_request_line
            and po.status <> 'cancelled'
        )
    ) then 'approved'
    else 'ordered'
  end
  where id = p_pr_id
    and status in ('approved', 'ordered');
$function$;

-- ---------------------------------------------------------------------------
-- po_create: restated from 202609230010. Lines are inserted one at a time so
-- each can carry its allocations; consumption and status recompute go through
-- the allocation helpers instead of the single header purchase request.
-- ---------------------------------------------------------------------------
create or replace function public.po_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_supplier_branch_id uuid := public._jsonb_to_uuid(p_payload->'supplier_branch_id');
  v_role text := public._billing_current_role();
  v_po_id uuid;
  v_po_no text;
  v_order_date date := coalesce(nullif(p_payload->>'order_date', '')::date, current_date);
  v_seq int;
  v_pr_id uuid := public._jsonb_to_uuid(p_payload->'purchase_request_id');
  v_pr_requested_by uuid;
  v_items jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  v_item record;
  v_poi_id uuid;
  v_alloc_json jsonb;
  v_strict_pris uuid[] := '{}';
  v_old_pr_ids uuid[] := '{}';
  v_new_pr_ids uuid[];
  v_pr uuid;
  v_project_id uuid := (p_payload->>'project_id')::uuid;
  v_plot_ids_count int := jsonb_array_length(coalesce(p_payload->'plot_ids', '[]'::jsonb));
  v_plot_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_id') end;
  v_plot_group_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_group_id') end;
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
  v_is_outside_boq boolean := coalesce((p_payload->>'is_outside_boq')::boolean, false);
  v_outside_boq_reason text := nullif(trim(both from coalesce(p_payload->>'outside_boq_reason', '')), '');
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
  if v_plot_id is not null and v_plot_group_id is not null then
    raise exception 'Choose either a single plot or a plot group, not both' using errcode = '22023';
  end if;
  if v_is_outside_boq and v_outside_boq_reason is null then
    raise exception 'A reason is required when marking a purchase order outside BOQ' using errcode = '22023';
  end if;
  if not v_is_outside_boq and v_plot_id is null and v_plot_group_id is null and v_plot_ids_count = 0 then
    raise exception 'A purchase order needs a plot, plot group, or plot selection - mark it outside BOQ if none applies' using errcode = '22023';
  end if;

  -- Per-line scope override validation: an item may reference a plot or a
  -- plot group (never both), and either must actually exist. A missing
  -- project_id alongside a valid plot/group is fine - it's derived from the
  -- plot below.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    where public._jsonb_to_uuid(i->'plot_id') is not null
      and public._jsonb_to_uuid(i->'plot_group_id') is not null
  ) then
    raise exception 'An order line cannot be scoped to both a plot and a plot group' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    where public._jsonb_to_uuid(i->'plot_id') is not null
      and not exists (select 1 from public.plots p where p.id = public._jsonb_to_uuid(i->'plot_id'))
  ) then
    raise exception 'One of the order lines references a plot that does not exist' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    where public._jsonb_to_uuid(i->'plot_group_id') is not null
      and not exists (select 1 from public.plot_groups g where g.id = public._jsonb_to_uuid(i->'plot_group_id'))
  ) then
    raise exception 'One of the order lines references a plot group that does not exist' using errcode = '22023';
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

  -- A branch is only meaningful for the supplier it belongs to; accepting a
  -- mismatched one would put the wrong branch on the tax invoice.
  if v_supplier_branch_id is not null and not exists (
    select 1 from public.supplier_branches
    where id = v_supplier_branch_id
      and supplier_id = (p_payload->>'supplier_id')::uuid
      and is_active
  ) then
    raise exception 'Branch does not belong to this supplier' using errcode = '22023';
  end if;

  -- Serialise concurrent orders drawing on the same request lines: lock them
  -- in a fixed order so two POs can never both see the same remaining
  -- quantity (and never deadlock on each other).
  perform public._po_alloc_lock(public._po_payload_pri_ids(v_items));

  insert into public.purchase_orders (
    po_no, supplier_id, company_id, project_id, plot_id, plot_group_id, purchase_request_id,
    order_date, expected_delivery_date, delivery_address, vat_percent, vat_type, payment_terms,
    discount_type, discount_value, discount_amount,
    subtotal, vat_amount, total_amount,
    note, created_by, status, confirmed_at, supplier_branch_id,
    is_outside_boq, outside_boq_reason
  ) values (
    v_po_no,
    (p_payload->>'supplier_id')::uuid,
    (p_payload->>'company_id')::uuid,
    (p_payload->>'project_id')::uuid,
    v_plot_id,
    v_plot_group_id,
    v_pr_id,
    v_order_date,
    nullif(p_payload->>'expected_delivery_date', '')::date,
    nullif(p_payload->>'delivery_address', ''),
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
    case when v_status = 'sent' then now() else null end,
    v_supplier_branch_id,
    v_is_outside_boq,
    v_outside_boq_reason
  )
  returning id into v_po_id;

  for v_item in
    select t.i, t.ord from jsonb_array_elements(v_items) with ordinality as t(i, ord) order by t.ord
  loop
    continue when coalesce((v_item.i->>'quantity_ordered')::numeric, 0) <= 0;

    insert into public.purchase_order_items (
      purchase_order_id, material_type_id, purchase_request_item_id, quantity_ordered, unit, closes_request_line,
      unit_price, description, discount_type, discount_value, discount_amount,
      project_id, plot_id, plot_group_id, intended_destination
    )
    select
      v_po_id,
      (i->>'material_type_id')::bigint,
      null,
      (i->>'quantity_ordered')::numeric,
      nullif(i->>'unit', ''),
      coalesce((i->>'closes_request_line')::boolean, false),
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
      end,
      coalesce(item_plot.project_id, item_group.project_id, public._jsonb_to_uuid(i->'project_id')),
      item_plot.id,
      item_group.id,
      nullif(i->>'intended_destination', '')
      from (select v_item.i as i) i
    left join public.plots item_plot on item_plot.id = public._jsonb_to_uuid(i->'plot_id')
    left join public.plot_groups item_group on item_group.id = public._jsonb_to_uuid(i->'plot_group_id')
    returning id into v_poi_id;

    v_alloc_json := public._po_item_alloc_json(v_item.i);
    if public._po_item_is_explicit(v_item.i) then
      v_strict_pris := v_strict_pris || public._po_alloc_json_pri_ids(v_alloc_json);
    end if;
    perform public._po_item_set_allocations(
      v_po_id, v_poi_id, v_alloc_json, public._po_item_is_explicit(v_item.i), v_project_id, '[]'::jsonb
    );
  end loop;

  insert into public.purchase_order_plots (purchase_order_id, plot_id)
  select v_po_id, elem::uuid
  from jsonb_array_elements_text(coalesce(p_payload->'plot_ids', '[]'::jsonb)) as elem
  where elem <> '';

  -- Allocation tail: validate every explicit allocation against the
  -- (now-restored) outstanding quantity, consume it, then recompute each PR
  -- this order touches - old and new, so a removed or moved allocation
  -- reopens its previous request too.
  perform public._po_alloc_validate(v_po_id, v_strict_pris);
  perform public._po_alloc_apply_qty(v_po_id, -1);

  -- Material substitution sync - see 202609150003_pr_material_substitution.sql.
  update public.purchase_request_items pri
  set material_type_id = poi.material_type_id
  from public.purchase_order_item_allocations a
  join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
  where poi.purchase_order_id = v_po_id
    and a.purchase_request_item_id = pri.id
    and pri.material_type_id <> poi.material_type_id;

  v_new_pr_ids := public._po_alloc_pr_ids(v_po_id);
  foreach v_pr in array (select coalesce(array_agg(distinct x), '{}') from unnest(v_old_pr_ids || v_new_pr_ids) x)
  loop
    perform public._pr_recompute_status(v_pr);
  end loop;

  -- M-14/W-01: tell each requester whose request this order draws on that it
  -- is on its way (one notification per request, however many lines).
  foreach v_pr in array v_new_pr_ids
  loop
    select requested_by into v_pr_requested_by from public.purchase_requests where id = v_pr;
    if v_pr_requested_by is not null then
      insert into public.notifications (recipient_id, purchase_request_id, type)
      values (v_pr_requested_by, v_pr, 'pr_ordered');
    end if;
  end loop;

  return jsonb_build_object('id', v_po_id, 'po_no', v_po_no);
end;
$function$;

revoke all on function public.po_create(jsonb) from public;
revoke all on function public.po_create(jsonb) from anon;
grant execute on function public.po_create(jsonb) to authenticated;
grant execute on function public.po_create(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- po_update: restated from 202609220003. Old allocations are reversed, the
-- payload's lines and allocations saved, and every request touched (old and
-- new) recomputed.
-- ---------------------------------------------------------------------------
create or replace function public.po_update(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_supplier_branch_id uuid := public._jsonb_to_uuid(p_payload->'supplier_branch_id');
  v_role text := public._billing_current_role();
  v_status text;
  v_po_no text;
  v_pr_id uuid;
  v_plot_ids_count int := jsonb_array_length(coalesce(p_payload->'plot_ids', '[]'::jsonb));
  v_plot_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_id') end;
  v_plot_group_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_group_id') end;
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
  v_line record;
  v_items jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  v_item record;
  v_poi_id uuid;
  v_alloc_json jsonb;
  v_strict_pris uuid[] := '{}';
  v_old_pr_ids uuid[] := '{}';
  v_new_pr_ids uuid[];
  v_prior_pairs jsonb;
  v_pr uuid;
  v_project_id uuid := (p_payload->>'project_id')::uuid;
  v_incoming_qty numeric;
  v_all_received boolean;
  v_any_received boolean;
  v_is_outside_boq boolean := coalesce((p_payload->>'is_outside_boq')::boolean, false);
  v_outside_boq_reason text := nullif(trim(both from coalesce(p_payload->>'outside_boq_reason', '')), '');
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can edit a purchase order' using errcode = '42501';
  end if;
  if v_plot_id is not null and v_plot_group_id is not null then
    raise exception 'Choose either a single plot or a plot group, not both' using errcode = '22023';
  end if;
  if v_is_outside_boq and v_outside_boq_reason is null then
    raise exception 'A reason is required when marking a purchase order outside BOQ' using errcode = '22023';
  end if;
  if not v_is_outside_boq and v_plot_id is null and v_plot_group_id is null and v_plot_ids_count = 0 then
    raise exception 'A purchase order needs a plot, plot group, or plot selection - mark it outside BOQ if none applies' using errcode = '22023';
  end if;

  -- Per-line scope override validation - same rule as po_create.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    where public._jsonb_to_uuid(i->'plot_id') is not null
      and public._jsonb_to_uuid(i->'plot_group_id') is not null
  ) then
    raise exception 'An order line cannot be scoped to both a plot and a plot group' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    where public._jsonb_to_uuid(i->'plot_id') is not null
      and not exists (select 1 from public.plots p where p.id = public._jsonb_to_uuid(i->'plot_id'))
  ) then
    raise exception 'One of the order lines references a plot that does not exist' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    where public._jsonb_to_uuid(i->'plot_group_id') is not null
      and not exists (select 1 from public.plot_groups g where g.id = public._jsonb_to_uuid(i->'plot_group_id'))
  ) then
    raise exception 'One of the order lines references a plot group that does not exist' using errcode = '22023';
  end if;

  select status, po_no, purchase_request_id into v_status, v_po_no, v_pr_id from public.purchase_orders where id = p_id;
  if v_status is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if v_status not in ('draft', 'sent', 'partially_received', 'received') then
    raise exception 'Cannot edit a purchase order that has already been paid or cancelled' using errcode = '42501';
  end if;

  for v_line in
    select id, quantity_received
    from public.purchase_order_items
    where purchase_order_id = p_id and quantity_received > 0
  loop
    select (i->>'quantity_ordered')::numeric into v_incoming_qty
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
    where public._jsonb_to_uuid(i->'id') = v_line.id;

    if v_incoming_qty is null then
      raise exception 'Cannot remove a line that already has goods received - reduce its quantity instead' using errcode = '42501';
    end if;
    if v_incoming_qty < v_line.quantity_received then
      raise exception 'Cannot set ordered quantity below the quantity already received' using errcode = '42501';
    end if;
  end loop;

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

  -- A branch is only meaningful for the supplier it belongs to; accepting a
  -- mismatched one would put the wrong branch on the tax invoice.
  if v_supplier_branch_id is not null and not exists (
    select 1 from public.supplier_branches
    where id = v_supplier_branch_id
      and supplier_id = (p_payload->>'supplier_id')::uuid
      and is_active
  ) then
    raise exception 'Branch does not belong to this supplier' using errcode = '22023';
  end if;

  update public.purchase_orders set
    supplier_id = (p_payload->>'supplier_id')::uuid,
    company_id = (p_payload->>'company_id')::uuid,
    project_id = (p_payload->>'project_id')::uuid,
    plot_id = v_plot_id,
    plot_group_id = v_plot_group_id,
    order_date = coalesce(nullif(p_payload->>'order_date', '')::date, order_date),
    expected_delivery_date = nullif(p_payload->>'expected_delivery_date', '')::date,
    delivery_address = nullif(p_payload->>'delivery_address', ''),
    vat_percent = v_vat_percent,
    vat_type = v_vat_type,
    payment_terms = p_payload->>'payment_terms',
    discount_type = v_po_discount_type,
    discount_value = v_po_discount_value,
    discount_amount = v_combined_discount,
    subtotal = v_subtotal,
    vat_amount = v_vat_amount,
    total_amount = v_total,
    note = p_payload->>'note',
    supplier_branch_id = v_supplier_branch_id,
    is_outside_boq = v_is_outside_boq,
    outside_boq_reason = v_outside_boq_reason
  where id = p_id;

  -- Lock every request line this edit touches (old allocations and new ones)
  -- in a fixed order, remember what the order was linked to, then give back
  -- what its current allocations consumed. The re-consume pass at the end
  -- takes it again against the edited allocations, so a removed or moved
  -- allocation reopens its old request line.
  perform public._po_alloc_lock(public._po_payload_pri_ids(v_items) || public._po_alloc_pri_ids(p_id));

  v_old_pr_ids := public._po_alloc_pr_ids(p_id);
  select coalesce(jsonb_agg(jsonb_build_object('poi', a.purchase_order_item_id, 'pri', a.purchase_request_item_id)), '[]'::jsonb)
  into v_prior_pairs
  from public.purchase_order_item_allocations a
  join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
  where poi.purchase_order_id = p_id;

  perform public._po_alloc_apply_qty(p_id, 1);

  -- Existing unreceived lines dropped from the payload: safe to delete
  -- outright (nothing references them).
  delete from public.purchase_order_items
  where purchase_order_id = p_id
    and quantity_received = 0
    and id not in (
      select public._jsonb_to_uuid(i->'id')
      from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
      where public._jsonb_to_uuid(i->'id') is not null
    );

  -- Lines present in the payload: update an existing row in place (so its id -
  -- and therefore quantity_received and any goods_receipt_items FK pointing
  -- at it - survives untouched) or insert a brand-new one, then rewrite that
  -- line's allocations from the payload.
  for v_item in
    select t.i, t.ord from jsonb_array_elements(v_items) with ordinality as t(i, ord) order by t.ord
  loop
    v_poi_id := null;
    if public._jsonb_to_uuid(v_item.i->'id') is not null then
      update public.purchase_order_items poi set
        material_type_id = (i->>'material_type_id')::bigint,
        purchase_request_item_id = null,
        quantity_ordered = (i->>'quantity_ordered')::numeric,
        unit = nullif(i->>'unit', ''),
        closes_request_line = coalesce((i->>'closes_request_line')::boolean, false),
        unit_price = coalesce((i->>'unit_price')::numeric, 0),
        description = nullif(i->>'description', ''),
        discount_type = coalesce(nullif(i->>'discount_type', ''), 'none'),
        discount_value = coalesce((i->>'discount_value')::numeric, 0),
        discount_amount = case coalesce(nullif(i->>'discount_type', ''), 'none')
          when 'percent' then round(
            (i->>'quantity_ordered')::numeric * coalesce((i->>'unit_price')::numeric, 0)
              * least(greatest(coalesce((i->>'discount_value')::numeric, 0), 0), 100) / 100, 2)
          when 'amount' then least(
            greatest(coalesce((i->>'discount_value')::numeric, 0), 0),
            (i->>'quantity_ordered')::numeric * coalesce((i->>'unit_price')::numeric, 0))
          else 0
        end,
        project_id = coalesce(item_plot.project_id, item_group.project_id, public._jsonb_to_uuid(i->'project_id')),
        plot_id = item_plot.id,
        plot_group_id = item_group.id,
        intended_destination = nullif(i->>'intended_destination', '')
        from (select v_item.i as i) i
      left join public.plots item_plot on item_plot.id = public._jsonb_to_uuid(i->'plot_id')
      left join public.plot_groups item_group on item_group.id = public._jsonb_to_uuid(i->'plot_group_id')
      where poi.purchase_order_id = p_id
        and public._jsonb_to_uuid(i->'id') = poi.id
      returning poi.id into v_poi_id;

    elsif coalesce((v_item.i->>'quantity_ordered')::numeric, 0) > 0 then
      insert into public.purchase_order_items (
        purchase_order_id, material_type_id, purchase_request_item_id, quantity_ordered, unit, closes_request_line,
        unit_price, description, discount_type, discount_value, discount_amount,
        project_id, plot_id, plot_group_id, intended_destination
      )
      select
        p_id,
        (i->>'material_type_id')::bigint,
        null,
        (i->>'quantity_ordered')::numeric,
        nullif(i->>'unit', ''),
        coalesce((i->>'closes_request_line')::boolean, false),
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
        end,
        coalesce(item_plot.project_id, item_group.project_id, public._jsonb_to_uuid(i->'project_id')),
        item_plot.id,
        item_group.id,
        nullif(i->>'intended_destination', '')
        from (select v_item.i as i) i
      left join public.plots item_plot on item_plot.id = public._jsonb_to_uuid(i->'plot_id')
      left join public.plot_groups item_group on item_group.id = public._jsonb_to_uuid(i->'plot_group_id')
      returning id into v_poi_id;

    end if;

    continue when v_poi_id is null;

    v_alloc_json := public._po_item_alloc_json(v_item.i);
    if public._po_item_is_explicit(v_item.i) then
      v_strict_pris := v_strict_pris || public._po_alloc_json_pri_ids(v_alloc_json);
    end if;
    perform public._po_item_set_allocations(
      p_id, v_poi_id, v_alloc_json, public._po_item_is_explicit(v_item.i), v_project_id, v_prior_pairs
    );
  end loop;

  delete from public.purchase_order_plots where purchase_order_id = p_id;

  insert into public.purchase_order_plots (purchase_order_id, plot_id)
  select p_id, elem::uuid
  from jsonb_array_elements_text(coalesce(p_payload->'plot_ids', '[]'::jsonb)) as elem
  where elem <> '';

  -- Allocation tail: validate every explicit allocation against the
  -- (now-restored) outstanding quantity, consume it, then recompute each PR
  -- this order touches - old and new, so a removed or moved allocation
  -- reopens its previous request too.
  perform public._po_alloc_validate(p_id, v_strict_pris);
  perform public._po_alloc_apply_qty(p_id, -1);

  -- Material substitution sync - see 202609150003_pr_material_substitution.sql.
  update public.purchase_request_items pri
  set material_type_id = poi.material_type_id
  from public.purchase_order_item_allocations a
  join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
  where poi.purchase_order_id = p_id
    and a.purchase_request_item_id = pri.id
    and pri.material_type_id <> poi.material_type_id;

  v_new_pr_ids := public._po_alloc_pr_ids(p_id);
  foreach v_pr in array (select coalesce(array_agg(distinct x), '{}') from unnest(v_old_pr_ids || v_new_pr_ids) x)
  loop
    perform public._pr_recompute_status(v_pr);
  end loop;

  select
    bool_and(quantity_received >= quantity_ordered),
    bool_or(quantity_received > 0)
  into v_all_received, v_any_received
  from public.purchase_order_items
  where purchase_order_id = p_id;

  update public.purchase_orders set
    status = case
      when v_all_received then 'received'
      when v_any_received then 'partially_received'
      else status
    end,
    received_at = case when v_all_received and status <> 'received' then current_date else received_at end,
    received_by = case when v_all_received and status <> 'received' then v_uid else received_by end
  where id = p_id;

  return jsonb_build_object('id', p_id, 'po_no', v_po_no);
end;
$$;

revoke all on function public.po_update(uuid, jsonb) from public;
revoke all on function public.po_update(uuid, jsonb) from anon;
grant execute on function public.po_update(uuid, jsonb) to authenticated;
grant execute on function public.po_update(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- goods_receipt_create: restated from 202609230010; request closing and the
-- 'received' notification now cover every request an order is allocated to.
-- ---------------------------------------------------------------------------
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
  v_pr_requested_by uuid;
  v_alloc_pr uuid;
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
  -- 202609220001). M-14/W-01: notify the requester exactly when this
  -- actually flips the request to 'received' (the where clause's own
  -- status <> 'received' keeps a second, unrelated PO against the same
  -- request from re-notifying).
  -- Every request this order is linked to - through its allocations, plus
  -- the legacy header link - is checked on its own. A request only closes
  -- once it is fully ordered (status 'ordered', not still 'approved' with
  -- quantity waiting for a later PO) and every order linked to it is fully
  -- received.
  if v_new_po_status = 'received' then
    foreach v_alloc_pr in array public._po_alloc_pr_ids(v_po_id)
    loop
      v_pr_requested_by := null;
      update public.purchase_requests pr
      set status = 'received'
      where pr.id = v_alloc_pr
        and pr.status = 'ordered'
        and not exists (
          select 1 from public.purchase_orders po2
          where po2.status not in ('cancelled', 'received', 'paid')
            and public._po_linked_to_pr(po2.id, v_alloc_pr)
        )
      returning pr.requested_by into v_pr_requested_by;

      if v_pr_requested_by is not null then
        insert into public.notifications (recipient_id, purchase_request_id, type)
        values (v_pr_requested_by, v_alloc_pr, 'pr_received');
      end if;
    end loop;
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

grant execute on function public.goods_receipt_create(jsonb) to authenticated;
grant execute on function public.goods_receipt_create(jsonb) to service_role;

-- po_unmark_received: restated from 202609230003.
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
  v_alloc_pr uuid;
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

  -- Every request this order is linked to goes back from 'received' to
  -- 'ordered' - not just the legacy header one.
  foreach v_alloc_pr in array public._po_alloc_pr_ids(p_id)
  loop
    update public.purchase_requests set status = 'ordered' where id = v_alloc_pr and status = 'received';
  end loop;

  return jsonb_build_object('id', p_id, 'status', 'sent');
end;
$$;

revoke all on function public.po_unmark_received(uuid) from public;
revoke all on function public.po_unmark_received(uuid) from anon;
grant execute on function public.po_unmark_received(uuid) to authenticated;
grant execute on function public.po_unmark_received(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- po_cancel: restated from 202609230006. Gives every allocation's quantity
-- back to its request line and recomputes every request the order touched.
-- The allocation rows are kept on the cancelled order for traceability; a
-- second cancel no longer hands the quantity back twice.
-- ---------------------------------------------------------------------------
create or replace function public.po_cancel(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

-- ---------------------------------------------------------------------------
-- po_delete: restated from 202609170003. Same give-back across all
-- allocations (skipped for an already-cancelled order, whose quantity went
-- back when it was cancelled), then every request it touched is recomputed
-- once its rows - allocations cascade with the lines - are gone.
-- ---------------------------------------------------------------------------
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
  v_has_receipts boolean;
  v_pr_ids uuid[];
  v_pr uuid;
begin
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can delete a purchase order' using errcode = '42501';
  end if;

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

revoke all on function public.po_delete(uuid) from public;
revoke all on function public.po_delete(uuid) from anon;
grant execute on function public.po_delete(uuid) to authenticated;
grant execute on function public.po_delete(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- po_close_short: restated from 202609230008. The un-ordered remainder of
-- each short line is taken off its allocations proportionally (the last
-- allocation absorbs rounding so they still sum to the received quantity) and
-- given back to the matching request lines; allocations that shrink to zero
-- are removed. Every touched request is recomputed.
-- ---------------------------------------------------------------------------
create or replace function public.po_close_short(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_status text;
  v_po_discount_type text;
  v_po_discount_value numeric;
  v_vat_percent numeric;
  v_vat_type text;
  v_subtotal numeric;
  v_line_discount_total numeric;
  v_after_line_discounts numeric;
  v_po_discount_amount numeric;
  v_net_of_discounts numeric;
  v_taxable numeric;
  v_vat_amount numeric;
  v_total numeric;
  v_trimmed_reason text := nullif(trim(both from coalesce(p_reason, '')), '');
  v_pr_ids uuid[];
  v_pr uuid;
  v_line record;
  v_alloc record;
  v_target numeric;
  v_assigned numeric;
  v_new_qty numeric;
  v_n int;
  v_i int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm','admin') then
    raise exception 'Only PM/Admin can close a purchase order' using errcode = '42501';
  end if;
  if v_trimmed_reason is null then
    raise exception 'A reason is required to close a purchase order short' using errcode = '22023';
  end if;

  select status, discount_type, discount_value, vat_percent, vat_type
  into v_status, v_po_discount_type, v_po_discount_value, v_vat_percent, v_vat_type
  from public.purchase_orders where id = p_id;

  if v_status is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if v_status <> 'partially_received' then
    raise exception 'Can only close short a partially received purchase order' using errcode = '42501';
  end if;

  v_pr_ids := public._po_alloc_pr_ids(p_id);
  perform public._po_alloc_lock(public._po_alloc_pri_ids(p_id));

  -- Shrink each short line's allocations and give the difference back to its
  -- request lines (same-unit lines only, as everywhere else), before the
  -- lines themselves shrink.
  for v_line in
    select poi.id, poi.quantity_ordered, poi.quantity_received, coalesce(poi.unit, mt.unit) as unit
    from public.purchase_order_items poi
    join public.material_types mt on mt.id = poi.material_type_id
    where poi.purchase_order_id = p_id
      and poi.quantity_ordered > poi.quantity_received
      and exists (select 1 from public.purchase_order_item_allocations a where a.purchase_order_item_id = poi.id)
  loop
    select sum(a.quantity_allocated), count(*) into v_target, v_n
    from public.purchase_order_item_allocations a where a.purchase_order_item_id = v_line.id;
    v_target := round(v_target * v_line.quantity_received / v_line.quantity_ordered, 4);
    v_assigned := 0;
    v_i := 0;

    for v_alloc in
      select a.id, a.purchase_request_item_id as pri_id, a.quantity_allocated,
             coalesce(pri.unit, mt2.unit) as pri_unit
      from public.purchase_order_item_allocations a
      join public.purchase_request_items pri on pri.id = a.purchase_request_item_id
      join public.material_types mt2 on mt2.id = pri.material_type_id
      where a.purchase_order_item_id = v_line.id
      order by a.created_at, a.id
    loop
      v_i := v_i + 1;
      if v_i = v_n then
        v_new_qty := greatest(0, v_target - v_assigned);
      else
        v_new_qty := least(
          round(v_alloc.quantity_allocated * v_line.quantity_received / v_line.quantity_ordered, 4),
          v_alloc.quantity_allocated
        );
      end if;
      v_assigned := v_assigned + v_new_qty;

      if v_alloc.pri_unit is not distinct from v_line.unit and v_alloc.quantity_allocated > v_new_qty then
        update public.purchase_request_items
        set quantity_requested = quantity_requested + (v_alloc.quantity_allocated - v_new_qty)
        where id = v_alloc.pri_id;
      end if;

      if v_new_qty > 0 then
        update public.purchase_order_item_allocations
        set quantity_allocated = v_new_qty, updated_at = now()
        where id = v_alloc.id;
      else
        delete from public.purchase_order_item_allocations where id = v_alloc.id;
      end if;
    end loop;

    -- Keep the legacy link in step with what is left.
    update public.purchase_order_items poi
    set purchase_request_item_id = (
      select case when count(*) = 1 then min(a.purchase_request_item_id::text)::uuid else null end
      from public.purchase_order_item_allocations a where a.purchase_order_item_id = poi.id
    )
    where poi.id = v_line.id;
  end loop;

  -- Shrink every short line's ordered quantity down to what arrived, and
  -- recompute its own discount_amount for the new quantity (same formula
  -- po_create/po_update use). closes_request_line is cleared too - it means
  -- "this order line satisfies its request line in full," which is no longer
  -- true once part of it was cancelled.
  update public.purchase_order_items
  set quantity_ordered = quantity_received,
      closes_request_line = false,
      discount_amount = case discount_type
        when 'percent' then round(quantity_received * unit_price * least(greatest(discount_value, 0), 100) / 100, 2)
        when 'amount' then least(greatest(discount_value, 0), quantity_received * unit_price)
        else 0
      end
  where purchase_order_id = p_id
    and quantity_ordered > quantity_received;

  select
    coalesce(sum(quantity_ordered * unit_price), 0),
    coalesce(sum(discount_amount), 0)
  into v_subtotal, v_line_discount_total
  from public.purchase_order_items
  where purchase_order_id = p_id;

  v_after_line_discounts := v_subtotal - v_line_discount_total;

  v_po_discount_amount := case
    when v_po_discount_type = 'percent' then round(v_after_line_discounts * least(greatest(coalesce(v_po_discount_value, 0), 0), 100) / 100, 2)
    when v_po_discount_type = 'amount' then least(greatest(coalesce(v_po_discount_value, 0), 0), v_after_line_discounts)
    else 0
  end;

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

  update public.purchase_orders
  set status = 'received',
      discount_amount = v_line_discount_total + v_po_discount_amount,
      subtotal = v_subtotal,
      vat_amount = v_vat_amount,
      total_amount = v_total,
      note = coalesce(note || E'\n', '') || 'ปิดใบสั่งซื้อ (ส่งไม่ครบ): ' || v_trimmed_reason,
      received_at = coalesce(received_at, current_date),
      received_by = coalesce(received_by, v_uid)
  where id = p_id;

  foreach v_pr in array v_pr_ids
  loop
    perform public._pr_recompute_status(v_pr);
  end loop;

  return jsonb_build_object('id', p_id, 'status', 'received');
end;
$function$;

revoke execute on function public.po_close_short(uuid, text) from anon, public;
grant execute on function public.po_close_short(uuid, text) to authenticated;
