# Weekly and Monthly Plan: Implementation Revision Plan

**Status:** Proposed
**Scope:** Revise the existing construction weekly/monthly plan so planned work is traceable to each plot's BOQ and job assignment.
**Current implementation inspected:** `app/dashboard/weekly-plan`, `components/weekly-plan`, `actions/weekly-plan-actions.ts`, `plot_phase_schedule`, and the BOQ/job assignment flows.

## 1. Current state and problem

The current page is backed by `weekly_plan_items` and `weekly_plan_meetings` (migration `202610060002_weekly_plan.sql`, extended by `202610070005_weekly_plan_detail.sql`). A plan item stores a manually entered title, project, optional plot, week, kind, owner, contractor and daily PLAN/ACTUAL percentages. It has no `boq_master` or `job_assignments` reference. The item editor can bulk-create the same free-text task across plots and weeks.

The plot phase schedule is a separate, higher-level schedule. `plot_phase_schedule` is keyed by plot and contractor type and provides phase dates for progress curves. It is derived from job assignments and BOQ trade categories, but it does not identify individual BOQ work items and does not populate weekly plan items.

As a result, a user can schedule a task name that does not exist on that plot's BOQ, assign an unrelated contractor, and report progress without updating or being traceable to the corresponding assigned BOQ job.

## 2. Target workflow

Use this relationship for BOQ work:

**Project → plot → job assignment (BOQ work item instance) → scheduled week(s) → responsible contractor/owner → planned and actual progress**

The plot's `job_assignments` row is the operational anchor: it identifies the BOQ line assigned to that specific plot. The BOQ title and trade should be displayed from the related `boq_master` row. Preserve manual non-BOQ items for inspections, repairs, DC and other work, with an explicit work source so they remain distinguishable in the UI and reports.

The monthly view should be a month-at-a-glance workload and allocation view. The weekly view should be the execution view for one selected week, showing the work planned for each plot/job and recording progress. Both views must use the same underlying scheduled work records.

## 3. Decisions to confirm before implementation

1. **Scheduling grain:** Can one BOQ job assignment be split across multiple weeks? Recommended: yes, with one schedule row per job assignment per week.
2. **Progress meaning:** Does a weekly percentage represent cumulative completion of the BOQ job, or progress made during that week? Recommended: cumulative completion at each day-end, matching the current PLAN/ACTUAL array UI; each week's opening actual is carried from the prior week.
3. **Completion source:** Can the existing job/billing workflow provide reliable completion progress? If it only provides a billable/done status, keep progress in the plan initially and do not silently treat billing as physical completion.
4. **Quantity planning:** Is it necessary to schedule numeric BOQ quantities per week? Recommended for the first release: retain progress percentages and show the BOQ quantity/unit for context. Add weekly quantity allocation only if site teams actually plan by quantities.
5. **Plan agreement:** Is the existing meeting-agreement marker sufficient, or must agreement lock the planned rows? Recommended: snapshot/lock the version at agreement and require an explicit reopen action to change it.

**Resolved 2026-10-07 (recommendations accepted):**
1. One BOQ job assignment may span multiple weeks: one schedule row per job per week.
2. Weekly percentages are cumulative completion at each day-end; opening actual carries from the prior week.
3. Progress is kept in the plan only. Billing/job status is not treated as physical completion.
4. No per-week quantity planning. Sites record by percentage; BOQ quantity/unit is shown for context only.
5. Meeting agreement snapshots and locks the planned rows; changes need an explicit reopen action.

These decisions affect schema constraints and whether plan progress can be reconciled automatically.

## 4. Implementation phases

### Phase 0 — Map existing data and define compatibility

- Inspect `boq_master`, `job_assignments`, `plots`, and the create/sync job actions to confirm the exact foreign keys and fields for quantity, unit, agreed price, status and contractor.
- Inspect the current production data for weekly plan rows and report counts of rows that could be matched unambiguously by plot, title and kind. Do not auto-match on title alone.
- Confirm current `weekly_plan_items` RLS policies and the role rules for admin, PM and foreman before changing writes.
- Decide handling of deleted or replaced BOQ lines. Recommended: retain plan history and set the job assignment reference to null if the referenced assignment is removed; avoid cascading deletion of historical plan records.

**Deliverable:** a short field map and a data report with clear matches, ambiguous rows and unmatched rows.

#### Phase 0 report (run 2026-10-07 against the live DB)

**Field map**
- `job_assignments`: `id`, `plot_id` (FK plots, cascade), `boq_item_id` (FK `boq_master`, cascade), `contractor_id` (nullable), `status` (`pending` / `in_progress` / `completed`), `agreed_price_per_unit`. Unique on `(plot_id, boq_item_id)`, so a plot has at most one job per BOQ line.
- `boq_master`: `item_name`, `quantity`, `unit`, `contractor_type_id` (trade), `house_model_id`, `project_id`. Price columns exist and must not reach sales.
- `weekly_plan_items`: `plot_id`, `contractor_id`, `carry_pct`, `plan_pct[]`, `actual_pct[]`, `kind`, `status`, `owner_id`, `created_by`. No BOQ link yet.

