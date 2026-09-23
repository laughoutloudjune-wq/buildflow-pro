-- Material Flow Phase 4 (MATERIAL_FLOW_PLAN.md) - retire material_usage_log.
-- stock_movements ('out' rows, both manual_request withdrawals and Phase 1's
-- direct_to_site postings) already does this job - 1,191 rows there against
-- 2 here, last written 2026-07-31. Two ledgers to reconcile from here on,
-- not three.
--
-- Verified against production before writing this migration: nothing else
-- (function, view, RLS policy, or FK) references the table, so this is a
-- straight drop, not a data migration.
--
-- Takes the whole foreman-facing "บันทึกวัสดุ" feature with it (its own
-- page, JobMaterialLogModal, the buttons that opened it from the plot
-- construction tab and the billing request form, and the CRUD/variance
-- actions in material-actions.ts) - the app-layer half of this change,
-- landing in the same commit. The separate "Materials" tab on the plot
-- detail page (PlotMaterialsTab) is unaffected: it already reads from
-- stock_movements/purchase_order_items, never this table.

drop table public.material_usage_log;
