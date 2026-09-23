-- Material Flow Phase 3 (MATERIAL_FLOW_PLAN.md) - retire the central-stock
-- pseudo-project via option (a) (user's call, 2026-09-23): keep the row
-- rather than making project_id nullable everywhere and sweeping every
-- downstream report/PDF/dashboard that reads projects.name off it -
-- 202609080005 already looked at that and backed off for exactly that
-- reason, and Phase 2 hit the same tradeoff again. Renaming it to read as
-- a placeholder rather than a real development gets the same practical
-- outcome ("buying for the yard" = "no job yet") at zero schema risk.
--
-- Nothing to repoint: the 113 POs against this project already read
-- correctly once it's tagged kind = 'overhead' (done in Phase 2) and
-- renamed here - they were never wrong, just mislabelled. The 2 receipts
-- that did post stock movements against it already carry
-- default_destination = 'store' from Phase 1's column backfill (verified
-- against production before writing this migration) - today's behaviour,
-- unchanged.
--
-- is_central_stock itself is dropped: nothing else in the schema
-- (functions, views, RLS policies - checked against production) references
-- it, and `kind` already carries the distinction that mattered app-side.

update public.projects set name = 'สโตร์กลาง (ไม่ระบุงาน)' where is_central_stock = true;

alter table public.projects drop column is_central_stock;
