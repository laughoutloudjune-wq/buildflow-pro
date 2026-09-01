-- Not every material in the catalog gets discretely withdrawn to a
-- contractor - bulk consumables like อิฐมวลเบา (AAC block) or bagged cement
-- get used immediately on delivery, not warehoused for later request. For
-- these, the only thing worth tracking is how much has been received in
-- total; there's no "hand some out to a contractor" step to record.
--
-- is_requestable defaults to true (opt-out, not opt-in) - most of the
-- catalog genuinely is discretely trackable (fittings, hardware, fixtures),
-- and this only needs flipping off for the specific bulk-consumable
-- materials someone identifies. Receiving (goods_receipt_create) is
-- completely unaffected either way - it's only stock_request_create
-- (withdrawals) that respects this flag. When it's false, on-hand quantity
-- and cumulative received are the same number, since nothing ever draws
-- it back down.

alter table public.material_types add column if not exists is_requestable boolean not null default true;

create or replace function public.stock_request_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_project_id uuid := (p_payload->>'project_id')::uuid;
  v_plot_id uuid := public._jsonb_to_uuid(p_payload->'plot_id');
  v_plot_group_id uuid := public._jsonb_to_uuid(p_payload->'plot_group_id');
  v_contractor_id uuid := (p_payload->>'contractor_id')::uuid;
  v_batch_id uuid := gen_random_uuid();
  v_item jsonb;
  v_material_id bigint;
  v_material_name text;
  v_is_requestable boolean;
  v_qty numeric;
  v_row public.stock_movements;
  v_results jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('foreman', 'pm', 'admin') then
    raise exception 'No permission to withdraw stock' using errcode = '42501';
  end if;
  if v_project_id is null then
    raise exception 'project_id is required' using errcode = '22023';
  end if;
  if v_contractor_id is null then
    raise exception 'contractor_id is required' using errcode = '22023';
  end if;
  if v_plot_id is not null and v_plot_group_id is not null then
    raise exception 'Choose either a single plot or a plot group, not both' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    v_material_id := (v_item->>'material_type_id')::bigint;
    v_qty := (v_item->>'quantity')::numeric;

    if v_material_id is null or coalesce(v_qty, 0) <= 0 then
      continue;
    end if;

    select name, is_requestable into v_material_name, v_is_requestable
    from public.material_types where id = v_material_id;

    if v_material_name is null then
      raise exception 'Material not found: %', v_material_id using errcode = 'P0002';
    end if;
    if not v_is_requestable then
      raise exception '% is set to receive-only and cannot be withdrawn via a material request', v_material_name
        using errcode = '22023';
    end if;

    v_row := public._stock_movement_post(
      p_material_type_id => v_material_id,
      p_project_id        => v_project_id,
      p_type              => 'out',
      p_source_type       => 'manual_request',
      p_source_id         => v_batch_id,
      p_quantity          => v_qty,
      p_plot_id           => v_plot_id,
      p_contractor_id     => v_contractor_id,
      p_requested_by      => v_uid,
      p_note              => p_payload->>'note',
      p_plot_group_id     => v_plot_group_id
    );

    v_results := v_results || jsonb_build_object(
      'material_type_id', v_material_id,
      'quantity', v_qty,
      'new_qty', v_row.new_qty
    );
  end loop;

  if jsonb_array_length(v_results) = 0 then
    raise exception 'No valid items to withdraw' using errcode = '22023';
  end if;

  return jsonb_build_object('batch_id', v_batch_id, 'items', v_results);
end;
$$;

revoke all on function public.stock_request_create(jsonb) from public;
revoke all on function public.stock_request_create(jsonb) from anon;
grant execute on function public.stock_request_create(jsonb) to authenticated;
grant execute on function public.stock_request_create(jsonb) to service_role;
