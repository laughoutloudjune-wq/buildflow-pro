-- Store-stock and overhead purchase orders do not belong to a plot.
--
-- po_create / po_update refuse any order with no plot, plot group or plot
-- selection unless it is marked "outside BOQ". Since the PO form learned the
-- purpose question (202610160002), a store-stock order is saved against the
-- store project with no plot at all, so the save failed with "needs a plot,
-- plot group, or plot selection". The material is charged to plots later,
-- when a contractor request withdraws it from the store (stock_movements),
-- so the order itself must be allowed to have no plot.
--
-- Only projects of kind 'development' keep the requirement. The functions are
-- patched in place from their live definition (instead of re-pasting ~300
-- lines each) and the migration fails loudly if the expected line is missing.

do $$
declare
  v_old constant text :=
    'if not v_is_outside_boq and v_plot_id is null and v_plot_group_id is null and v_plot_ids_count = 0 then';
  v_new constant text :=
    'if not v_is_outside_boq and v_plot_id is null and v_plot_group_id is null and v_plot_ids_count = 0'
    || E'\n    and coalesce((select pj.kind = ''development'' from public.projects pj where pj.id = v_project_id), true) then';
  v_fn text;
  v_def text;
begin
  foreach v_fn in array array['po_create(jsonb)', 'po_update(uuid,jsonb)']
  loop
    v_def := pg_get_functiondef(('public.' || v_fn)::regprocedure);
    if position(v_old in v_def) = 0 then
      raise exception 'Expected plot check not found in %', v_fn;
    end if;
    execute replace(v_def, v_old, v_new);
  end loop;
end $$;
