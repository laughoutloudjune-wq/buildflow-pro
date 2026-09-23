# BOQ Quantity Control — Implementation Plan

Handoff spec for implementing the material quantity-control feature. Written to be
executed top-to-bottom; each phase is independently shippable and has its own
acceptance criteria.

**Audience:** an engineer (or Claude Sonnet) implementing this in `buildflow-pro`.
**Status:** design approved 2026-09-15. No code written yet.

---

## 1. Goal, in one paragraph

Right now nobody can answer "we budgeted 200 bags of cement for this house — how many
have we actually bought?" The BOQ says what each house model *should* consume; purchase
orders and stock issues say what was *really* bought. Nothing joins the two. This feature
builds that join, puts it on its own page alongside the existing cost reports, and — most
importantly — puts the comparison in front of the owner at the moment they sign the
cheque, so overspending is caught before the money leaves.

## 2. Decisions already made (do not re-litigate)

| Decision | Choice | Why |
|---|---|---|
| What counts as "purchased" | ~~PO lines **and** stock issue-outs~~ **Superseded 2026-09-23 by MATERIAL_FLOW_PLAN.md Phase 4: consumption only (all `'out'` stock movements), purchases shown separately as "on order".** Once destination (Phase 1 of the material flow plan) lets a line be bought for house 101 *and* issued to house 101, adding PO lines and issue-outs together double-counts the same material. See `consumedQty()`/`totalUsedQty()` in `lib/procurement/boqControl.ts` for the resulting split: the cost-control rollup compares `consumedQty` (issued only) against the ceiling; the precommitment "would this push us over" checks at signing time still use `totalUsedQty` (ordered+issued) on purpose, so an over-order trips the warning before it ships. | There are 1,159 stock issue-outs (489 plot-tagged) vs ~28 plot-tagged app-created POs. PO-only would show houses supplied from the central store as under budget. |
| Control ceiling | BOQ qty **+ wastage %** per material | A bare-BOQ ceiling flags every cut-waste material (tile, rebar, cement) and turns red flags into noise. |
| Going over BOQ | Warn + **record a mandatory reason** | Site work must not stall while BOQ data is still incomplete, but the overspend needs an audit trail on the signed document. **Do not block the PO.** |
| Non-BOQ purchases | Explicit `is_outside_boq` flag on the PO | Common area, office supplies and machinery have no BOQ line; without a flag they pollute every variance. |
| Cost reports | Merged into the same page as tabs | Same scope picker, same question ("what did this batch cost vs what it should have"). Two entry points for one topic is worse than one. |

## 3. Data reality (checked against production 2026-09-15)

These numbers drive several design choices. Re-check before starting if significant time has passed.

- `boq_material_items` is **nearly empty**: 16 material lines across 9 of 161 `boq_master`
  job rows (15 house models). **The page will render empty tables until this is filled in.**
  This is expected — Phase 2 builds the importer that fixes it.
- **899 of 1,365** `material_types` still carry the placeholder unit `unit`. Quantities are
  meaningless without real units. Not a code problem, but set expectations.
- **219 of 321** POs carry no plot/batch tag (214 are from the historical Excel import).
  These can never be compared to a BOQ and must land in a visible "unassigned" bucket,
  never be silently dropped.
- Near-duplicate catalog names are **not** a real problem: only 2 normalized-name
  collision groups among the 490 materials used on POs. No canonical-material mapping needed.
- 90 plots, all with a `house_model_id`. 13 plot groups. 15 house models.

## 4. What already exists (reuse, don't rebuild)

| Piece | Location | Notes |
|---|---|---|
| Planned material per BOQ job | `boq_material_items` table | `(boq_id → boq_master, material_type_id, planned_quantity)`, unique on `(boq_id, material_type_id)` |
| Per-job editor for the above | `components/materials/BoqMaterialItemsModal.tsx` | Opened from `app/dashboard/boq/[id]/BOQDetailPageClient.tsx:456` |
| Ordered-qty rollup per project/plot | `actions/procurement/materials-summary.ts` | `getMaterialsSummaryForProject(projectId, {plotGroupId, plotIds})` — already handles all three PO plot-scope shapes |
| Planned-vs-actual math precedent | `getMaterialVarianceForJob` in `actions/material-actions.ts:863` | Compares against the *foreman's log*, not POs. Read it for the even-split convention and the "union of planned + actual material ids" handling. |
| Cost report (to be absorbed) | `components/reports/ProjectCostReportModal.tsx` | 209 lines, two tabs: materials + labor |
| Labor ledger | `actions/labor-budget-actions.ts`, `lib/labor-budget.ts` | `getLaborLedger(filters)`, `getLaborLedgerOptions()` |
| Payment voucher creation | `app/dashboard/procurement/receipts/ReceiptsPageClient.tsx` | Select unpaid receipts of one supplier → modal → `createPaymentVoucher()` |
| Page-with-filters pattern | `app/dashboard/reports/labor-budget/` | Server component fetches options + first result in one `Promise.all`, passes to a client component. **Follow this pattern.** |

