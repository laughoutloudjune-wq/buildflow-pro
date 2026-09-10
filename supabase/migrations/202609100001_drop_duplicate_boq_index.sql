-- boq_master carried two byte-identical indexes on (project_id):
-- `boq_master_project_id_idx` and `idx_boq_master_project_id`. Postgres will
-- only ever use one of them, so the other is pure overhead - it is
-- maintained on every insert/update/delete and occupies space for nothing.
-- Supabase's performance linter flags it as `duplicate_index`.
--
-- Keeping `idx_boq_master_project_id` (the one the planner has actually been
-- picking - the other shows zero scans in pg_stat_user_indexes).
DROP INDEX IF EXISTS public.boq_master_project_id_idx;
