-- Sales module, Phase 4 (SALES_MODULE_PLAN.md §7.8, promoted per D4).
--
-- plots.map_x/map_y already exist (Phase 0, 202609180001) - normalised 0..1
-- fractions of the plan image's width/height, so a marker never has to be
-- re-placed just because the image was replaced with a different-resolution
-- scan. This migration adds the plan image itself, on projects.
--
-- site_plan_width/height are the image's natural pixel size, stored at
-- upload time rather than measured on every page load - the editor needs it
-- to keep the marker layer's aspect ratio matching the image exactly.
alter table public.projects
  add column if not exists site_plan_url    text,
  add column if not exists site_plan_width  int,
  add column if not exists site_plan_height int;

comment on column public.projects.site_plan_url is 'ผังโครงการ (site plan) image - public URL in the assets bucket.';
comment on column public.projects.site_plan_width is 'Natural pixel width of the uploaded plan image.';
comment on column public.projects.site_plan_height is 'Natural pixel height of the uploaded plan image.';
