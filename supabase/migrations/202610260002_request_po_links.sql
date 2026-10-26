-- Link a purchase request line to a real purchase order line, from either side.
--
-- Until now the only way to say "this request line was bought on that PO" after
-- the fact was to close the line by hand and type a PO number (a free-text
-- po_ref on purchase_request_item_settlements). Nothing was connected: the
-- request could not tell whether the PO had arrived. The real link already
-- exists when a PO is created from a request (purchase_order_item_allocations);
-- this adds the same thing as an action on the request page and on the PO.
--
-- A link is its own row, not a flag on the allocation, because saving a PO
-- rewrites that order line's allocations (_po_item_set_allocations deletes and
-- re-inserts them from the form), which would silently drop a flag.
--
--   * purchase_request_po_links: one row per (PO line, request line) pair.
--   * _pri_line_state also counts a link on a live PO: ordered, or arrived once
--     the PO is received/paid. The request's status follows through the
--     existing triggers (_pri_resync_material -> _pr_recompute_status).
--   * pr_link_to_po / pr_unlink_po: PM and admin, the same people who close
--     lines today.
--   * Old typed closures are linked automatically where the PO number points
--     at a PO holding the same material (see section 6). Lines whose PO holds
--     a similar but different item are left for purchasing to confirm in the
--     app.
--
-- No DROP and no DELETE of existing rows. Safe to run twice. Builds on
-- 202610260001 (_pri_line_state with unit conversion): this migration restates
-- that function with the link branch added, so it must run after it.

