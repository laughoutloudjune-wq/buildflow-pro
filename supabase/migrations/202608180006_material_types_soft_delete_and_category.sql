-- Reconciles schema drift: this migration was applied directly to the live
-- database (Supabase-recorded version 20260818091136, name
-- "material_types_soft_delete_and_category") with no matching tracked file
-- - flagged at the very start of the Stock Movement integration work and
-- left open ever since. Reconstructed from the live schema, not from a
-- lost original file, so it's guard-heavy (if not exists / if exists)
-- throughout rather than assumed to run against a clean slate.
--
-- Adds the two things every later procurement/stock migration already
-- assumes exist on material_types:
--   - is_active: soft-delete flag (see deactivateMaterialType/
--     reactivateMaterialType in actions/material-actions.ts - a hard DELETE
--     fails once a material is referenced by boq_material_items/
--     material_usage_log/purchase_order_items, so deactivating instead
--     keeps every past reference intact).
--   - category: free-text catalog grouping, office-managed, populated by
--     hand for the existing 1187-material catalog.
-- Plus the two indexes that make filtering by either one cheap at that
-- table size.

alter table public.material_types add column if not exists is_active boolean not null default true;
alter table public.material_types add column if not exists category text;

create index if not exists material_types_is_active_idx on public.material_types (is_active);
create index if not exists material_types_category_idx on public.material_types (category);