### The chain that makes the join possible

```
plots.house_model_id → boq_master (house_model_id) → boq_material_items (boq_id) → material_types
purchase_orders (plot scope) → purchase_order_items → material_types
stock_movements (plot scope, type='out') → material_types
```

---

## 5. Core algorithm — read this before writing any code

### 5.1 Scope

Every number on this page is computed for a **scope**: a project, optionally narrowed to a
plot group (batch) or an explicit list of plots.

```ts
type ControlScope = {
  projectId: string
  plotGroupId?: string | null
  plotIds?: string[]        // explicit plot selection; wins over plotGroupId when non-empty
}
```

Resolve the scope to a concrete **plot set** first:
- `plotIds` non-empty → those plots
- else `plotGroupId` → that group's member plots (`plot_group_members`)
- else → all plots in the project

### 5.2 Planned (budget) side

```
planned_qty(material) =
  Σ over plots in scope
    Σ over boq_master rows where house_model_id = plot.house_model_id
      Σ boq_material_items.planned_quantity where material_type_id = material

allowance_qty(material) =
  same sum, but each term multiplied by (waste_percent / 100)
```

Each plot contributes its *whole* house model's BOQ. Two plots of the same model
contribute twice. `waste_percent` comes from `boq_material_items.waste_percent`, falling
back to `organization_settings.default_waste_percent` when the line is 0.

The ceiling shown to users is `planned_qty + allowance_qty`.

### 5.3 Purchased (actual) side — the allocation weight

A purchase can cover several houses. Define, for any purchase document:

```
document_plots =
  plot_id present            → [plot_id]
  plot_group_id present      → member plots of that group
  join-table rows present    → those plot_ids
  none of the above          → []   (unassigned)

weight = |document_plots ∩ scope_plots| / |document_plots|      (0 when document_plots is empty)
```

Then:

```
ordered_qty(material)  = Σ over PO lines  quantity_ordered  × weight
received_qty(material) = Σ over PO lines  quantity_received × weight
issued_qty(material)   = Σ over stock_movements (type='out') quantity × weight
```

**Why this rule:** it collapses to the obvious answers in every case. Whole-project scope →
weight 1 for every tagged PO. Exact-group scope → weight 1 for that group's POs. One plot
out of a 5-plot batch → weight 0.2, which is the even split the existing
`getMaterialVarianceForJob` already uses. One general rule, no special cases.

**Label it honestly in the UI.** When any contributing document has `weight < 1`, the row
is an estimate — show a small "เฉลี่ยจากกลุ่ม" marker. The true per-house split of a batch
purchase is unknowable.

### 5.4 Exclusions

- POs with `status = 'cancelled'` → excluded everywhere.
- POs with `is_outside_boq = true` → excluded from `ordered_qty`; shown in their own
  section with their reason, so the money is still visible.
- Purchases with `document_plots = []` → weight 0, so they fall out of every scoped row.
  They are surfaced separately by `boq_control_unassigned()` (§7.3).

### 5.5 Row status

```
total_used  = ordered_qty + issued_qty
ceiling     = planned_qty + allowance_qty
percent     = ceiling > 0 ? total_used / ceiling * 100 : null

status =
  planned_qty === 0 && total_used > 0  → 'not_in_boq'   (grey)   ไม่มีใน BOQ
  percent === null                      → 'no_budget'   (grey)
  percent > 100                         → 'over'        (red)    เกิน BOQ
  percent >= 90                         → 'watch'       (amber)  ใกล้เต็ม
  otherwise                             → 'ok'          (green)
```

`not_in_boq` rows must still appear — a material bought but never budgeted is exactly the
thing this page exists to surface. Follow the existing "union of planned + actual material
ids" approach in `getMaterialVarianceForJob`.

---

## 6. Phase 1 — Database

