-- Purchase requests could be created, approved, or rejected, but never
-- edited - a typo or missed line meant rejecting and resubmitting from
-- scratch. Adds pr_update, restricted to pending_review only (once
-- approved/ordered, purchase_order_items may already reference this
-- request's items via purchase_request_item_id, so editing stops being
-- safe past that point - same reasoning as po_update's status guard).
-- Items/plots are a full delete-and-recreate rather than po_update's
-- update-in-place-by-id dance, since nothing can reference a pending
-- request's item rows yet (that link is only created once a PO is placed
-- from an *approved* request).
create or replace function public.pr_update(p_id uuid, p_payload jsonb)
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
  v_plot_ids_count int := jsonb_array_length(coalesce(p_payload->'plot_ids', '[]'::jsonb));
  v_plot_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_id') end;
  v_plot_group_id uuid := case when v_plot_ids_count > 0 then null else public._jsonb_to_uuid(p_payload->'plot_group_id') end;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('foreman','pm','admin') then
    raise exception 'No permission to edit this purchase request' using errcode = '42501';
  end if;
  if v_plot_id is not null and v_plot_group_id is not null then
    raise exception 'Choose either a single plot or a plot group, not both' using errcode = '22023';
  end if;

  select status, pr_no::text into v_status, v_pr_no from public.purchase_requests where id = p_id;
  if v_status is null then
    raise exception 'Purchase request not found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'Cannot edit a purchase request that has already been reviewed' using errcode = '42501';
  end if;

  update public.purchase_requests set
    project_id = (p_payload->>'project_id')::uuid,
    plot_id = v_plot_id,
    plot_group_id = v_plot_group_id,
    note = p_payload->>'note',
    needed_by_date = nullif(p_payload->>'needed_by_date', '')::date
  where id = p_id;

  delete from public.purchase_request_items where purchase_request_id = p_id;
  insert into public.purchase_request_items (purchase_request_id, material_type_id, quantity_requested, note)
  select
    p_id,
    (i->>'material_type_id')::bigint,
    (i->>'quantity_requested')::numeric,
    i->>'note'
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) i
  where coalesce((i->>'quantity_requested')::numeric, 0) > 0;

  delete from public.purchase_request_plots where purchase_request_id = p_id;
  insert into public.purchase_request_plots (purchase_request_id, plot_id)
  select p_id, elem::uuid
  from jsonb_array_elements_text(coalesce(p_payload->'plot_ids', '[]'::jsonb)) as elem
  where elem <> '';

  return jsonb_build_object('id', p_id, 'pr_no', v_pr_no);
end;
$$;

grant execute on function public.pr_update(uuid, jsonb) to authenticated;
