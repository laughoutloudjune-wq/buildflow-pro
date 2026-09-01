-- Correction: เหล็กซีสังกะสี (galvanized C-channel) was wrongly classified as
-- "no match" in the second-pass review. It exists in the catalog under
-- เหล็กตัวซีสังกะสี ("ตัว" inserted mid-name) - the matcher was looking for
-- เหล็กซี as a contiguous substring and missed the inserted word, the same
-- class of bug as the straight/bent rebar case. Only the 3" size carries
-- real stock; the 4"/5" sizes were already at zero.

do $$
begin
  perform public._stock_movement_post(
    p_material_type_id => 1369,
    p_project_id        => null,
    p_type              => 'in',
    p_source_type       => 'opening_balance',
    p_source_id         => gen_random_uuid(),
    p_quantity          => 12,
    p_note              => 'Migrated opening balance from Stock Movement (เหล็กตัวซีสังกะสี 3"x1.60mm - found on re-check, ตัว-insertion missed by matcher)'
  );
end $$;