**Surprises that change the plan**
1. **`job_assignments.boq_id` is dead.** It is null on all 1,454 rows. `boq_item_id` is the real link. Use `boq_item_id` only.
2. **`job_assignments.project_id` is null on all rows.** The project must be derived through `plots.project_id`. The project/plot consistency check in Phase 1 has to join through `plots` and cannot compare against the job row's own `project_id`.
3. **Contractor is unassigned on 1,069 of 1,454 jobs (74%).** Only 389 have one. The BOQ picker must therefore allow jobs with no contractor and let the planner supply one (the existing `weekly_plan_items.contractor_id`). The "missing contractor" conflict flag in Phase 4 would fire on most rows, so make it a soft hint.
4. **`job_assignments.status` already exists** (1,069 pending, 127 in progress, 258 completed). Per decision 3 it is not used as physical progress; show it as context only.

**Existing plan data**
- `weekly_plan_items` has 1 row: kind `main`, title "งานก่อ", plot 103, week of 2026-10-05, no contractor. Plot 103 has 0 job assignments with that title, so it stays a non-BOQ row. Nothing to backfill, so Phase 6 backfill is effectively a no-op.
- RLS (migration `202610060002`): admin, PM and foreman can read. Admin and PM can write all rows. Foreman can write only rows they created. A new RPC or column must keep this.

**Replaced or deleted BOQ lines:** `job_assignments` cascades when its `boq_master` row or plot is deleted. The new FK on the plan item should be `on delete set null` so plan history survives, and the row should keep a stored title copy as a fallback.

### Phase 1 — Add BOQ-linked scheduling data

- Add a nullable `job_assignment_id` FK to `weekly_plan_items` (or introduce a normalized `weekly_plan_allocations` table if repeated per-week rows would duplicate daily progress/ownership data). Prefer the nullable FK as the smallest compatible first step.
- Add a check/trigger or write RPC that verifies the job assignment's plot belongs to the same project as the weekly plan item. A BOQ reference must not be accepted without a matching plot job assignment.
- Index the new FK and any common lookup keys such as `(project_id, week_start)` and `(job_assignment_id, week_start)`.
- Preserve null `job_assignment_id` for manually entered non-BOQ work. Add an explicit source/category if the current `kind` does not clearly distinguish BOQ work from non-BOQ work.
- Keep `plot_phase_schedule` as a trade-level baseline and progress-curve input. Do not overload it with individual job scheduling.
- Apply grants and RLS changes alongside the migration. Keep construction-only role access consistent with current policies; sales must not gain access to construction job or cost information.

**Deliverable:** additive migration, generated/updated DB types if maintained, and server-side validation contract.

### Phase 2 — Provide valid BOQ work choices

- Extend `getWeeklyPlanData` (or add a focused loader) to load eligible job assignments for plots in the selected project and month, joined to `boq_master` for title, contractor type and quantity/unit, plus the current contractor assignment.
- Do not load every project/plot/job globally if the selected project and month can scope the query.
- When the user selects a project and plot, show only that plot's actual job assignments. If the plot has no BOQ jobs, explain that it needs BOQ jobs synced before BOQ work can be planned.
- Validate the submitted `job_assignment_id` on the server, including project/plot consistency and user authorization. Never trust a client-supplied BOQ title or trade as authoritative.

**Deliverable:** typed loader data and server validation for BOQ selection.

### Phase 3 — Revise the item editor and actions

- Replace the free-text title field for BOQ work with a searchable BOQ job selector. Display BOQ title, trade, quantity/unit, current job status, and assigned contractor where available.
- On BOQ selection, derive the title and contractor from the selected job assignment; show whether a planner may override the responsible owner/contractor and persist any permitted override explicitly.
- Keep a separate “non-BOQ work” path for DC, repair, inspection and other tasks. It may use a manual title, but must be visibly labeled as non-BOQ.
- Disable the existing cross-plot bulk copy for BOQ work unless it explicitly resolves a compatible job assignment for every selected plot. Different plots can have different BOQ rows even when labels look alike. Retain bulk creation for non-BOQ tasks if useful.
- Update create, batch-create and edit actions to accept a job assignment ID and derive the display title on the server. Add duplicate detection or warn before creating the same job/week allocation twice.
- On edit, prevent changing a plan row to a job assignment from another plot/project. Preserve current foreman ownership and write restrictions.

**Deliverable:** BOQ-aware editor and validated server actions; existing non-BOQ workflows remain usable.

### Phase 4 — Make the monthly view a coherent workload board

