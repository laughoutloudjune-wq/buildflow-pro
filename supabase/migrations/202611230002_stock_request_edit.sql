-- Edit a past contractor withdrawal slip (เบิกวัสดุ, IS-...). Until now a slip
-- could not be corrected or topped up once saved (e.g. the material ran out
-- and the contractor needs more on the same slip).
--
-- p_batch_id = the slip's source_id (shared by all its rows). The payload says
-- what the slip should look like now: contractor, plot / plot group, note and
-- the TOTAL quantity wanted per material. Stock stays correct because each
-- material is settled by its difference to what the slip already holds:
--   * more  -> new 'out' row on the SAME slip (same IS number) posted through
--              _stock_movement_post, so the stock check ("not enough on hand"),
--              the cost at today's average and the ledger all work as for a
--              normal withdrawal;
--   * less  -> the newest rows of that material are reduced (or removed when
--              they reach 0) and the quantity goes back into stock_balances;
--   * a material missing from the payload is removed, its stock returned.
-- Every change is written to document history by the existing trigger.
-- Project stays fixed. A foreman may only edit slips they made themselves;
-- pm/admin may edit any. Contains a DELETE (removing a line): run it in the
-- Supabase SQL Editor if the connector asks to confirm.
create or replace function public.stock_request_edit(p_batch_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public._billing_current_role();
  v_first public.stock_movements;
  v_project_id uuid;
  v_contractor_id uuid := (p_payload->>'contractor_id')::uuid;
  v_plot_id uuid := public._jsonb_to_uuid(p_payload->'plot_id');
  v_plot_group_id uuid := public._jsonb_to_uuid(p_payload->'plot_group_id');
  v_note text := p_payload->>'note';
  v_item jsonb;
  v_material_id bigint;
  v_want numeric;
  v_have numeric;
  v_delta numeric;
  v_name text;
  v_requestable boolean;
  v_seen bigint[] := '{}';
  v_count int := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_role not in ('foreman', 'pm', 'admin') then
    raise exception 'No permission to edit this withdrawal' using errcode = '42501';
  end if;

  select * into v_first from public.stock_movements
  where source_id = p_batch_id and source_type = 'manual_request' and type = 'out'
  order by created_at limit 1
  for update;
  if not found then
    raise exception 'Withdrawal not found' using errcode = 'P0002';
  end if;
  if v_role = 'foreman' and v_first.requested_by is distinct from v_uid then
    raise exception 'No permission to edit this withdrawal' using errcode = '42501';
  end if;
  v_project_id := v_first.project_id;

  if v_contractor_id is null then
    raise exception 'contractor_id is required' using errcode = '22023';
  end if;
  if v_plot_id is not null and v_plot_group_id is not null then
    raise exception 'Choose either a single plot or a plot group, not both' using errcode = '22023';
  end if;
  if v_plot_id is null and v_plot_group_id is null
     and exists (select 1 from public.plots where project_id = v_project_id) then
    raise exception 'Choose a plot or plot group for this withdrawal' using errcode = '22023';
  end if;

  -- Header: applies to every row of the slip.
  update public.stock_movements
  set contractor_id = v_contractor_id, plot_id = v_plot_id, plot_group_id = v_plot_group_id, note = v_note
  where source_id = p_batch_id and source_type = 'manual_request'
    and (contractor_id is distinct from v_contractor_id or plot_id is distinct from v_plot_id
         or plot_group_id is distinct from v_plot_group_id or note is distinct from v_note);

  -- Lines.
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) loop
    v_material_id := (v_item->>'material_type_id')::bigint;
    v_want := (v_item->>'quantity')::numeric;
    if v_material_id is null or coalesce(v_want, 0) <= 0 then
      continue;
    end if;
    v_seen := v_seen || v_material_id;
    v_count := v_count + 1;

    select coalesce(sum(quantity), 0) into v_have from public.stock_movements
    where source_id = p_batch_id and source_type = 'manual_request' and material_type_id = v_material_id;
    v_delta := v_want - v_have;

    if v_delta > 0 then
      select name, is_requestable into v_name, v_requestable from public.material_types where id = v_material_id;
      if v_name is null then
        raise exception 'Material not found: %', v_material_id using errcode = 'P0002';
      end if;
      if not v_requestable then
        raise exception '% is set to receive-only and cannot be withdrawn via a material request', v_name using errcode = '22023';
      end if;
      perform public._stock_movement_post(
        p_material_type_id => v_material_id, p_project_id => v_project_id, p_type => 'out',
        p_source_type => 'manual_request', p_source_id => p_batch_id, p_quantity => v_delta,
        p_plot_id => v_plot_id, p_contractor_id => v_contractor_id, p_requested_by => v_uid,
        p_note => v_note, p_plot_group_id => v_plot_group_id
      );
    elsif v_delta < 0 then
      perform public._stock_edit_return(p_batch_id, v_material_id, -v_delta);
    end if;
  end loop;

  if v_count = 0 then
    raise exception 'No valid items to withdraw' using errcode = '22023';
  end if;

  -- Materials no longer on the slip: everything goes back.
  for v_material_id in
    select distinct material_type_id from public.stock_movements
    where source_id = p_batch_id and source_type = 'manual_request' and not (material_type_id = any (v_seen))
  loop
    select coalesce(sum(quantity), 0) into v_have from public.stock_movements
    where source_id = p_batch_id and source_type = 'manual_request' and material_type_id = v_material_id;
    perform public._stock_edit_return(p_batch_id, v_material_id, v_have);
  end loop;

  return jsonb_build_object('batch_id', p_batch_id, 'issue_no', v_first.issue_no);
end;
$$;

-- Give back p_qty of one material from a slip, newest rows first.
create or replace function public._stock_edit_return(p_batch_id uuid, p_material_id bigint, p_qty numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining numeric := p_qty;
  v_take numeric;
  v_row record;
begin
  for v_row in
    select id, quantity from public.stock_movements
    where source_id = p_batch_id and source_type = 'manual_request' and material_type_id = p_material_id
    order by created_at desc, id desc
  loop
    exit when v_remaining <= 0;
    v_take := least(v_row.quantity, v_remaining);
    if v_take >= v_row.quantity then
      delete from public.stock_movements where id = v_row.id;
    else
      update public.stock_movements
      set quantity = quantity - v_take, new_qty = new_qty + v_take
      where id = v_row.id;
    end if;
    insert into public.stock_balances (material_type_id, quantity_on_hand, updated_at)
    values (p_material_id, v_take, now())
    on conflict (material_type_id) do update
      set quantity_on_hand = public.stock_balances.quantity_on_hand + v_take, updated_at = now();
    v_remaining := v_remaining - v_take;
  end loop;
end;
$$;

revoke all on function public._stock_edit_return(uuid, bigint, numeric) from public, anon, authenticated;
revoke all on function public.stock_request_edit(uuid, jsonb) from public;
revoke all on function public.stock_request_edit(uuid, jsonb) from anon;
grant execute on function public.stock_request_edit(uuid, jsonb) to authenticated;
grant execute on function public.stock_request_edit(uuid, jsonb) to service_role;
