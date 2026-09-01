-- Phase 4 (partial) of the Stock Movement integration: seed opening stock
-- balances for the 262 materials that matched cleanly by exact name between
-- Stock Movement's 322 materials and BuildFlow Pro's catalog (the other 60
-- need manual review before migrating - see the integration conversation
-- for the matching methodology and why those weren't auto-matched).
--
-- project_id becomes nullable on stock_movements: an opening balance isn't
-- "received for" or "withdrawn for" any particular project, it's just what
-- was on the shelf when the new ledger started. Every other movement type
-- (goods receipts, contractor withdrawals) still has a real project - this
-- only loosens the column for the one kind of event that genuinely has none.
--
-- 'opening_balance' is a new source_type, distinct from 'goods_receipt' and
-- 'manual_request' on purpose - anyone reading the ledger later can tell
-- "this number came from the migration" apart from "this number came from
-- an actual documented delivery."
--
-- Two paths, because the source data itself had two shapes:
--   - 106 materials with positive stock go through _stock_movement_post's
--     normal 'in' path - safe, uses the existing upsert-and-log logic
--     unchanged.
--   - 11 materials were ALREADY negative in Stock Movement (unreconciled
--     shortages that predate this migration, not something this migration
--     introduces). _stock_movement_post's guard correctly refuses to create
--     a negative balance from a real transaction - which is exactly why
--     these need a direct, explicitly narrated insert instead of going
--     through the normal RPC. This records a one-time historical fact, not
--     a new withdrawal.
--   - The remaining 145 matched materials were already at zero in Stock
--     Movement, so there is nothing to migrate - they correctly stay at
--     zero by simply not having a stock_balances row yet.

alter table public.stock_movements alter column project_id drop not null;

alter table public.stock_movements drop constraint stock_movements_source_type_check;
alter table public.stock_movements add constraint stock_movements_source_type_check
  check (source_type in ('goods_receipt', 'manual_request', 'opening_balance'));

-- ---------------------------------------------------------------------------
-- 106 materials with positive opening stock
-- ---------------------------------------------------------------------------
do $$
declare
  v_material_type_id bigint;
  v_qty numeric;
begin
  for v_material_type_id, v_qty in
    select * from (values
      (1447,3),(2003,19),(1194,19),(1950,3),(1951,5),(1952,30),(1579,10),(1585,30),
      (1573,3),(2007,16),(1591,447),(1610,180),(1615,50),(1606,40),(1646,115),(1651,1),
      (1767,1),(1768,37),(1212,2),(1214,1),(1257,2695),(2110,2),(2113,8),(1653,4),
      (1327,5.5),(1488,13),(1490,8),(1492,91),(1332,13),(1659,7),(1662,8),(2195,100),
      (2198,55),(8,2),(1671,150),(1904,46),(1770,28),(1771,5),(1772,28),(2204,1),
      (2220,3.4),(2223,2.1),(1773,0.01),(1958,20),(1962,31),(1964,126),(2159,64),(2146,6),
      (2154,63),(2152,304),(1969,30),(1706,1),(1229,40),(1225,160),(1249,170),(1236,400),
      (1908,2),(1241,90),(1874,12),(1875,12),(1876,23),(1244,16),(1386,5),(2071,19),
      (2072,9),(1911,188),(1435,4),(1775,28),(1777,8),(2234,389),(2078,7),(1972,4),
      (1457,8),(1458,8),(1779,30),(1347,3.5),(1343,15),(1920,300),(1980,23),(1981,1),
      (1983,3),(1720,10),(1984,2),(1985,9),(2032,7),(1723,30),(1725,32),(1724,33),
      (2257,7),(1525,1400),(1526,3),(1351,5),(1780,31),(1729,83),(1744,2),(2044,16),
      (1923,6),(2046,4),(2047,4),(1924,16),(1,7),(2049,3),(2054,2),(2259,8),
      (2057,21),(1785,15)
    ) as t(material_type_id, qty)
  loop
    perform public._stock_movement_post(
      p_material_type_id => v_material_type_id,
      p_project_id        => null,
      p_type              => 'in',
      p_source_type       => 'opening_balance',
      p_source_id         => gen_random_uuid(),
      p_quantity          => v_qty,
      p_note              => 'Migrated opening balance from Stock Movement'
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 11 materials that were already negative in Stock Movement
-- ---------------------------------------------------------------------------
do $$
declare
  v_material_type_id bigint;
  v_new_qty numeric;
begin
  for v_material_type_id, v_new_qty in
    select * from (values
      (1318, -1), (1319, -1), (1580, -1), (1865, -1), (1575, -5),
      (1635, -4), (1765, -5), (2207, -0.4), (2208, -0.6), (1692, -3), (2040, -1)
    ) as t(material_type_id, new_qty)
  loop
    insert into public.stock_balances (material_type_id, quantity_on_hand, updated_at)
    values (v_material_type_id, v_new_qty, now())
    on conflict (material_type_id) do update
      set quantity_on_hand = excluded.quantity_on_hand, updated_at = now();

    insert into public.stock_movements (
      material_type_id, project_id, type, source_type, source_id, quantity, prev_qty, new_qty, note
    ) values (
      v_material_type_id, null, 'out', 'opening_balance', gen_random_uuid(), abs(v_new_qty), 0, v_new_qty,
      'Migrated from Stock Movement - was already negative in the source system'
    );
  end loop;
end $$;
