-- Phase C of the stock control pages: a per-material reorder threshold so
-- "low stock" is a real, settable answer instead of a guess. Nullable, no
-- default - null means "no threshold set yet," distinct from a threshold of
-- 0. Editable from the existing Material Catalog settings page alongside
-- name/unit/category/price.

alter table public.material_types add column if not exists reorder_point numeric;
