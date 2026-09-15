-- Purchase request items had no way to say *which BOQ job* a material was
-- actually for (only the material and a free-text note) - so tracing "why
-- did we ask for 50 bags of cement" meant reading the note, if anyone wrote
-- one. purchase_request_items.boq_id links a line to one boq_master row
-- (the same table boq_material_items already hangs off), the way a real
-- request would be reasoned about: "this is for เทคอนกรีตฐานราก".
--
-- Optional (many requests are still perfectly fine without it - office
-- supplies, common-area materials have no single job), so nullable with no
-- default. set null on delete: if the BOQ job itself is later removed, the
-- request line stays as a valid purchase record, just unlinked - it must
-- never disappear or block the job's deletion.
--
-- pr_create/pr_update are restated in full (Postgres has no partial
-- function replace) from their current definitions
-- (202609080003_pr_multi_plot.sql / 202609090002_pr_update.sql), adding
-- only boq_id to the item insert.

alter table public.purchase_request_items
  add column if not exists boq_id uuid references public.boq_master(id) on delete set null;

create index if not exists purchase_request_items_boq_id_idx
  on public.purchase_request_items (boq_id) where boq_id is not null;

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

  insert into public.purchase_request_items (purchase_request_id, material_type_id, quantity_requested, note, boq_id)
  select
    v_pr_id,
    (i->>'material_type_id')::bigint,
    (i->>'quantity_requested')::numeric,
    i->>'note',
    public._jsonb_to_uuid(i->'boq_id')
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

grant execute on function public.pr_create(jsonb) to authenticated;

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
  insert into public.purchase_request_items (purchase_request_id, material_type_id, quantity_requested, note, boq_id)
  select
    p_id,
    (i->>'material_type_id')::bigint,
    (i->>'quantity_requested')::numeric,
    i->>'note',
    public._jsonb_to_uuid(i->'boq_id')
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