- Keep the month navigator aligned to calendar months and render all weeks overlapping that month. Current month weeks begin on Monday; label spillover days clearly.
- For each week, show planned BOQ work by trade/contractor with counts of plots/jobs, unassigned count, and progress/workload summary. Keep non-BOQ tasks in a separate group or clearly tagged.
- Let authorized planners add or move a BOQ job into a week from the monthly view, using the same validated editor/data model as the weekly page.
- Show conflicts such as a job assigned to multiple contractors, duplicate job/week rows, missing contractor, or a planned week outside its phase schedule. Treat phase schedule dates as advisory until business rules say they are hard constraints.
- Clicking a week opens the detailed weekly execution view with the same schedule rows and progress values.

**Deliverable:** monthly plan supports allocation and exception review rather than only summarizing free-text weekly rows.

### Phase 5 — Define weekly execution and progress behavior

- For BOQ rows, show BOQ work title, plot, trade, assigned contractor, planned week and the daily PLAN/ACTUAL values.
- Specify how weekly carry-forward works. If values are cumulative, initialize Monday's carry from the previous week's final actual and flag gaps where no prior actual exists; do not silently reset to zero.
- Distinguish work status from physical progress. Decide whether `status = done` is user-set or derived from 100% actual. Avoid contradictory states such as “done” with 40% actual.
- Preserve auditability for changes after a week is agreed: record who changed the allocation/progress and when, or keep an immutable agreed snapshot plus subsequent revision state.
- Continue showing relevant sales requests and target hints, but visually separate these signals from scheduled BOQ work.

**Deliverable:** weekly execution behavior and a stable meaning for PLAN, ACTUAL, carry and done.

### Phase 6 — Reporting, migration and rollout

- Update `getWeeklyPlanSummary`, dashboard counts and any exports so BOQ-linked work is counted once and non-BOQ work remains identifiable. Confirm whether dashboard counts mean tasks, job assignments or plots and label them accordingly.
- Backfill only clear historical matches. A match should require a plot and an unambiguous job assignment in that plot's house model; keep ambiguous/unmatched rows as non-BOQ with their existing title and history.
- Do not create new job assignments or alter BOQ quantities as a side effect of plan migration.
- Roll out additively: deploy schema first, then code that reads both old and new rows, then enable BOQ-linked entry, then optionally backfill clear historical rows.
- Monitor unmatched plan rows and invalid-link attempts after rollout. Provide a report to PMs to resolve remaining rows manually.

**Deliverable:** compatible rollout with reconciled counts and no lost plan history.

## 5. Code areas likely to change

- `supabase/migrations/`: additive FK/index/constraint and any progress/audit support.
- `actions/weekly-plan-actions.ts`: loader joins, input types, validation, create/update behavior and summaries.
- `components/weekly-plan/WeeklyPlanItemModal.tsx`: project/plot/job selection and separate non-BOQ mode.
- `components/weekly-plan/WeeklyPlanClient.tsx`: monthly workload board, BOQ labels, conflicts and week navigation.
- `lib/weekly-plan.ts`: date helpers and shared plan display/model utilities as needed.
- `actions/dashboard-week-actions.ts` and `app/dashboard/page.tsx`: update labels/count semantics if metric definitions change.
- Plot job assignment and BOQ actions only if validation requires a shared helper; avoid changing BOQ sync behavior as part of this UI revision.
- `plot_phase_schedule` actions/components only if the clarified business rules require advisory conflict presentation or synchronized date updates.

## 6. Acceptance criteria

- A BOQ-linked weekly plan row always resolves to a job assignment on the selected plot and the BOQ line for that plot's house model.
- Changing the plot or project cannot leave a stale BOQ/job assignment link.
- BOQ title, trade and quantity/unit shown in the plan are sourced from the database, not client-entered text.
- The same job assignment can be scheduled in the allowed number of weeks, with duplicate/overlap behavior matching the agreed scheduling rule.
- Monthly and weekly views show the same underlying plan allocations and progress.
- Non-BOQ work can still be planned and is distinguishable in views and dashboard summaries.
- Historical rows remain intact; only unambiguous links are backfilled.
- RLS and server actions continue to enforce admin/PM/foreman permissions, and sales cannot access construction plan or BOQ cost fields.
- Agreement, progress and completion indicators have a documented, non-contradictory meaning.

## 7. Recommended build order

1. Complete Phase 0 decisions and data report.
2. Implement the additive schema and validation (Phase 1).
3. Implement BOQ job loading and the revised editor/actions (Phases 2–3).
4. Implement the monthly workload board and weekly execution behavior (Phases 4–5).
5. Update reports, perform cautious backfill, and roll out (Phase 6).

This order establishes the data relationship before investing in a larger UI redesign, and keeps existing non-BOQ planning usable throughout the rollout.
