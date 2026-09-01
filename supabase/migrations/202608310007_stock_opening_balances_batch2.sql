-- Phase 4 continuation: opening balances for the second batch of Stock
-- Movement materials - the 15 (of 60 originally unmatched) that resolved to
-- exactly one BuildFlow Pro candidate once matching compared size/model
-- tokens (DB12 vs DB16, 3" vs 4" pipe, etc.), not just the leading product
-- name. The other 45 either need a manual pick between multiple same-family
-- candidates (brand/color/orientation isn't something the size-token check
-- catches - e.g. straight vs bent rebar) or have no match at all and are
-- likely new to the catalog. See the Material Match Shortlist artifact.
--
-- 4 of the 15 were already at zero in Stock Movement, so there is nothing
-- to migrate for those - they stay at zero by not having a row, same as
-- every other untouched material.
--
-- One item (id 1277, อิฐมวลเบา QCON) was flagged is_requestable = false in a
-- separate change - that's unrelated to this migration. Receiving/opening
-- balance is tracked the same regardless of whether the material can later
-- be withdrawn via a request.

do $$
declare
  v_material_type_id bigint;
  v_qty numeric;
begin
  for v_material_type_id, v_qty in
    select * from (values
      (1446,7),(2010,67),(1650,23),(1652,23),(1506,3),
      (2203,4),(2066,13),(1547,7),(1988,28),(1782,20),(1277,3)
    ) as t(material_type_id, qty)
  loop
    perform public._stock_movement_post(
      p_material_type_id => v_material_type_id,
      p_project_id        => null,
      p_type              => 'in',
      p_source_type       => 'opening_balance',
      p_source_id         => gen_random_uuid(),
      p_quantity          => v_qty,
      p_note              => 'Migrated opening balance from Stock Movement (batch 2 - spec-confirmed match)'
    );
  end loop;
end $$;
