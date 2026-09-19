-- Demo houses (e.g. show homes) are real, built units that are deliberately
-- withheld from sale rather than pending construction - a different reason
-- for is_sellable=false than an unbuilt future-phase plot, so it needs its
-- own flag rather than being folded into is_sellable.
alter table plots add column is_demo_house boolean not null default false;

-- VELA's upper site-plan section (plots 1-69) includes Prime B units, which
-- didn't exist in house_models yet because only the already-tracked lower
-- section (70-139) had been entered before now.
-- area (built floor size) is left null - the site plan only gives per-plot
-- land size, not the model's floor area; fill in once the real spec is known.
insert into house_models (project_id, name, code, area) values
  ('9bdca9d5-adeb-4ba4-b13b-819d28a62ab0', 'Prime B', 'อิสระ', null),
  ('9bdca9d5-adeb-4ba4-b13b-819d28a62ab0', 'Prime B', 'แฝด', null);
