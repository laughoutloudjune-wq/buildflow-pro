-- Flag bulk cement/concrete products as receive-only, matching the
-- อิฐมวลเบา pattern: these get delivered and used immediately (bag cement
-- mixed on site as needed, ready-mix poured straight from the truck)
-- rather than warehoused for a later discrete withdrawal request.
--
-- 20 bagged cement/mortar products (ปูนก่อ, ปูนฉาบ, ปูนกาว, plain cement)
-- and 8 ready-mix concrete grades. Left untouched: waterproofing compounds,
-- non-shrink grout, and skim coat (ids 1212-1219, 1240, 1243-1248) -
-- smaller finishing/repair products a foreman could plausibly request for
-- one specific task, not bulk-consumed on delivery.

update public.material_types
set is_requestable = false
where id in (
  -- bagged cement / mortar
  1198,1223,1224,1225,1227,1228,1229,1230,1231,1232,
  1233,1234,1235,1236,1237,1238,1239,1241,1242,1249,
  -- ready-mix concrete
  1200,1201,1202,1203,1204,1205,1206,1207
);
