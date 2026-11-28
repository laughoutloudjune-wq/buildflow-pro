-- Fix for house type change wizard: boq_master.total_price is a generated column,
-- so copying a BOQ line must not insert it. Replaces one function only; no data is touched.

create or replace function public._htc_copy_line(
  p_new_model uuid,
  p_source uuid,
  p_price numeric,
  p_plot_id uuid,
  out line_id uuid,
  out created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src boq_master;
  v_price numeric;
begin
  select * into v_src from boq_master where id = p_source;
  if not found then
    raise exception 'ไม่พบรายการ BOQ ต้นทาง' using errcode = 'P0002';
  end if;
  v_price := coalesce(p_price, v_src.price_per_unit);

  select bm.id into line_id
  from boq_master bm
  where bm.house_model_id = p_new_model
    and bm.item_name = v_src.item_name
    and bm.unit is not distinct from v_src.unit
    and bm.quantity is not distinct from v_src.quantity
    and bm.price_per_unit is not distinct from v_price
    and not exists (select 1 from job_assignments ja where ja.plot_id = p_plot_id and ja.boq_item_id = bm.id)
  order by bm.created_at, bm.id
  limit 1;
  if line_id is not null then
    created := false;
    return;
  end if;

  -- total_price is a generated column (price_per_unit * quantity): never insert it.
  insert into boq_master (project_id, contractor_type_id, house_model_id, item_name, price, unit, description, price_per_unit, quantity)
  values (v_src.project_id, v_src.contractor_type_id, p_new_model, v_src.item_name, v_src.price, v_src.unit, v_src.description,
          v_price, v_src.quantity)
  returning id into line_id;

  insert into boq_material_items (boq_id, material_type_id, planned_quantity, waste_percent)
  select line_id, mi.material_type_id, mi.planned_quantity, mi.waste_percent
  from boq_material_items mi
  where mi.boq_id = p_source;

  created := true;
end;
$$;
