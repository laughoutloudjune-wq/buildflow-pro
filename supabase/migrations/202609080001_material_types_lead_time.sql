-- Per-material lead time (in days) so a PM approving a purchase request can
-- see how much runway ordering that material actually needs before the
-- requested need-by date. Nullable, no default - null means "not set yet",
-- same convention as reorder_point. Editable from the Material Catalog
-- settings page alongside price/reorder point.

alter table public.material_types add column if not exists lead_time_days integer;