One migration: `supabase/migrations/2026MMDD0001_boq_qty_control.sql`.
Follow the house style in existing migrations: a comment block at the top explaining *why*,
`if not exists` / `create or replace` throughout so it is re-runnable.

### 6.1 Schema changes

```sql
-- Wastage allowance: the control ceiling is BOQ + allowed waste, not the bare
-- BOQ quantity, or every cut-waste material (tile, rebar, cement) reads as over.
alter table public.boq_material_items
  add column if not exists waste_percent numeric not null default 0;

alter table public.organization_settings
  add column if not exists default_waste_percent numeric not null default 0;

-- Purchases with no BOQ counterpart (common area, office, machinery). Without
-- this flag they inflate every variance on the control page.
alter table public.purchase_orders
  add column if not exists is_outside_boq boolean not null default false;
alter table public.purchase_orders
  add column if not exists outside_boq_reason text;

-- The audit trail that makes this a control rather than a report: when an owner
-- signs off on an over-BOQ line, the reason is recorded and printed on the PO.
create table if not exists public.po_boq_overrides (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  material_type_id bigint not null references public.material_types(id),
  planned_quantity numeric not null default 0,
  total_after_this_po numeric not null default 0,
  reason text not null,
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  unique (purchase_order_id, material_type_id)
);

create index if not exists po_boq_overrides_po_idx
  on public.po_boq_overrides (purchase_order_id);
create index if not exists purchase_order_items_material_idx
  on public.purchase_order_items (material_type_id);
create index if not exists boq_material_items_material_idx
  on public.boq_material_items (material_type_id);
create index if not exists stock_movements_material_idx
  on public.stock_movements (material_type_id, type);
```

RLS on `po_boq_overrides`: follow the procurement module's pattern — `enable row level
security`, a `for select to authenticated using (true)` policy, `grant select to
authenticated`, and **no** insert/update policy (writes go through the RPC below).
Do not grant anything to `anon` (see `202609140001_billing_anon_revoke.sql` for why).

### 6.2 The rollup function

```sql
create or replace function public.boq_control_rollup(
  p_project_id uuid,
  p_scope jsonb default '{}'::jsonb
)
returns table (
  material_type_id bigint,
  material_name text,
  unit text,
  planned_qty numeric,
  allowance_qty numeric,
  ordered_qty numeric,
  received_qty numeric,
  issued_qty numeric,
  ordered_value numeric,
  received_value numeric,
  is_estimated boolean      -- true when any contributing document had weight < 1
)
language sql
security definer
set search_path = public
as $$ ... $$;
```

`p_scope` shape: `{"plot_group_id": "<uuid>|null", "plot_ids": ["<uuid>", ...]}`.
Empty object → whole project.

Implementation sketch (CTEs):
1. `scope_plots` — resolve per §5.1.
2. `planned` — `scope_plots` → `plots.house_model_id` → `boq_master` → `boq_material_items`,
   grouped by `material_type_id`, summing `planned_quantity` and
   `planned_quantity * coalesce(nullif(waste_percent,0), (select default_waste_percent from organization_settings limit 1)) / 100`.
3. `po_scope` — for each non-cancelled, non-`is_outside_boq` PO in the project, expand its
   plot scope (union of the three shapes) and compute `weight` per §5.3.
4. `ordered` — `po_scope` ⋈ `purchase_order_items`, grouped by material.
5. `issued` — `stock_movements` where `type='out'` and project matches, same weight rule,
   grouped by material.
6. `full outer join` planned/ordered/issued on `material_type_id`, join `material_types`
   for name and unit, `coalesce` every numeric to 0.

**Grant:** `revoke execute on function public.boq_control_rollup(uuid, jsonb) from anon;`
then `grant execute ... to authenticated;` — matches
`202608180003_revoke_anon_execute_on_rpcs.sql`.

Do this as one SQL function rather than several PostgREST fetches. The planned side alone
spans plots → house_models → boq_master → boq_material_items across up to 90 plots; four
round trips for one table is exactly the pattern the perf work removed.

### 6.3 Supporting functions

```sql
-- Contributing documents for one material, for the expanded row. Returns PO and
-- PR lines plus stock issues, each with its own weight so the UI can show the split.
create or replace function public.boq_control_material_detail(
  p_project_id uuid, p_material_type_id bigint, p_scope jsonb default '{}'::jsonb
) returns table (
  doc_kind text,          -- 'po' | 'pr' | 'stock_out'
  doc_id uuid,
  doc_no text,
  doc_date date,
  supplier_name text,
  plot_label text,        -- 'แปลง 98' | 'กลุ่ม 98-102' | 'ไม่ระบุแปลง'
  quantity numeric,       -- raw quantity on the document
  weight numeric,         -- allocation weight into the current scope
  status text
) language sql security definer set search_path = public as $$ ... $$;

