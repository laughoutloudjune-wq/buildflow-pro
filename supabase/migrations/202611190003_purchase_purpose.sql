-- "What is this material for": every purchase request line can say which job or
-- purpose it is for, and that text follows the line onto the purchase order.
--
--   * purchase_request_items.purpose : free text typed by the requester when no
--     BOQ job fits (the BOQ job itself is purchase_request_items.boq_id, which
--     already exists).
--   * purchase_order_items.purpose   : the PO line's own copy, kept in step with
--     the request lines it is allocated to (job name, or typed purpose; several
--     distinct values are joined with ", "). Once copied, the PO never needs
--     the request again.
--
-- The copy is made by a trigger on purchase_order_item_allocations, so
-- po_create / po_update are not touched: every PO line linked to a request
-- line has allocation rows, and saving a PO rewrites them, which refires the
-- trigger. Lines with no linked request keep purpose null.
--
-- Optional everywhere, never blocks anything. No DROP and no DELETE. Safe to
-- run twice. pr_update is restated in 202611190004 (it contains a delete, which
-- the Supabase connector asks to confirm).

alter table public.purchase_request_items add column if not exists purpose text;
alter table public.purchase_order_items add column if not exists purpose text;

create or replace function public._po_item_refresh_purpose(p_poi_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.purchase_order_items poi
  set purpose = (
    select string_agg(distinct coalesce(nullif(btrim(pri.purpose), ''), bm.item_name), ', ')
    from public.purchase_order_item_allocations a
    join public.purchase_request_items pri on pri.id = a.purchase_request_item_id
    left join public.boq_master bm on bm.id = pri.boq_id
    where a.purchase_order_item_id = poi.id
      and coalesce(nullif(btrim(pri.purpose), ''), bm.item_name) is not null
  )
  where poi.id = p_poi_id;
end;
$$;
revoke all on function public._po_item_refresh_purpose(uuid) from public, anon, authenticated;

create or replace function public._po_alloc_refresh_purpose()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public._po_item_refresh_purpose(old.purchase_order_item_id);
    return old;
  end if;
  perform public._po_item_refresh_purpose(new.purchase_order_item_id);
  return new;
end;
$$;
revoke all on function public._po_alloc_refresh_purpose() from public, anon, authenticated;

create or replace trigger po_alloc_refresh_purpose
  after insert or update of purchase_request_item_id or delete on public.purchase_order_item_allocations
  for each row execute function public._po_alloc_refresh_purpose();

-- Existing PO lines: fill from request lines that already have a BOQ job.
select public._po_item_refresh_purpose(a.purchase_order_item_id)
from (select distinct purchase_order_item_id from public.purchase_order_item_allocations) a;

-- pr_create: restated in full from its live definition, adding purpose.
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
  v_plot_ids_count int := jsonb_array_length(coalesce(p_payload->'plot_ids', '[]'::jsonb));
  v_plot_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_id') end;
  v_plot_group_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_group_id') end;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('foreman','pm','admin') then
    raise exception 'No permission to create purchase request' using errcode = '42501';
  end if;
  if v_plot_id is not null and v_plot_group_id is not null then
    raise exception 'Choose either a single plot or a plot group, not both' using errcode = '22023';
  end if;

  insert into public.purchase_requests (project_id, plot_id, plot_group_id, note, needed_by_date, requested_by, status)
  values (
    (p_payload->>'project_id')::uuid,
    v_plot_id,
    v_plot_group_id,
    p_payload->>'note',
    nullif(p_payload->>'needed_by_date', '')::date,
    v_uid,
    'pending_review'
  )
  returning id, pr_no::text into v_pr_id, v_pr_no;

  insert into public.purchase_request_items (purchase_request_id, material_type_id, quantity_requested, note, boq_id, unit, purpose)
  select
    v_pr_id,
    (i->>'material_type_id')::bigint,
    (i->>'quantity_requested')::numeric,
    i->>'note',
    public._jsonb_to_uuid(i->'boq_id'),
    nullif(i->>'unit', ''),
    nullif(btrim(i->>'purpose'), '')
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where coalesce((i->>'quantity_requested')::numeric, 0) > 0;

  insert into public.purchase_request_plots (purchase_request_id, plot_id)
  select v_pr_id, elem::uuid
  from jsonb_array_elements_text(coalesce(p_payload->'plot_ids', '[]'::jsonb)) as elem
  where elem <> '';

  insert into public.notifications (recipient_id, purchase_request_id, type)
  select p.id, v_pr_id, 'pr_pending_review'
  from public.profiles p
  where p.role in ('pm','admin');

  return jsonb_build_object('id', v_pr_id, 'pr_no', v_pr_no);
end;
$$;

revoke all on function public.pr_create(jsonb) from public;
revoke all on function public.pr_create(jsonb) from anon;
grant execute on function public.pr_create(jsonb) to authenticated;
