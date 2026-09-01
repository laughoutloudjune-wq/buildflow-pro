-- Correction batch 3: the "no family match at all" bucket from the
-- second-pass review turned out to have a much bigger blind spot than the
-- one item (เหล็กซีสังกะสี) already fixed in the previous migration. The
-- matcher relied on a single leading keyword; these all match a real
-- BuildFlow Pro material once you allow for word-order differences
-- (HC36110 ขาวโอโม่ vs ขาวโอโม่ HC36110), synonym product nouns (สกรู vs
-- ตะปูเกลียว for the same self-tapping ceiling screw), or a spelling
-- variant (ก็อก vs ก๊อก). Brand/model code + size is what actually confirms
-- each of these - see the chat for per-item reasoning.

do $$
declare
  v_material_type_id bigint;
  v_qty numeric;
begin
  for v_material_type_id, v_qty in
    select * from (values
      (1555,30),  -- สกรูดำ AJAX 6*1" -> สกรูเกลียวปล่อยดำขันฝ้า #6*1" AJAX
      (1505,17),  -- สกรูดำยิงฝ้า 6*1" NASH -> ตะปูเกลียวดำยิงฝ้า 6*1" NASH
      (1392,40),  -- แป๊ปเหลี่ยมดำ 1/2"x1/2" 1.2mm -> แป๊ปเหลี่ยม 1/2"x1/2" หนา 1.2mm
      (1397,25),  -- แป๊ปเหลี่ยมดำ 2"x2" 2.3mm -> แป๊ปเหลี่ยม 2"x2" หนา 2.30mm มอก
      (1584,14),  -- ก็อกสนาม SANWA 1/2" -> ก๊อกสนาม SANWA 1/2"
      (1626,12),  -- ข้อต่อตรงผม. ANA 1/2" -> ข้อต่อตรงทล 1/2" ANA SOFM143-015 ผม.
      (1769,2),   -- อ่างล้างหน้า WSP BSCC-137 -> ชุดเคาน์เตอร์ WSP รุ่น BSCC-137
      (1948,7)    -- กระจกเจียรปี AVA 60x80cm -> กระจกเงา แบบเหลี่ยม 60*80 ซม. AVA
    ) as t(material_type_id, qty)
  loop
    perform public._stock_movement_post(
      p_material_type_id => v_material_type_id,
      p_project_id        => null,
      p_type              => 'in',
      p_source_type       => 'opening_balance',
      p_source_id         => gen_random_uuid(),
      p_quantity          => v_qty,
      p_note              => 'Migrated opening balance from Stock Movement (batch 3 - found on re-check after "no family" classification was wrong)'
    );
  end loop;
end $$;
