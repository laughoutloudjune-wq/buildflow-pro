-- Plot progress curve (June, 2026-09-24): a target completion date per
-- plot, PM/admin-entered, used as the endpoint of the chart's planned/
-- expected progress line (a straight ramp from the plot's first job start
-- to this date). Nullable - a plot with no target simply shows no planned
-- line yet.
alter table public.plots add column target_completion_date date;
