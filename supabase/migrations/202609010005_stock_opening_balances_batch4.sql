-- Correction batch 4: the last two "no family match" holdouts, confirmed
-- by the user as the same brand/product despite the name differences noted
-- in chat (AYES not named on the candidate; ทับหลังสำเร็จรูป vs the
-- catalog's fuller เสาเอ็นทับหลัง name). id 1744 already carries an
-- unrelated balance of 2 from prior activity - _stock_movement_post adds to
-- it rather than overwriting, so this correctly lands at 40, not 38.

do $$
declare
  v_material_type_id bigint;
  v_qty numeric;
begin
  for v_material_type_id, v_qty in
    select * from (values
      (1744,38),  -- สายน้ำดีถัก AYES 16" -> สายน้ำดีสแตนเลสแบบถัก 1/2" ยาว 16" K-1351236
      (1291,15)   -- ทับหลังสำเร็จรูป 4.00m*50m -> เสาเอ็นทับหลัง 4.00×m50m
    ) as t(material_type_id, qty)
  loop
    perform public._stock_movement_post(
      p_material_type_id => v_material_type_id,
      p_project_id        => null,
      p_type              => 'in',
      p_source_type       => 'opening_balance',
      p_source_id         => gen_random_uuid(),
      p_quantity          => v_qty,
      p_note              => 'Migrated opening balance from Stock Movement (batch 4 - confirmed same brand/product by user)'
    );
  end loop;
end $$;
