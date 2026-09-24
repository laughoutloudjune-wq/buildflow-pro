-- Handover plan Phase 7 cleanup, L-01: leftover tables/view/function from
-- before this app's current schema (invoices/invoice_items/progress_logs
-- predate purchase_orders+billings; master_data and settings predate
-- organization_settings). Confirmed before dropping:
--   - no app code reads any of them (grepped the whole repo);
--   - no live FK points FROM a kept table INTO any of these (only the
--     reverse - these tables reference job_assignments/profiles/projects/
--     contractors, never the other way), so dropping them cannot cascade
--     into real data;
--   - invoices/invoice_items/master_data/progress_logs/inspections are all
--     empty (0 rows); settings has 3 rows, all superseded by
--     organization_settings (wht_tax/retention/a placeholder company_name).
-- view_latest_progress (flagged "Security Definer View" ERROR by the
-- advisor) is dropped first since it depends on progress_logs.
--
-- po_mark_received (backing the already-unused markPurchaseOrderReceived
-- action, deleted alongside this migration) set a PO to 'received' with no
-- receipt or stock movement created - exactly the "status label only"
-- behaviour Phase 2 removed from every other path.
--
-- There is no practical rollback for a DROP TABLE beyond point-in-time
-- recovery; the full column list for each table is preserved in this
-- migration's PR description / session notes, not restated here as DDL,
-- since every table was empty (settings: 3 stale rows) and none is coming
-- back.

drop view public.view_latest_progress;
drop table public.invoice_items;
drop table public.invoices;
drop table public.master_data;
drop table public.progress_logs;
drop table public.inspections;
drop table public.settings;
drop function public.po_mark_received(uuid, date);