-- ---------------------------------------------------------------------------
-- 1. The link table
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_request_po_links (
  id uuid primary key default gen_random_uuid(),
  purchase_order_item_id uuid not null references public.purchase_order_items(id) on delete cascade,
  purchase_request_item_id uuid not null references public.purchase_request_items(id) on delete cascade,
  -- Whether pr_link_to_po had to add an allocation for this pair (so the PO
  -- line shows which request it answered, and the BOQ rollup attributes it).
  -- Unlinking removes that allocation again, and only that one.
  allocation_added boolean not null default false,
  -- 'manual' = linked on the request or PO page, 'backfill' = from an old typed
  -- PO number.
  source text not null default 'manual' check (source in ('manual', 'backfill')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint purchase_request_po_links_unique_pair unique (purchase_order_item_id, purchase_request_item_id)
);

create index if not exists purchase_request_po_links_pri_idx
  on public.purchase_request_po_links (purchase_request_item_id);

alter table public.purchase_request_po_links enable row level security;
drop policy if exists purchase_request_po_links_select on public.purchase_request_po_links;
create policy purchase_request_po_links_select on public.purchase_request_po_links
  for select to authenticated using (true);
revoke all on public.purchase_request_po_links from anon;
revoke insert, update, delete on public.purchase_request_po_links from authenticated;
grant select on public.purchase_request_po_links to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Line state: a link on a live PO counts like the "this order covers it" tick
-- ---------------------------------------------------------------------------
create or replace function public._pri_line_state(p_pri_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.purchase_order_item_allocations a
      join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
      join public.purchase_orders po on po.id = poi.purchase_order_id
      where a.purchase_request_item_id = p_pri_id
        and poi.closes_request_line
        and po.status in ('received', 'paid')
    ) or exists (
      select 1
      from public.purchase_request_po_links l
      join public.purchase_order_items poi on poi.id = l.purchase_order_item_id
      join public.purchase_orders po on po.id = poi.purchase_order_id
      where l.purchase_request_item_id = p_pri_id
        and po.status in ('received', 'paid')
    ) then 'arrived'
    when exists (
      select 1
      from public.purchase_order_item_allocations a
      join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
      join public.purchase_orders po on po.id = poi.purchase_order_id
      where a.purchase_request_item_id = p_pri_id
        and poi.closes_request_line
        and po.status <> 'cancelled'
    ) or exists (
      select 1
      from public.purchase_request_po_links l
      join public.purchase_order_items poi on poi.id = l.purchase_order_item_id
      join public.purchase_orders po on po.id = poi.purchase_order_id
      where l.purchase_request_item_id = p_pri_id
        and po.status <> 'cancelled'
    ) then 'ordered'
    when exists (select 1 from public.purchase_order_item_allocations a2 where a2.purchase_request_item_id = p_pri_id)
      and (
        select coalesce(sum(a.quantity_allocated / public.unit_factor(pri.material_type_id, poi.unit))
                        filter (where public.unit_factor(pri.material_type_id, poi.unit) is not null), 0)
        from public.purchase_order_item_allocations a
        join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
        join public.purchase_orders po on po.id = poi.purchase_order_id
        join public.purchase_request_items pri on pri.id = a.purchase_request_item_id
        where a.purchase_request_item_id = p_pri_id
          and po.status <> 'cancelled'
      ) >= (
        select pri.quantity_requested / public.unit_factor(pri.material_type_id, pri.unit)
        from public.purchase_request_items pri
        where pri.id = p_pri_id
          and public.unit_factor(pri.material_type_id, pri.unit) is not null
      )
    then 'ordered'
    when exists (
      select 1 from public.purchase_request_item_settlements s where s.purchase_request_item_id = p_pri_id
    ) then 'closed'
    else 'open'
  end;
$$;

-- A link coming or going moves its request line.
create or replace function public._link_resync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public._pri_resync_material(old.purchase_request_item_id);
  else
    perform public._pri_resync_material(new.purchase_request_item_id);
  end if;
  return null;
end;
$$;

create or replace trigger purchase_request_po_links_resync
  after insert or delete on public.purchase_request_po_links
  for each row execute function public._link_resync_trigger();

-- A PO changing status (cancelled, received, ...) moves every request line it
-- answers, by allocation or by link.
create or replace function public._po_status_resync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pri uuid;
begin
  for v_pri in
    select a.purchase_request_item_id
    from public.purchase_order_item_allocations a
    join public.purchase_order_items poi on poi.id = a.purchase_order_item_id
    where poi.purchase_order_id = new.id
    union
    select l.purchase_request_item_id
    from public.purchase_request_po_links l
    join public.purchase_order_items poi on poi.id = l.purchase_order_item_id
    where poi.purchase_order_id = new.id
  loop
    perform public._pri_resync_material(v_pri);
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Link
--    payload: { links: [ { purchase_request_item_id, purchase_order_item_id } ] }
-- ---------------------------------------------------------------------------
create or replace function public.pr_link_to_po(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_l record;
  v_pr_status text;
  v_pr_project uuid;
  v_pri_unit text;
  v_pri_qty numeric;
  v_poi_qty numeric;
  v_poi_unit text;
  v_po_project uuid;
  v_po_status text;
  v_room numeric;
  v_alloc numeric;
  v_added boolean;
  v_count int := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm', 'admin') then
    raise exception 'Only PM/Admin can link a purchase request line to an order' using errcode = '42501';
  end if;
  -- Tag the document history entries this call causes.
  perform set_config('app.doc_action', 'link_request_po', true);

  for v_l in
    select public._jsonb_to_uuid(e->'purchase_request_item_id') as pri_id,
           public._jsonb_to_uuid(e->'purchase_order_item_id') as poi_id
    from jsonb_array_elements(coalesce(p_payload->'links', '[]'::jsonb)) e
  loop
    if v_l.pri_id is null or v_l.poi_id is null then
      raise exception 'A link needs a request line and an order line' using errcode = '22023';
    end if;

    select pr.status, pr.project_id, coalesce(nullif(btrim(pri.unit), ''), btrim(mt.unit)), pri.quantity_requested
    into v_pr_status, v_pr_project, v_pri_unit, v_pri_qty
    from public.purchase_request_items pri
    join public.purchase_requests pr on pr.id = pri.purchase_request_id
    join public.material_types mt on mt.id = pri.material_type_id
    where pri.id = v_l.pri_id;
    if not found then
      raise exception 'Purchase request line not found' using errcode = 'P0002';
    end if;
    if v_pr_status not in ('approved', 'ordered') then
      raise exception 'Only an approved request can be linked to an order' using errcode = '42501';
    end if;

    select po.project_id, po.status, poi.quantity_ordered, coalesce(nullif(btrim(poi.unit), ''), btrim(mt.unit))
    into v_po_project, v_po_status, v_poi_qty, v_poi_unit
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
    join public.material_types mt on mt.id = poi.material_type_id
    where poi.id = v_l.poi_id;
    if not found then
      raise exception 'Purchase order line not found' using errcode = 'P0002';
    end if;
    if v_po_status = 'cancelled' then
      raise exception 'A cancelled order cannot be linked' using errcode = '22023';
    end if;
    if v_po_project is distinct from v_pr_project then
      raise exception 'The order belongs to a different project than the request' using errcode = '22023';
    end if;

    -- Reuse an existing allocation for this pair; otherwise add one sized to
    -- what is left on the order line (so the order line is never over-
    -- allocated), capped at what the request asked when the units agree.
    if exists (
      select 1 from public.purchase_order_item_allocations
      where purchase_order_item_id = v_l.poi_id and purchase_request_item_id = v_l.pri_id
    ) then
      v_added := false;
    else
      select greatest(v_poi_qty - coalesce(sum(quantity_allocated), 0), 0) into v_room
      from public.purchase_order_item_allocations where purchase_order_item_id = v_l.poi_id;
      if v_room <= 0 then
        v_room := v_poi_qty;
      end if;
      v_alloc := case
        when v_pri_unit is not distinct from v_poi_unit and v_pri_qty > 0 then least(v_room, v_pri_qty)
        else v_room
      end;
      if v_alloc <= 0 then
        raise exception 'The order line has no quantity to link' using errcode = '22023';
      end if;
      insert into public.purchase_order_item_allocations (
        purchase_order_item_id, purchase_request_item_id, quantity_allocated, created_by
      ) values (v_l.poi_id, v_l.pri_id, v_alloc, v_uid);
      v_added := true;
    end if;

    insert into public.purchase_request_po_links (
      purchase_order_item_id, purchase_request_item_id, allocation_added, source, created_by
    ) values (v_l.poi_id, v_l.pri_id, v_added, 'manual', v_uid)
    on conflict (purchase_order_item_id, purchase_request_item_id) do nothing;

    perform public._pri_resync_material(v_l.pri_id);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'Select at least one line to link' using errcode = '22023';
  end if;
  return jsonb_build_object('linked', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Unlink
-- ---------------------------------------------------------------------------
create or replace function public.pr_unlink_po(p_link_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_poi uuid;
  v_pri uuid;
  v_added boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('pm', 'admin') then
    raise exception 'Only PM/Admin can remove a link between a request and an order' using errcode = '42501';
  end if;
  perform set_config('app.doc_action', 'unlink_request_po', true);

  select purchase_order_item_id, purchase_request_item_id, allocation_added
  into v_poi, v_pri, v_added
  from public.purchase_request_po_links where id = p_link_id;
  if not found then
    raise exception 'Link not found' using errcode = 'P0002';
  end if;

  delete from public.purchase_request_po_links where id = p_link_id;
  if v_added then
    delete from public.purchase_order_item_allocations
    where purchase_order_item_id = v_poi and purchase_request_item_id = v_pri;
  end if;
  perform public._pri_resync_material(v_pri);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.pr_link_to_po(jsonb) from public, anon;
revoke all on function public.pr_unlink_po(uuid) from public, anon;
grant execute on function public.pr_link_to_po(jsonb) to authenticated;
grant execute on function public.pr_unlink_po(uuid) to authenticated;
revoke all on function public._link_resync_trigger() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Old typed closures: where the PO number typed at closing points at a PO
--    in the same project holding the same material, make it a real link.
--    (Looked at live data 2026-10-26: 14 of 22.) Lines whose PO holds only a
--    similar item, or no PO number at all, are left as they are.
-- ---------------------------------------------------------------------------
insert into public.purchase_request_po_links (
  purchase_order_item_id, purchase_request_item_id, allocation_added, source, created_by
)
select distinct on (pri.id)
  poi.id, pri.id,
  not exists (
    select 1 from public.purchase_order_item_allocations a
    where a.purchase_order_item_id = poi.id and a.purchase_request_item_id = pri.id
  ),
  'backfill', s.settled_by
from public.purchase_request_item_settlements s
join public.purchase_request_items pri on pri.id = s.purchase_request_item_id
join public.purchase_requests pr on pr.id = pri.purchase_request_id
join public.purchase_orders po
  on po.po_no = btrim(s.po_ref) and po.project_id = pr.project_id and po.status <> 'cancelled'
join public.purchase_order_items poi
  on poi.purchase_order_id = po.id and poi.material_type_id = pri.material_type_id
where s.reason = 'ordered'
  and s.po_ref is not null
  and pri.line_status in ('closed', 'open')
order by pri.id, poi.id
on conflict (purchase_order_item_id, purchase_request_item_id) do nothing;

-- The allocations those links needed (sized like pr_link_to_po does).
insert into public.purchase_order_item_allocations (
  purchase_order_item_id, purchase_request_item_id, quantity_allocated, created_by
)
select l.purchase_order_item_id, l.purchase_request_item_id,
  case
    when coalesce(nullif(btrim(pri.unit), ''), btrim(mt_r.unit)) is not distinct from coalesce(nullif(btrim(poi.unit), ''), btrim(mt_p.unit))
      and pri.quantity_requested > 0
    then least(
      case when poi.quantity_ordered - coalesce(o.alloc, 0) > 0 then poi.quantity_ordered - coalesce(o.alloc, 0) else poi.quantity_ordered end,
      pri.quantity_requested
    )
    else case when poi.quantity_ordered - coalesce(o.alloc, 0) > 0 then poi.quantity_ordered - coalesce(o.alloc, 0) else poi.quantity_ordered end
  end,
  l.created_by
from public.purchase_request_po_links l
join public.purchase_request_items pri on pri.id = l.purchase_request_item_id
join public.material_types mt_r on mt_r.id = pri.material_type_id
join public.purchase_order_items poi on poi.id = l.purchase_order_item_id
join public.material_types mt_p on mt_p.id = poi.material_type_id
left join lateral (
  select sum(quantity_allocated) as alloc
  from public.purchase_order_item_allocations a where a.purchase_order_item_id = poi.id
) o on true
where l.source = 'backfill' and l.allocation_added
  and poi.quantity_ordered > 0
on conflict (purchase_order_item_id, purchase_request_item_id) do nothing;

-- Move the lines (this also recomputes each request's status).
select public._pri_resync_material(l.purchase_request_item_id)
from public.purchase_request_po_links l
where l.source = 'backfill';
