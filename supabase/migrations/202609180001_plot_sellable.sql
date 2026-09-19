-- Sales module, Phase 0 (SALES_MODULE_PLAN.md #7.1).
--
-- Not every plots row is a sellable house: some are common-area or
-- vehicle-holding rows ('ส่วนกลาง', 'ที่รอรถ'), and some are construction
-- batches named as a range ('25-29', '42-45' in Arada Prime), not a single
-- unit. Anything that reads plots to build a sales board must be able to
-- exclude these, or it lists things that were never for sale.
--
-- The other four columns are sale-facing plot facts the sales team needs on
-- day one (เนื้อที่ / เลขที่โฉนด / ราคาตั้ง) plus the site-plan marker position,
-- added now so Phase 4 doesn't need another migration. map_x/map_y are
-- fractions (0..1) of the site-plan image's width/height, not pixels -
-- see #7.8 for why: pixel coordinates break every time the plan image is
-- replaced with a different-resolution scan.
alter table public.plots
  add column if not exists is_sellable    boolean not null default true,
  add column if not exists land_area_sqwa numeric,
  add column if not exists title_deed_no  text,
  add column if not exists list_price     numeric,
  add column if not exists map_x          numeric check (map_x between 0 and 1),
  add column if not exists map_y          numeric check (map_y between 0 and 1);

comment on column public.plots.is_sellable is
  'False for common-area/holding rows and multi-house range batches - excluded from the sales board.';
comment on column public.plots.land_area_sqwa is 'เนื้อที่ดิน (ตารางวา).';
comment on column public.plots.title_deed_no is 'เลขที่โฉนดที่ดิน.';
comment on column public.plots.list_price is 'ราคาตั้ง - the asking price before any deal-specific discount (plot_sales.sale_price, added in a later phase).';
comment on column public.plots.map_x is 'Site-plan marker position, 0..1 fraction of image width. Null until placed in the Phase 4 editor.';
comment on column public.plots.map_y is 'Site-plan marker position, 0..1 fraction of image height. Null until placed in the Phase 4 editor.';

-- Checked against production 2026-09-18 (§4/§7.1 of the plan): this matches
-- 'ส่วนกลาง' x2 (Arada Prime, Arada Vela), 'ที่รอรถ' x1 (งานเทศบาล), and the two
-- range rows in Arada Prime - 5 rows total, out of 90.
update public.plots
set is_sellable = false
where name in ('ส่วนกลาง', 'ที่รอรถ') or name ~ '^[0-9]+-[0-9]+$';