-- Purchases in the project that carry no plot tag at all. Never folded into a
-- house's number; shown as its own section so the spend stays visible.
create or replace function public.boq_control_unassigned(p_project_id uuid)
returns table (
  material_type_id bigint, material_name text, unit text,
  ordered_qty numeric, ordered_value numeric, po_count int
) language sql security definer set search_path = public as $$ ... $$;

-- Records the owner's sign-off on an over-BOQ line. PM/admin only.
create or replace function public.po_boq_override_set(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$ ... $$;
```

`po_boq_override_set` payload: `{purchase_order_id, material_type_id, planned_quantity,
total_after_this_po, reason}`. It must:
- reject when `auth.uid()` is null (`errcode 42501`)
- reject when `public._billing_current_role()` is not in `('pm','admin')`
- reject an empty `reason`
- upsert on the `(purchase_order_id, material_type_id)` unique key, stamping
  `approved_by = auth.uid()` and `approved_at = now()`

### 6.4 PO create/update changes

`po_create` and `po_update` must accept `is_outside_boq` and `outside_boq_reason`.
Postgres has no partial function replace, so **copy the current definitions verbatim from
`supabase/migrations/202609120001_supplier_branches.sql`** (the latest definition of both)
and add only the two new fields to the insert/update lists. Say so in the migration's
comment header — every previous migration that touched these functions does.

### 6.5 Acceptance criteria

- Migration applies cleanly twice in a row.
- `select * from boq_control_rollup('<project uuid>', '{}')` returns rows; a material with
  BOQ lines but no purchases shows `ordered_qty = 0`, and one purchased but never budgeted
  shows `planned_qty = 0`.
- Narrowing `p_scope` to one plot of a 5-plot batch yields exactly 1/5 of that batch PO's quantity.
- `anon` cannot execute any of the new functions.

---

## 7. Phase 2 — BOQ material entry at scale

Without this the page is empty. Build it before the page so there is real data to design against.

### 7.1 `components/materials/BoqMaterialImportModal.tsx`

Model it on the existing `components/materials/MaterialImportModal.tsx` (same `xlsx`
parsing, same preview-then-commit shape, same chunked writes).

Accepted columns (Thai or English headers):
`house model | boq job | material | quantity | waste %`

Resolution rules — **these are not optional, they come from a prior import that nearly
duplicated 850 line items:**
- Resolve `material_types` by name with **exact match first, normalized match only as a
  fallback**. Never a blanket normalize-then-join. The working pattern is
  `coalesce(mt_exact.id, mt_norm.id)` where `mt_norm` is joined only when `mt_exact.id is
  null`, normalizing with `lower(translate(name, chr(215)||'X*', 'xxx'))`.
- A material name that resolves to nothing is reported in the preview as a skipped row with
  its line number — never silently created.
- `(boq_id, material_type_id)` is unique, so committing is an upsert on that key.

The preview must show, before anything is written: rows to insert, rows to update, rows
skipped and why.

### 7.2 House-model-level editor

Add a "วัสดุทั้งแบบบ้าน" view to `app/dashboard/boq/[id]/BOQDetailPageClient.tsx`: one grid
of every material across all of that model's BOQ jobs, editable inline, with the wastage %
column. Opening 11 separate job modals to enter a house's materials is the reason the
existing table is empty.

New actions in `actions/material-actions.ts`, next to the existing
`addBoqMaterialItem` / `updateBoqMaterialItem` / `deleteBoqMaterialItem`:

```ts
export async function getBoqMaterialsForHouseModel(houseModelId: string): Promise<{
  boqId: string; boqItemName: string
  items: (BoqMaterialItem & { waste_percent: number })[]
}[]>

export async function bulkUpsertBoqMaterialItems(rows: {
  boqId: string; materialTypeId: number; plannedQuantity: number; wastePercent: number
}[]): Promise<{ inserted: number; updated: number }>
```

Both gated with `requireAuthRole(['admin', 'pm'])`, matching the existing BOQ material actions.

### 7.3 Acceptance criteria

- Importing a sheet of ~100 rows for one house model produces the right counts and
  zero unresolved materials, or names every unresolved row in the preview.
- Re-importing the same sheet updates rather than duplicating.
- The house-model grid round-trips: edit a quantity, reload, value persists.

---

## 8. Phase 3 — The cost control page

### 8.1 Where it lives

New sidebar section of its own, because it now covers three topics (quantity, material
cost, labour cost) and is aimed at the owner rather than at purchasing staff.

- Route: `app/dashboard/cost-control/`
- Sidebar: new section `ควบคุมต้นทุน` in `components/layout/Sidebar.tsx`, icon `Scale` or
  `GaugeCircle` from `lucide-react`
- Title: add `['/dashboard/cost-control', 'ควบคุมต้นทุน']` to `lib/dashboard-page-titles.ts`

### 8.2 New permission module

Add `cost_control` to `PermissionModule` in `lib/permissions.ts`:

```ts
export type PermissionModule = 'projects' | 'boq' | 'contractors' | 'foreman'
  | 'billing' | 'reports' | 'settings' | 'materials' | 'procurement' | 'cost_control'
```

Defaults in `DEFAULT_ROLE_PERMISSIONS`: `admin: true`, `pm: true`, `foreman: false`.
Add a label in `app/dashboard/settings/permissions/PermissionSettingsPageClient.tsx`:

```ts
cost_control: { title: 'ควบคุมต้นทุน', description: 'เทียบ BOQ กับของที่ซื้อจริง และรายงานต้นทุนโครงการ' },
```

**No migration needed** — `role_permissions` is jsonb and `normalizeRolePermissions` fills
any missing key from `DEFAULT_ROLE_PERMISSIONS`.

### 8.3 Permission plumbing (important)

The page pulls from actions gated on three different modules:
`getMaterialsSummaryForProject` requires `procurement`, `getLaborLedger` requires `reports`,
the new rollup will require `cost_control`. A PM has all three; a user granted only
`cost_control` would hit a `redirect()` thrown from inside a server action — an ugly failure.

Fix it properly: let `requireModuleAccess` accept several modules and pass if **any** is allowed.

```ts
// lib/auth/route-access.ts
export async function requireModuleAccess(moduleKey: PermissionModule | PermissionModule[]) {
  const { user, role, permissions } = await getDashboardSession()
  if (!user) redirect('/login')
  const keys = Array.isArray(moduleKey) ? moduleKey : [moduleKey]
  if (!keys.some((k) => canRoleAccessModule(role, k, permissions))) redirect('/dashboard')
  return { user, role, permissions }
}
```

Then widen exactly two existing gates:
- `getMaterialsSummaryForProject` → `['procurement', 'cost_control']`
- `getLaborLedger` and `getLaborLedgerOptions` → `['reports', 'cost_control']`

Every other call site is unaffected (a single string still works).

### 8.4 Files

```
lib/procurement/boqControl.ts            — pure types + status/percent helpers, no I/O
actions/procurement/boq-control.ts       — server actions wrapping the RPCs
app/dashboard/cost-control/layout.tsx    — requireModuleAccess('cost_control')
app/dashboard/cost-control/page.tsx      — server component, reads searchParams
app/dashboard/cost-control/CostControlPageClient.tsx
components/cost-control/QtyControlTab.tsx
components/cost-control/MaterialCostTab.tsx   — lifted from ProjectCostReportModal
components/cost-control/LaborCostTab.tsx      — lifted from ProjectCostReportModal
components/cost-control/ScopePicker.tsx
```

`lib/procurement/boqControl.ts` holds the row type and the status math from §5.5 as pure
functions, so the same logic serves the page, the PO panel and the payment modal without
duplication. Keep it I/O-free — it is the one piece worth unit-testing directly.

```ts
export type BoqControlRow = {
  materialTypeId: number
  materialName: string
  unit: string
  plannedQty: number
  allowanceQty: number
  orderedQty: number
  receivedQty: number
  issuedQty: number
  orderedValue: number
  receivedValue: number
  isEstimated: boolean
}
export type BoqControlStatus = 'ok' | 'watch' | 'over' | 'not_in_boq' | 'no_budget'
export function ceilingQty(row: BoqControlRow): number
// totalUsedQty (ordered+issued) drives the precommitment "would this push us
// over" checks at signing time; consumedQty (issued only) is what the
// cost-control rollup itself compares against the ceiling - added Phase 4 of
// MATERIAL_FLOW_PLAN.md, see the decisions table above.
export function totalUsedQty(row: BoqControlRow): number
export function consumedQty(row: BoqControlRow): number
export function percentUsed(row: BoqControlRow): number | null
export function rowStatus(row: BoqControlRow): BoqControlStatus
```

Server actions:

```ts
// actions/procurement/boq-control.ts
export async function getBoqControl(scope: ControlScope): Promise<{
  rows: BoqControlRow[]
  unassigned: { materialTypeId: number; materialName: string; unit: string
                orderedQty: number; orderedValue: number; poCount: number }[]
  outsideBoq: { poId: string; poNo: string; reason: string | null; total: number }[]
}>

export async function getBoqControlMaterialDetail(
  scope: ControlScope, materialTypeId: number
): Promise<BoqControlDetailRow[]>

export async function getCostControlOptions(): Promise<{
  projects: { id: string; name: string }[]
  plotGroups: { id: string; name: string; project_id: string }[]
  plots: { id: string; name: string; project_id: string }[]
}>
```

### 8.5 Page behaviour

`page.tsx` reads scope and tab from `searchParams` (`?project=&group=&plots=a,b&tab=`) and
fetches options plus the first tab's data in a single `Promise.all`, exactly as
`app/dashboard/reports/labor-budget/page.tsx` does. Scope lives in the URL so the project
page and plot-group manager can deep-link into it (§8.7).

Three tabs:

| Tab key | Label | Content |
|---|---|---|
| `qty` | คุมปริมาณวัสดุ | The new table (default tab) |
| `material-cost` | ต้นทุนวัสดุ | Lifted from `ProjectCostReportModal`'s materials tab |
| `labor-cost` | ต้นทุนค่าแรง | Lifted from `ProjectCostReportModal`'s labor tab |

Hide `labor-cost` when the session lacks both `reports` and `cost_control` — pass a
`canSeeLabor` boolean down from the server component; never call the action when it is false.

Summary tiles above the tabs (always visible, all scopes):
1. `รายการเกิน BOQ` — count of `status === 'over'`
2. `มูลค่าส่วนเกิน` — Σ over over-rows of `(totalUsed − ceiling) × unit price`
3. `วัสดุที่รับแล้ว` — `Σ receivedValue` (from the existing cost report)
4. `ค่าแรงที่อนุมัติแล้ว` — `Σ entry.approved` (from the existing cost report)
5. `ยังไม่ระบุแปลง` — Σ unassigned value, with a link to that section

Keep the existing disclaimer line from the cost modal — other costs (machinery, transport)
still are not tracked anywhere.

**Quantity tab table:**

| วัสดุ | หน่วย | BOQ | เผื่อ | รวมงบ | สั่งซื้อ | เบิกสต็อก | ใช้จริง | คงเหลือ | % | สถานะ |

- Row click expands to `getBoqControlMaterialDetail` — contributing POs, PRs and stock
  issues with number, date, supplier, plot label, quantity, weight, and a link to the document.
- The expanded panel also lists which BOQ jobs made up the planned figure, so a wrong
  number can be traced to the line that caused it.
- Filter chips: `ทั้งหมด` / `เกิน BOQ` / `ใกล้เต็ม` / `ไม่มีใน BOQ`, plus a material search box.
- An `เฉลี่ยจากกลุ่ม` marker on any row where `isEstimated` is true.
- Two collapsed sections below the table: `ซื้อนอก BOQ` and `ยังไม่ระบุแปลง`.
- Export to Excel via the existing `xlsx` dependency.

### 8.6 Styling conventions

Use `Card`, `Button`, `PageHeader`, `Modal`, `useToast` from `components/ui/`. Match the
Tailwind vocabulary already in `ReceiptsPageClient.tsx` and `ProjectCostReportModal.tsx`
(`text-slate-*`, `rounded-2xl`, `border-slate-200`). Status colours: emerald ok, amber
watch, red over, slate not-in-BOQ. All user-facing copy in Thai.

### 8.7 Retiring `ProjectCostReportModal`

Two call sites open it today:
- `app/dashboard/projects/[id]/ProjectDetailPageClient.tsx:333` — whole-project scope
- `components/plots/PlotGroupManager.tsx:270` — one plot group

Replace both buttons with links into the new page:

```tsx
// whole project
<Link href={`/dashboard/cost-control?project=${projectId}`}>รายงานต้นทุน</Link>
// one plot group
<Link href={`/dashboard/cost-control?project=${projectId}&group=${group.id}`}>รายงานต้นทุน</Link>
```

Then **delete `components/reports/ProjectCostReportModal.tsx`** and remove the now-unused
state (`isCostReportOpen`, `costReportGroup`) from both call sites. Do not leave the modal
behind as a second way to reach the same numbers.

### 8.8 Acceptance criteria

- `/dashboard/cost-control?project=<id>` renders all three tabs with real data.
- Switching scope to a plot group changes both quantity and cost numbers consistently.
- A foreman account is redirected away; a PM sees everything.
- The project page and plot-group manager link into the page with the correct scope preselected.
- `ProjectCostReportModal.tsx` no longer exists and nothing imports it.

---

## 9. Phase 4 — The owner's check at signing time

This is the point of the feature. The check appears at three moments, all driven by one
shared component.

> **Reading of the requirement:** "integrate some of the functions in the receipt inventory
> page when creating the payment" is implemented as §9.3 — the BOQ check appears inside the
> สร้างใบสำคัญจ่าย modal on the goods-receipts page, because that is where the cheque is
> actually cut. If the intent was the reverse (raising receipts/payments *from* the control
> page), that is a different and smaller change — confirm before building.

### 9.1 `components/procurement/BoqCheckPanel.tsx`

```tsx
type BoqCheckLine = {
  materialTypeId: number
  materialName: string
  unit: string
  plannedQty: number      // BOQ + allowance for this document's own plot scope
  alreadyQty: number      // ordered + issued before this document
  thisDocQty: number      // this PO / this payment's share
  totalAfter: number      // alreadyQty + thisDocQty
}

type Props = {
  lines: BoqCheckLine[]
  scopeLabel: string                       // 'กลุ่มแปลง 98-102'
  /** Omit to render read-only (print, PR preview). */
  onAcknowledge?: (overrides: { materialTypeId: number; reason: string }[]) => Promise<void>
  existingOverrides?: { materialTypeId: number; reason: string; approvedBy: string; approvedAt: string }[]
  isSaving?: boolean
}
```

Behaviour:
- Collapsed, green, one summary line when every line is within budget. It must not slow
  down the normal case.
- Expanded with a red banner (`เกิน BOQ N รายการ`) when any line is over.
- Columns: `วัสดุ | BOQ ตามแบบ | ซื้อไปแล้ว | ใบนี้ | รวมทั้งหมด | เกิน/เหลือ`.
- Each over-budget line gets a required reason textarea. `รับทราบ - อนุมัติเกิน BOQ` stays
  disabled until every over line has a non-empty reason.
- When `existingOverrides` covers a line, show who approved it and when instead of the input.
- Read-only mode (no `onAcknowledge`) renders the same table without inputs.

### 9.2 On the purchase order

Insert into `app/dashboard/procurement/orders/[id]/PurchaseOrderDetailPageClient.tsx`
between the milestones block and `<PurchaseOrderForm>` (around line 186).

Data comes from a new action:

```ts
export async function getBoqCheckForPurchaseOrder(poId: string): Promise<{
  lines: BoqCheckLine[]
  scopeLabel: string
  isOutsideBoq: boolean
  existingOverrides: {...}[]
}>
```

It derives the scope from the PO's own plot tag, restricts materials to those on the PO,
and computes `alreadyQty` as the scope total *excluding this PO*.

When `is_outside_boq` is true, render a neutral notice with the reason instead of the
comparison. Add an `ซื้อนอก BOQ` toggle + reason field to
`components/procurement/PurchaseOrderForm.tsx`, wired through `PurchaseOrderInput` to the
updated `po_create` / `po_update`.

`รับทราบ` calls `po_boq_override_set` once per over-budget material.

### 9.3 On the payment voucher (the cheque)

In `app/dashboard/procurement/receipts/ReceiptsPageClient.tsx`, inside the existing
`สร้างใบสำคัญจ่าย` modal, between the receipt list and the วันที่จ่าย field.

```ts
export async function getBoqCheckForReceipts(receiptIds: string[]): Promise<{
  perPo: { poId: string; poNo: string; scopeLabel: string; lines: BoqCheckLine[] }[]
  overCount: number
}>
```

The selected receipts already belong to one supplier but may span several POs, so group by
PO and render one `BoqCheckPanel` per PO, each labelled with its PO number and plot scope.
`thisDocQty` here is the **received** quantity on the selected receipts, not the ordered
quantity — the cheque pays for what arrived.

`บันทึกการจ่ายเงิน` stays enabled throughout (decision §2: warn, never block), but when
`overCount > 0` the button label becomes `บันทึกการจ่ายเงิน (เกิน BOQ)` and any reasons
entered are written via `po_boq_override_set` before `createPaymentVoucher` is called. If an
override write fails, surface the error and do not create the voucher.

### 9.4 On the purchase request and the printed PO

- `components/procurement/PurchaseRequestDetail.tsx` — read-only `BoqCheckPanel` using the
  PR's own plot scope and `originalQuantityRequested` from
  `lib/procurement/requestQuantities.ts` as `thisDocQty`. Catching an over-BOQ ask here is
  far cheaper than catching it at the cheque.
- `lib/pdf/purchaseOrderHtml.ts` — render the same table (plus any recorded override reason
  and approver) so the paper being signed carries the same numbers as the screen.

### 9.5 Acceptance criteria

- A PO whose quantity exceeds its plots' BOQ shows the red banner; the acknowledge button
  is disabled until a reason is typed; after saving, the reason and approver are visible on
  reload and on the printed PO.
- A PO marked `ซื้อนอก BOQ` shows the neutral notice, and its quantities are absent from the
  control page's rollup.
- Creating a payment voucher from receipts spanning two POs shows two panels with correct
  per-PO scope labels.
- A fully in-budget PO shows one collapsed green line and nothing else.

---

## 10. Phase 5 — Guardrails going forward

- **Require a plot scope on new POs** unless `is_outside_boq` is set. Enforce in
  `po_create` / `po_update` (raise with `errcode 22023`) and in
  `components/procurement/PurchaseOrderForm.tsx`. This closes the untagged-PO hole for all
  future orders; the 214 historical imports stay as they are.
- **Warn at PO save time** when a line pushes a material past its ceiling, so the buyer sees
  it before the owner does.

---

## 11. Phase 6 — Tests

Extend the Playwright suite in `tests/`:
1. Set a BOQ material quantity on a house model → raise a PO for a plot of that model
   exceeding it → assert the red banner appears and the acknowledge button is disabled.
2. Type a reason → acknowledge → reload → assert the override is displayed.
3. Mark a PO `ซื้อนอก BOQ` → assert its quantity is absent from the control page.
4. Unit-test `lib/procurement/boqControl.ts` status/percent helpers directly.

---

## 12. Suggested order of work

| Step | Scope | Rough effort |
|---|---|---|
| 1 | Phase 1 migration | 0.5 day |
| 2 | Phase 2 importer + house-model grid | 1 day |
| — | *Load one real house model's BOQ materials before continuing* | (yours) |
| 3 | Phase 3 page, tabs, retire the modal | 1.5 days |
| 4 | Phase 4 check panel in all four places | 1 day |
| 5 | Phases 5–6 guardrails + tests | 1 day |

Phase 0 — fixing units on the ~100–150 materials that will appear in BOQs, then entering
the BOQ material lists — is the long pole and runs in parallel from the end of step 2.

## 13. Risks

- **The BOQ data is the project.** If the material lists never get filled in, every table on
  this page is empty and the PO panel has nothing to compare against. Build steps 1–2 first
  and load one real house model before designing the table.
- **Batch allocation is an estimate.** The per-house split of a batch purchase is genuinely
  unknowable; the even split must stay visibly labelled, never presented as fact.
- **Units.** 899 of 1,365 materials carry the placeholder unit `unit`. A BOQ in ถุง compared
  against purchases in unit is a wrong number that looks right. Consider blocking a material
  from BOQ entry until it has a real unit.
- **Historical POs.** 214 imported POs have no plot tag and will sit permanently in the
  unassigned bucket. That is correct behaviour, not a bug — say so in the UI copy.

## 14. Conventions to follow

- Server actions in `actions/`, `'use server'` at the top, gated with `requireModuleAccess`
  or `requireAuthRole`, `revalidatePath` after writes.
- Multi-table writes go through a `security definer` RPC so they are atomic, with the role
  check repeated inside the function as defence in depth. Single-table writes go direct.
- Money and quantities are recomputed server-side; never trust a total sent by the client.
- PostgREST types embedded relations as `T | T[]` — narrow with the `asSingle` helper that
  already exists in `actions/material-actions.ts` and `actions/labor-budget-actions.ts`.
- Migrations: comment header explaining *why*, `if not exists` / `create or replace`,
  re-runnable, revoke `anon` on every new function.
- User-facing copy in Thai; code comments in English.
- Explain *why* in comments, not *what* — match the density of the existing migrations.
