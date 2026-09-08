-- Purchase requests only ever supported a single plot_id, unlike purchase
-- orders which since 202609010003/202609020001 support three mutually
-- exclusive plot scopes: plot_id (one plot), plot_group_id (a saved
-- batch), or rows in a join table (an ad-hoc multi-select). Brings requests
-- to the same shape/UX so the create-request modal can offer the same
-- plot-scope picker as the PO form. pr_create is reproduced with only the
-- plot handling changed (mirrors purchase_order_plots exactly) - the
-- pr_pending_review notification insert is unchanged.

alter table public.purchase_requests
  add column if not exists plot_group_id uuid references public.plot_groups(id);

alter table public.purchase_requests drop constraint if exists purchase_requests_plot_xor_group;
alter table public.purchase_requests add constraint purchase_requests_plot_xor_group
  check (plot_id is null or plot_group_id is null);

create table if not exists public.purchase_request_plots (
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  plot_id uuid not null references public.plots(id) on delete cascade,
  primary key (purchase_request_id, plot_id)
);

alter table public.purchase_request_plots enable row level security;
drop policy if exists "purchase_request_plots_select" on public.purchase_request_plots;
create policy "purchase_request_plots_select" on public.purchase_request_plots for select to authenticated using (true);
grant select on public.purchase_request_plots to authenticated;

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

  insert into public.purchase_request_items (purchase_request_id, material_type_id, quantity_requested, note)
  select
    v_pr_id,
    (i->>'material_type_id')::bigint,
    (i->>'quantity_requested')::numeric,
    i->>'note'
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
