-- Material Flow Phase 2 (MATERIAL_FLOW_PLAN.md) - split "which development"
-- from "what kind of spend" without touching project_id's non-null shape.
-- 202609080005_central_stock_project.sql already looked at making project_id
-- nullable and backed off because every downstream report/PDF/dashboard
-- reads projects.name off it - tagging the row instead gets the same
-- user-visible result (clean pickers, separate overhead reporting) with no
-- sweep.
--
-- The eight `is_central_stock = false` filters scattered across `actions/`
-- (dashboard-actions.ts, sales-actions.ts, boq-control.ts,
-- labor-budget-actions.ts, billing/lookups.ts, stock-actions.ts,
-- project-actions.ts) were only ever trying to hide ONE special row - they
-- never hid ของใช้สำนักงาน/อุปกรณ์ช่าง/แพลนท์ปูน/ส่วนกลาง/เครื่องมือช่าง...,
-- which is why those still show up in project pickers today. `kind` fixes
-- that for real; `is_central_stock` stays untouched for now (Phase 3 removes
-- it once the central-stock pseudo-project itself is retired).
--
-- ของเบิกสโตร์ (the central-stock pseudo-project, is_central_stock = true)
-- is tagged 'overhead' here too, alongside the buckets the plan named -
-- it isn't a development either, and leaving it 'development' by default
-- would have it leak right back into every picker this migration is meant
-- to clean up. Its is_central_stock flag and special procurement-only
-- visibility are untouched; Phase 3 is what actually retires the row.

alter table public.projects
  add column if not exists kind text not null default 'development'
  check (kind in ('development','overhead'));

update public.projects set kind = 'overhead'
where name in ('ของใช้สำนักงาน','อุปกรณ์ช่าง','แพลนท์ปูน','ส่วนกลาง',
               'เครื่องมือช่างต่าย','เครื่องมือช่างบุ๋ม',
               'เครื่องมือช่างสุนทร','เครื่องมือช่างเอ็มลี่',
               'อารดา 1','อารดา 2','แปลง 17-20')
   or is_central_stock = true;
