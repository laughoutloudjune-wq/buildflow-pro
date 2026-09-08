-- project_id stays required everywhere (purchase_orders, stock_movements,
-- goods_receipt_create's stock posting all assume a real project) - rather
-- than making it nullable and sweeping every downstream report/PDF/dashboard
-- that reads projects.name off it, a real project row represents "not
-- earmarked for a job yet, bought into central stock." Existing plumbing
-- (PO/PR forms, plot scope defaulting to none when a project has zero
-- plots, stock balance already being one shared pool per material since
-- 202608310001) needs no further changes to support this.
--
-- is_central_stock lets callers exclude it from normal project pickers/
-- counts (project management list, dashboard stats, BOQ/house creation)
-- while still selecting it deliberately in procurement forms - a flag
-- instead of name-matching so it survives a rename/translation.
alter table public.projects add column if not exists is_central_stock boolean not null default false;

insert into public.projects (name, location, status, is_central_stock)
select 'ของเบิกสโตร์ (สโตร์กลาง)', null, 'active', true
where not exists (select 1 from public.projects where is_central_stock = true);
