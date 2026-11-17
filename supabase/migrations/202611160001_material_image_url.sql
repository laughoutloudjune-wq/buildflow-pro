-- Optional product photo per material, shown in the purchase request
-- "shop" picker (PR #31 follow-up, June 2026-11-16). Nullable: a material
-- with no photo shows its category icon instead, so nobody has to upload
-- photos for the whole catalog. Files live in the existing public 'assets'
-- bucket under materials/; admin/pm set it (material_types_write policy).
alter table public.material_types add column if not exists image_url text;
