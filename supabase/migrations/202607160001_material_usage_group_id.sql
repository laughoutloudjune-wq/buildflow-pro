-- Supports logging one material purchase against a group of plots at once
-- (contractors often draw materials for a batch of sibling plots - e.g. the
-- same house type across plots 98-102 - rather than one plot at a time, and
-- there is no way to know the true per-plot split).
--
-- Design: a "grouped" purchase still inserts one row per plot (job
-- assignment) as before, so each plot's variance view keeps working
-- unchanged - but every row from the same submission shares a `group_id`,
-- so the UI can (a) show a "shared with plots X, Y" marker, and (b) let a
-- future project-level rollup dedupe by group_id instead of double-counting
-- the same purchase once per plot. Solo (non-grouped) entries keep
-- group_id = null.

alter table public.material_usage_log
  add column if not exists group_id uuid;

create index if not exists material_usage_log_group_id_idx on public.material_usage_log(group_id);
