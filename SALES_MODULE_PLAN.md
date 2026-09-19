# Sales Module — Implementation Plan

Handoff spec for adding a sales/real-estate section to `buildflow-pro` and wiring it to the
existing construction side. Same shape as `BOQ_CONTROL_PLAN.md`: executable top-to-bottom,
each phase independently shippable with its own acceptance criteria.

**Audience:** an engineer (or Claude Sonnet) implementing this.
**Status:** design approved 2026-09-17. No code written yet. The four scope decisions are
locked — see §11. Do not re-litigate them.

---

## 1. Goal, in one paragraph

Today the sales team tracks plots in Excel and on paper, and the construction team has no
idea which houses are sold, when they were promised, or what the customer asked for. This
module gives sales its own section — a colour-coded board of every plot with its sale
status (จอง / ทำสัญญา / รอโอน / รอตรวจบ้าน …), a customer record and a full sale history —
and hangs it off the same `plots` rows construction already uses. Because it is the *same*
plot row, clicking a plot shows both sides at once: who bought it and for how much, next to
which BOQ jobs are done, which materials landed, and what the house actually cost to build.
Sales can also file work requests against a plot (customer extras, defect fixes, "must be
ready before the 15th") and the construction team gets them in a queue instead of a LINE message.

## 2. The one architectural decision everything else follows from

**Do not build a parallel sales database. The `plots` row *is* the join.**

`plots` is already the spine of the whole system:

```
plots ──┬── job_assignments (labour, one per BOQ line) ── billing_jobs.progress_percent
        ├── purchase_order_plots  → purchase_order_items → material_types
        ├── purchase_request_plots
        ├── stock_movements (plot-tagged issue-outs)
        ├── billings.plot_id (164 rows today — what this house has cost in labour)
        └── plot_group_members → plot_groups (the batch / เฟส)
```

Sales adds one more branch — `plot_sales` — off that same row. One physical house = one
`plots` row = one sales record = one construction record. Every "link with construction"
requirement in the brief is then a join, not an integration.

The alternative (a separate `units` table that sales owns, synced to `plots`) is how most
teams get this wrong. It guarantees two lists of houses that drift, and the margin report —
the single most valuable thing this module unlocks — becomes impossible.

## 3. What the research says (and what to copy vs. ignore)

| Pattern found in the market | Verdict for BuildFlow |
|---|---|
| Colour-coded availability board: green/amber/red for available/reserved/sold (redbriQ, Property xRM, UnitAtlas) | **Copy.** It is the industry's default first screen and it is what the brief asks for. |
| Pipeline stages that include **loan status** — generic B2B CRM pipelines omit it and fail in Thai property (OurGreenfish) | **Copy.** ยื่นกู้ / รออนุมัติสินเชื่อ must be its own stage, not a note. |
| The Thai sale sequence: จอง → ทำสัญญาจะซื้อจะขาย → ยื่นกู้ → นัดโอน → โอนกรรมสิทธิ์, 30–60 days (SW19) | **Copy as the seeded status list.** Add รอตรวจบ้าน / แก้ Defect before โอน — that is where developer-built houses actually stall. |
| Buyer selections / option catalogues, budget-aware, auto-drafting change orders (Buildertrend, ECI) | **Adapt, don't copy.** The full design-centre model is too heavy. Take the useful half: a sales→construction *work request* that can become a DC (งานเพิ่ม-ลด), which this app already has a flow for. |
| Buyer portal showing construction progress + payment schedule (PropFlo, PLOY by BUILK) | **Defer.** Customer-facing login is a separate product decision. Internal first. |
| Installment schedules with reminders, digital receipts (PLOY PAYMENT, Ascendix) | **Copy — confirmed in scope (D1).** Phase 7 builds เงินจอง / เงินทำสัญญา / งวดผ่อนดาวน์ with due dates, an overdue list and printed receipts. |
| Interactive site plan (ผังโครงการ) with clickable plots | **Copy — promoted to Phase 4 (D4).** Colour-coded plots on the real project plan, which is how the sales office already thinks and what a walk-in customer expects to be shown. |

The thing none of the off-the-shelf products do, because they are not also the construction
system: **sale price minus real build cost, per house.** BuildFlow already knows material cost
and labour cost per plot (`/dashboard/cost-control`). Adding the sale price finishes the
sentence. Lead the pitch with this.

## 4. Data reality — checked against production 2026-09-17

Re-check before starting if significant time has passed.

- **90 plots across 7 projects.** Names are house numbers (`100`, `101`, `A1`…).
- **Not every plot is a sellable house.** Two are `ส่วนกลาง` (common area), one is `ที่รอรถ`,
  and several are *ranges* — `25-29`, `42-45` in Arada Prime — i.e. construction batches, not
  houses. A sales board that lists these is immediately wrong. Needs an `is_sellable` flag (Phase 0).
- **`progress_logs` and `inspections` are empty tables — 0 rows, and no code reads them.**
  Do not build progress on them. They are dead schema.
- **Real construction progress lives in two places:**
  - `job_assignments.status` — 962 `pending`, 136 `in_progress`, 171 `completed` (all 90 plots
    have jobs; ~14 jobs per plot). Coarse but complete.
  - `billing_jobs.progress_percent` — 268 rows, written when a foreman bills for a job.
    Finer and money-anchored, but only exists for jobs that have been billed.

  Show both: a job count ("งานเสร็จ 12/34") and a money-weighted %.
- **164 of 287 `billings` carry a `plot_id`** — that is the per-house labour spend, already usable.
- **`boq_material_items` still has only 16 rows** (see `BOQ_CONTROL_PLAN.md` §3). The material
  side of the plot detail will look thin until BOQ material data is filled in. Expected; say so
  to the user rather than letting them think it is broken.
- **`profiles.role` CHECK allows `admin, pm, foreman, accountant`** — but TypeScript's `UserRole`
  is only `'admin' | 'pm' | 'foreman'`. See §6: this is a live landmine.
- **No customer data exists anywhere in the database.** Sales history for already-sold houses
  will have to be typed in or imported from the team's spreadsheet. Plan a CSV import (Phase 2.5).

## 5. What already exists — reuse, don't rebuild

| Piece | Location | Use it for |
|---|---|---|
| Plot detail page | `app/dashboard/projects/[id]/[plotId]/` (374-line client) | Extend with tabs. Do **not** build a second plot page. |
| Jobs + contractor + payments per plot | `getJobAssignments(plotId)` — `actions/job-actions.ts:25` | The labour tab. |
| Material ordered/issued per plot | `getMaterialsSummaryForProject(projectId, {plotIds})` — `actions/procurement/materials-summary.ts` | The material tab. Already handles all three PO plot-scope shapes. |
| BOQ planned vs purchased | `getBoqControl(scope)` — `actions/procurement/boq-control.ts` | "What has been done/bought on this plot" against the BOQ. |
| Labour cost per plot | `getLaborLedger(filters)` — `actions/labor-budget-actions.ts` | Cost side of the margin report. |
| Scope picker (project → group → plots) | `components/cost-control/ScopePicker.tsx` | Same control on the sales board. |
| Server-fetch-then-client-render page pattern | `app/dashboard/cost-control/page.tsx` | **Follow this exactly.** One `Promise.all`, URL-driven state. |
| Multi-module route gate | `requireModuleAccess(['projects','sales'])` — array form already supported, `lib/auth/route-access.ts:98` | Letting sales read the plot page without granting `projects`. |
| Permission matrix | `lib/permissions.ts` + `organization_settings.role_permissions` (jsonb, TS-side defaults) | Adding a `sales` module needs **no migration**, same as `cost_control`. |
| Doc numbering counters | `purchase_order_number_counters`, `goods_receipt_number_counters` | `SR-YYYYMMDD###` for work requests; receipt numbers for Phase 5. |
| PDF printing + signature slots | `lib/pdf/`, `document_signature_slots` | Booking form / receipt printing. |
| In-app notifications | `notifications` table + `components/layout/NotificationBell.tsx` | Telling construction a sales request arrived. |
| DC / extra-work flow | `app/dashboard/foreman/create-dc/`, `billings.type` + `reason_for_dc` | Turning a chargeable customer extra into money. |

## 6. Roles and permissions — read this before touching anything

Adding a `sales` role is **not** a one-line change. The role string is validated or coerced in
seven places, and five of them silently fall back to `'foreman'`:

| File | Line | What it does |
|---|---|---|
| `lib/auth/route-access.ts` | 72 | `rawRole === 'admin' \|\| 'pm' \|\| 'foreman' ? rawRole : 'foreman'` |
| `actions/_shared/user-role.ts` | 50 | same coercion |
| `actions/auth-actions.ts` | 17, 34 | same coercion, twice |
| `actions/settings-actions.ts` | 45 | same coercion |
| `actions/settings-actions.ts` | 264 | `updateUserRole(userId, newRole: 'admin'\|'pm'\|'foreman')` |
| `app/dashboard/settings/users/UsersPageClient.tsx` | 44, 192 | role dropdown, hardcoded union |
| `lib/types/billing.ts` | 1 | `export type UserRole = 'admin' \| 'pm' \| 'foreman'` |

**If you add `sales` to the DB CHECK constraint and forget these, a sales user logs in and
becomes a foreman with foreman permissions, with no error anywhere.** That is the single most
likely way to break this module.

Note also that `accountant` is already allowed by the DB constraint but missing from every one
of those lists — so an accountant profile is *already* being silently downgraded to foreman.
Fix both roles in the same pass.

The cleanest shape: replace the seven inline unions with one exported guard.

```ts
// lib/types/billing.ts
export type UserRole = 'admin' | 'pm' | 'foreman' | 'accountant' | 'sales'
export const USER_ROLES = ['admin', 'pm', 'foreman', 'accountant', 'sales'] as const
export function toUserRole(value: unknown): UserRole {
  return (USER_ROLES as readonly string[]).includes(value as string) ? (value as UserRole) : 'foreman'
}
```

…then have all seven call sites use `toUserRole()`.

### Default permissions for the new role

Add `sales` to `PermissionModule` in `lib/permissions.ts`, and a `sales` row to
`DEFAULT_ROLE_PERMISSIONS`:

| module | admin | pm | foreman | sales |
|---|---|---|---|---|
| `sales` (new) | ✅ | ✅ | ❌ | ✅ |
| `projects` | ✅ | ✅ | ✅ | ❌ — sales reaches the plot page via the `sales` module instead |
| `boq` | ✅ | ✅ | ✅ | ❌ |
| `cost_control` | ✅ | ✅ | ❌ | ❌ |
| everything else | as today | | | ❌ |

Route gating then becomes `requireModuleAccess(['projects', 'sales'])` on the plot detail
route. The individual mutations (`assignContractor`, `updateJobStatus`, …) keep their own
`requireModuleAccess('projects')` calls, so a sales user reaching the page can read it but
every write bounces — which is the behaviour we want. **Also hide those controls in the UI**,
otherwise sales clicks a dropdown and gets silently redirected to `/dashboard`.

### Cost visibility — decision D2, and it is not just one report

**Sales sees prices they charge. Sales never sees what the house cost to build.** That is
broader than hiding one report, because build cost leaks out of several screens the sales team
otherwise has a legitimate reason to open. Derive one flag and thread it through:

```ts
// true for admin/pm (cost_control), false for sales
const canSeeCost = rolePermissions.cost_control || rolePermissions.reports
```

Everything below must respect it:

| Screen | With `canSeeCost` | Without (sales) |
|---|---|---|
| Plot → งานก่อสร้าง tab | job, contractor, agreed price/unit, billed amount, % | job, **% and status only** — no contractor rate, no billed amount |
| Plot → วัสดุ tab | material, qty ordered/received, baht | material, **quantity only** — no baht |
| Plot → ภาพรวม | sale price *and* cost *and* margin | sale price only |
| `/dashboard/cost-control` | full | route already gated — sales has no `cost_control` |
| กำไรต่อหลัง report (Phase 8) | full | not in sales' sidebar at all |

Do this by **not selecting the cost columns server-side** when `canSeeCost` is false, rather
than hiding them in CSS. A sales user opening dev tools should not find contractor rates sitting
in the page payload.

### RLS — do not repeat the billing mistake

`billings`, `billing_jobs` and `billing_adjustments` each carry a permissive `"Allow all"`
policy (`cmd: ALL`, `roles: {public}`, `qual: true`) that ORs away their real row filtering.
That hole is still open. **Write real per-command policies on every new table from the first
migration.** `customers` in particular will hold ID-card numbers and phone numbers — it should
be readable only by `sales`, `pm` and `admin`, never by `foreman` or `anon`, and every new
table should start with `revoke all ... from anon`.

## 7. Data model

### 7.1 Plot columns (Phase 0)

```sql
alter table plots
  add column is_sellable      boolean not null default true,
  add column land_area_sqwa   numeric,   -- เนื้อที่ (ตร.ว.)
  add column title_deed_no    text,      -- เลขที่โฉนด
  add column list_price       numeric,   -- ราคาตั้ง
  -- site-plan position, Phase 4. NORMALISED 0..1, not pixels - see §7.8
  add column map_x            numeric check (map_x between 0 and 1),
  add column map_y            numeric check (map_y between 0 and 1);

-- ส่วนกลาง, ที่รอรถ, and the range rows (25-29, 42-45) are not houses
update plots set is_sellable = false
where name in ('ส่วนกลาง', 'ที่รอรถ') or name ~ '^[0-9]+-[0-9]+$';
```

`plots.name` already holds the house number, so no separate `house_no` column is needed.

### 7.2 Status catalogue — editable labels and colours, stable codes

The brief says statuses have their own colours and lists four "etc." — so the list must be
editable in settings, not hardcoded. But a free-form list makes reporting impossible. The
middle ground: a table whose **`code` is stable and what logic keys off**, whose `label` and
`color` are editable, and where every row must declare a `stage` so reports can group rows a
user invented later.

```sql
create table sale_statuses (
  code        text primary key,        -- stable identifier, never edited
  label       text not null,           -- Thai display name, editable
  color       text not null,           -- palette key, see §8.1 — NOT a raw hex
  stage       text not null check (stage in ('open','reserved','contracted','closing','closed','lost')),
  sort_order  int  not null,
  is_active   boolean not null default true
);
```

Seed (derived from the Thai sale sequence in §3):

| code | label | color | stage |
|---|---|---|---|
| `available` | ว่าง | `slate` | open |
| `on_hold` | ล็อกไว้ | `zinc` | open |
| `reserved` | จอง | `amber` | reserved |
| `contracted` | ทำสัญญา | `blue` | contracted |
| `loan_pending` | ยื่นกู้ / รออนุมัติ | `indigo` | contracted |
| `loan_approved` | อนุมัติสินเชื่อ | `sky` | contracted |
| `awaiting_inspection` | รอตรวจบ้าน | `orange` | closing |
| `defect_fixing` | แก้ Defect | `rose` | closing |
| `awaiting_transfer` | รอโอน | `violet` | closing |
| `transferred` | โอนแล้ว | `emerald` | closed |
| `cancelled` | ยกเลิก | `red` | lost |

### 7.3 Customer

```sql
create table customers (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  phone       text,
  email       text,
  id_card     text,                    -- PII: RLS-restricted, never logged
  address     text,
  lead_source text,                    -- ป้าย / Facebook / walk-in / นายหน้า / แนะนำ
  note        text,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);
```

### 7.4 The deal

```sql
create table plot_sales (
  id              uuid primary key default gen_random_uuid(),
  plot_id         uuid not null references plots(id) on delete cascade,
  customer_id     uuid references customers(id),
  status_code     text not null references sale_statuses(code),
  sales_rep_id    uuid references profiles(id),

  list_price      numeric,   -- ราคาตั้ง
  sale_price      numeric,   -- ราคาขายจริง
  discount_note   text,      -- ส่วนลด / ของแถม
  booking_amount  numeric,   -- เงินจอง
  contract_amount numeric,   -- เงินทำสัญญา
  down_total      numeric,   -- ยอดผ่อนดาวน์รวม
  loan_bank       text,
  loan_amount     numeric,

  booked_at          date,   -- วันจอง
  contract_at        date,   -- วันทำสัญญา
  loan_submitted_at  date,
  loan_approved_at   date,
  inspection_at      date,   -- นัดตรวจบ้าน
  transfer_at        date,   -- วันโอนกรรมสิทธิ์
  delivered_at       date,   -- วันส่งมอบ
  cancelled_at       date,
  cancel_reason      text,

  note        text,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- one live deal per plot; cancelled deals stay for history and re-sale
create unique index plot_sales_one_live_per_plot
  on plot_sales(plot_id) where cancelled_at is null;
```

**Why both explicit date columns and an event log:** the dates are what reports filter on
("โอนเดือนนี้กี่หลัง") and they must be editable, because a sale is usually entered after the
fact. The event log below is the audit trail of who changed what, which editable dates can
never be. Keep both.

**Why a deal table rather than `plots.sale_status`:** bookings get cancelled and plots get
re-sold. A status column on `plots` throws away the first customer. The partial unique index
gives you "one active deal" while keeping the history.

### 7.5 Sale timeline

```sql
create table plot_sale_events (
  id            uuid primary key default gen_random_uuid(),
  plot_sale_id  uuid not null references plot_sales(id) on delete cascade,
  event_type    text not null,   -- status_change | note | payment | document | appointment
  from_status   text,
  to_status     text,
  happened_at   timestamptz not null default now(),
  actor_id      uuid references profiles(id),
  note          text,
  attachment_urls text[]
);
```

Every status change writes one row. This is the "history of the sale" in the brief, and it is
also what makes the days-in-stage report possible.

### 7.6 Sales → construction work requests

```sql
create table sales_work_requests (
  id           uuid primary key default gen_random_uuid(),
  plot_id      uuid not null references plots(id) on delete cascade,
  plot_sale_id uuid references plot_sales(id) on delete set null,
  request_no   text unique,          -- SR-YYYYMMDD### , reuse the counter pattern
  category     text not null,        -- extra_work (งานเพิ่มลูกค้า) | defect (แก้ defect)
                                     -- | expedite (เร่งงาน) | handover_prep (เตรียมส่งมอบ) | other
  title        text not null,
  detail       text,
  photo_urls   text[],
  priority     text not null default 'normal',  -- low | normal | urgent
  needed_by    date,                 -- ต้องเสร็จก่อนวันนัดตรวจ / วันโอน
  status       text not null default 'new',     -- new | accepted | in_progress | done | rejected
  charge_to    text,                 -- customer | company
  quoted_amount numeric,
  assigned_contractor_id uuid references contractors(id),
  billing_id   uuid references billings(id),    -- the DC raised for it, if any
  requested_by uuid references profiles(id),
  accepted_by  uuid references profiles(id),
  reject_reason text,
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);
```

`needed_by` should default from the deal's `inspection_at` or `transfer_at` — that is the whole
point of linking it to the sale. A request whose `needed_by` falls before the plot's remaining
work can plausibly finish is the alert the construction dashboard should shout about.

### 7.7 Money — confirmed in scope (Phase 7)

```sql
create table sale_payments (
  id            uuid primary key default gen_random_uuid(),
  plot_sale_id  uuid not null references plot_sales(id) on delete cascade,
  kind          text not null,   -- booking | contract | down | transfer | extra
  installment_no int,            -- งวดที่ N, for kind = 'down'
  due_date      date,
  amount_due    numeric not null default 0,
  paid_at       date,
  amount_paid   numeric,
  method        text,            -- โอน | เงินสด | เช็ค | บัตร
  receipt_no    text,
  note          text,
  created_at    timestamptz not null default now()
);
```

Receipt numbers follow the existing counter pattern — add a `sale_receipt_number_counters`
table mirroring `goods_receipt_number_counters`, format `RC-YYYYMMDD###`.

**Receipts and any customer ID documents must not go in the `assets` bucket.** See §7.9.

### 7.8 Site plan (Phase 4)

```sql
alter table projects
  add column site_plan_url     text,     -- the ผังโครงการ image
  add column site_plan_width   int,      -- natural pixel size, for the editor's aspect ratio
  add column site_plan_height  int;
```

Three things that decide whether this works or becomes a maintenance problem:

1. **Store normalised coordinates (0–1), not pixels.** `plots.map_x/map_y` are fractions of the
   image's width and height. When someone replaces the site plan with a higher-resolution scan,
   or the phase 2 plan gets redrawn, every marker stays where it belongs. Pixel coordinates
   would all have to be re-placed by hand.
2. **Markers, not polygons, for v1.** A coloured pin per plot with the house number on it,
   sized relative to the container. Traced plot outlines look better but need a polygon editor,
   and the pin answers the actual question ("which houses near the park are free?") just as well.
   Nothing in this schema blocks adding a `map_polygon jsonb` column later.
3. **SVG is the best format here** and the `assets` bucket already allows it — crisp at any zoom
   and usually far under the size limit. A JPEG scan of a printed plan will often blow past the
   bucket's 2 MB cap (§7.9): downscale client-side before upload, or raise the cap.

The placement editor is admin-only (`projects` permission): show the site plan, list the plots
that have no coordinates yet, drag each onto the plan. Clicking a placed marker re-opens it for
nudging. Plots without coordinates must still appear — as an "ยังไม่ได้วางผัง" list beside the
map — or they silently vanish from the sales board's map view.

### 7.9 Storage — the `assets` bucket is public

The one existing bucket, `assets`, is **public**, capped at **2 MB**, and image-MIME-only. That
is fine for what uses it today (logos, signatures, DC photos) and fine for work-request defect
photos. It is wrong for two new things:

- **Customer documents and receipts** (Phase 7): a public bucket means anyone holding the URL
  reads the file, forever, with no login. Create a **private** `sales-docs` bucket, serve through
  signed URLs, and allow PDFs. Customer ID cards, contracts and receipts go there and nowhere else.
- **Site plans** (Phase 4): may exceed 2 MB as a raster image. Either raise the limit for this
  bucket or downscale on the client before upload — decide before building the upload form.

## 8. Screens

### 8.1 Sidebar

New section in `components/layout/Sidebar.tsx`, between `งานประจำวัน` and `จัดซื้อ`:

```
ฝ่ายขาย
  • ผังการขาย        /dashboard/sales              permission: 'sales'
  • ลูกค้า            /dashboard/sales/customers    permission: 'sales'
  • คำขอจากฝ่ายขาย   /dashboard/sales-requests     permission: 'sales' | 'foreman' | 'projects'
```

**Tailwind gotcha — this will bite you.** Status colours come from the database, but Tailwind
generates classes by scanning source at build time. `bg-${color}-100` produces *no CSS*. The
`color` column therefore stores a palette key, resolved through a static map:

```ts
// lib/sales/statusColors.ts — every class string written out in full so Tailwind sees it
export const STATUS_COLORS = {
  emerald: { chip: 'bg-emerald-100 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-500' },
  amber:   { chip: 'bg-amber-100 text-amber-800 ring-amber-200',       dot: 'bg-amber-500'   },
  // …one entry per allowed key
} as const
```

If the user must be able to pick arbitrary colours, store a hex and use inline `style` instead —
but then the chips will not match the rest of the app's palette. Recommend the fixed key list.

### 8.2 `/dashboard/sales` — the board

- `ScopePicker` at the top (project → plot group/เฟส → plots), reused from cost-control.
- Legend row: every active status as a coloured chip with a live count.
- Grid of plot cards grouped by plot group. Each card: plot name (house number), house model,
  a status chip in the status colour, customer name, sale price, next key date, and a thin
  construction-progress bar.
- Filters: status, sales rep, house model, "โอนเดือนนี้", "ค้างเกิน N วัน".
- **Three view modes on the same data and the same filters** — cards (default), a dense
  sortable/exportable table, and the site plan map (Phase 4). The view mode lives in the URL
  alongside the scope, so a filtered map is a shareable link.
- Clicking a card, row or map marker → the plot detail page, sales tab.

The map view reuses this exact payload — it is the same `get_sales_board` rows rendered on an
image instead of in a grid. Do not give it its own data path.

**Load it in one round trip.** Per `PERF_HANDOFF.md`, latency here is round trips, not query
cost. Write one SQL function rather than four PostgREST fetches:

```sql
create function get_sales_board(p_project_id uuid)
returns table (
  plot_id uuid, plot_name text, plot_group_id uuid, plot_group_name text,
  house_model_name text, list_price numeric,
  sale_id uuid, status_code text, status_label text, status_color text, stage text,
  customer_name text, sales_rep_name text, sale_price numeric,
  booked_at date, contract_at date, inspection_at date, transfer_at date, delivered_at date,
  jobs_total int, jobs_done int, progress_percent numeric
) language sql stable as $$ ... $$;
```

`progress_percent` = money-weighted, from the latest `billing_jobs.progress_percent` per
`job_assignment_id` on approved billings, weighted by
`coalesce(ja.agreed_price_per_unit, bm.price_per_unit) * bm.quantity`. Fall back to
`jobs_done / jobs_total` for plots with no billing history yet.

### 8.3 Plot detail — one page, tabs, both departments

Extend `app/dashboard/projects/[id]/[plotId]/`. Gate the route with
`requireModuleAccess(['projects','sales'])`; keep every mutation's own gate as-is.

| Tab | Shows | Data source | Sales sees (`canSeeCost = false`) |
|---|---|---|---|
| ภาพรวม | status chip, customer, sale price, key dates, progress bar | `get_sales_board` row | same, **minus cost and margin** |
| การขาย | full deal form, status change with mandatory note, customer link, documents | `plot_sales`, `customers` | same — this is their tab |
| งานก่อสร้าง | BOQ job table — contractor, agreed price, status, billed % | `getJobAssignments(plotId)` (already built) | job name, status, % — **no rates, no amounts** |
| วัสดุ | ordered / received / issued per material vs BOQ planned | `getMaterialsSummaryForProject(projectId,{plotIds:[plotId]})`, `getBoqControl` | material + **quantity only, no baht** |
| คำขอจากฝ่ายขาย | this plot's work requests and their state | `sales_work_requests` | same |
| ประวัติ | merged timeline: sale events + job completions + DCs + deliveries | `plot_sale_events` + `billings` + `goods_receipts` | same, with DC amounts stripped |

The merged ประวัติ tab is what the brief means by "plots will show history of the sale like
transfer date, delivery date" — and putting construction events on the same timeline is the
part no off-the-shelf CRM can do.

Two rules for this page:

- Hide, do not merely disable, construction **write** controls when the viewer's permissions say
  `projects` is false.
- Strip cost columns **server-side**, not in the browser (§6). The sales view should never have
  contractor rates in its page payload.

### 8.4 `/dashboard/sales-requests` — the construction queue

Table of open requests across all projects: plot, category, title, priority, `needed_by`,
days open, requester, status. Default filter `status in (new, accepted, in_progress)`, sorted
by `needed_by`. Row actions: accept / reject with reason / mark in progress / mark done /
assign contractor / raise a DC.

Add a compact "คำขอจากฝ่ายขาย" card to `/dashboard` and to the foreman landing page showing the
count of `new` and the count overdue against `needed_by`. Push a row into `notifications` on
create and on status change so the existing `NotificationBell` picks it up for free.

## 9. Phases

Each phase ships on its own. The order reflects the locked decisions: the site plan is promoted
to Phase 4, and the data import sits in front of it so the map has something to show.

| # | Phase | Why here |
|---|---|---|
| 0 | Plot inventory sellable-ready | Nothing works until the non-houses are excluded |
| 1 | Role + permission plumbing | Invisible, but the likeliest silent bug — do it alone |
| 2 | Sales tables + board (cards, table) | The core |
| 3 | Import the existing sales book | Real data before anything is demoed |
| 4 | **Site plan map view** | Promoted per D4 |
| 5 | Plot detail — both sides in one page | |
| 6 | Sales → construction work requests | |
| 7 | **Money: จอง → งวดดาวน์ → receipts** | Confirmed per D1 |
| 8 | Reports, incl. กำไรต่อหลัง (owner/PM only) | Needs every number above |

Phases 4 and 5 can swap if the showroom need is more urgent than the internal one.

### Phase 0 — Make the plot inventory sellable-ready
Migration in §7.1 plus the `is_sellable` backfill. A small admin UI on the project page to
toggle it and to enter เนื้อที่ / เลขที่โฉนด / ราคาตั้ง.
**Accept when:** a query for sellable plots in Arada Prime returns houses only — no `ส่วนกลาง`,
no `25-29`.

### Phase 1 — Role and permission plumbing
`sales` (and `accountant`) added to the DB CHECK, to `UserRole`, to `DEFAULT_ROLE_PERMISSIONS`,
and the seven coercion sites in §6 replaced with one `toUserRole()` guard. Role dropdown in
settings updated. New `sales` permission module.
**Accept when:** an account with `role = 'sales'` logs in, `getDashboardSession()` returns
`'sales'` (not `'foreman'`), and the sidebar shows the sales section and nothing else.

This phase has no visible feature — resist the urge to fold it into Phase 2. It is the one
most likely to produce a silent, confusing bug.

### Phase 2 — Sales data model and the board
Tables from §7.2–7.5 with real RLS policies and `revoke all ... from anon`. The
`get_sales_board` function. `/dashboard/sales` with the card grid, legend, filters, and a
status-change modal that writes a `plot_sale_events` row every time. Status catalogue editor in
Settings, admin-only (D3).
**Accept when:** sales moves plot 101 จอง → ทำสัญญา with a note, the card colour changes, and
the ประวัติ tab shows who changed it and when. An admin renames a status in Settings and every
board chip follows, without a deploy.

### Phase 3 — Import the existing sales book
A CSV/Excel importer for the team's current spreadsheet: plot name → `plots.id`, customer,
status, price, dates. Follow the exact-match-then-normalized resolution rule from the PO import
(see memory `project-buildflow-po-import`) for matching plot names, and report unmatched rows
rather than guessing.
**Accept when:** the current spreadsheet loads with a printed reconciliation — rows in, rows
matched, rows rejected and why. Nothing is silently dropped.

### Phase 4 — Site plan map view (promoted, D4)
`projects.site_plan_*` columns, the image upload, the admin drag-to-place editor, and the map
view on the sales board sharing Phase 2's payload and filters.
**Accept when:** Arada Vela's plan loads with every sellable plot placed, plots are coloured by
status, unplaced plots are listed beside the map rather than hidden, clicking a marker opens the
plot, and replacing the plan image with a larger scan leaves every marker correctly positioned.

### Phase 5 — Plot detail with both sides
Tabs per §8.3, route gate widened, construction write controls hidden for sales, cost columns
stripped server-side.
**Accept when:** a sales user opens plot 101 and sees the customer, the dates, "งานเสร็จ 12/34",
the BOQ job list and the materials delivered — with no contractor rate or baht figure anywhere
on the page or in its payload — and cannot reassign a contractor.

### Phase 6 — Work requests
`sales_work_requests`, the request form on the plot page, the queue page, dashboard cards,
notifications, and the "raise a DC from this request" link into the existing extra-work flow.
**Accept when:** sales files "ลูกค้าขอเพิ่มปลั๊ก 4 จุด" on plot 101 with `needed_by` pulled from
the inspection date; it appears in the construction queue and on the foreman dashboard; marking
it done stamps `completed_at` and notifies the requester.

### Phase 7 — Money: จอง → งวดดาวน์ → receipts (confirmed, D1)
`sale_payments`, the `sale_receipt_number_counters` table, an installment-schedule generator
(split ยอดผ่อนดาวน์ into N monthly งวด from the contract date), an overdue list on the sales
dashboard, and receipt printing via the existing `@react-pdf/renderer` + `document_signature_slots`
setup. Private `sales-docs` bucket per §7.9.
**Accept when:** เงินจอง 20,000 is recorded against plot 101, a 12-งวด down-payment schedule is
generated from the contract date, a numbered receipt prints, and an unpaid งวด past its due date
appears in the overdue list. The receipt PDF is **not** reachable without a login.

### Phase 8 — Reports, and the one that matters
- ยอดขาย per project/month; pipeline funnel by `stage`; average days in each stage;
  forecast of transfers from `transfer_at`; down-payment collection vs plan.
- **กำไรต่อหลัง — `sale_price` minus (material cost + labour cost) per plot**, reusing
  `getMaterialsSummaryForProject` and `getLaborLedger`. Admin/PM only (D2); not in the sales
  sidebar at all.
**Accept when:** the owner opens one page and sees, for every transferred house, what it sold
for and what it cost to build — and a sales login cannot reach that page or its action.

## 10. Risks and gotchas

1. **The role coercion landmine (§6).** Highest-probability silent bug in the whole plan.
2. **Tailwind cannot build class names from database strings (§8.1).** Colours will simply not
   render and it will look like a data problem.
3. **The `"Allow all"` RLS pattern on the billing tables must not be copied.** New tables carry
   customer PII. Write per-command policies in the first migration, not later.
4. **Round trips, not queries.** One RPC per screen. The database is a few MB; the latency is
   all network. See `PERF_HANDOFF.md`.
5. **`boq_material_items` is still nearly empty,** so the material tab will look sparse. Set
   expectations before the demo; it is a data-entry problem, not a bug.
6. **Sales must not be able to create plots.** `createPlot()` auto-generates job assignments
   from the BOQ master. A salesperson adding a plot would silently create ~14 construction jobs.
   Keep plot creation on `projects`.
7. **Dead schema.** `progress_logs` and `inspections` are empty and unreferenced. Do not build
   on them. Consider dropping them in a separate cleanup.
8. **Re-sales.** The partial unique index handles cancel-then-rebook. Test it explicitly —
   cancel a deal, create a new one on the same plot, confirm both appear in history.
9. **The `assets` bucket is public and capped at 2 MB (§7.9).** Customer receipts and ID
   documents must go in a new private bucket. A site plan scan may not fit in 2 MB.
10. **Cost must be stripped server-side, not hidden in CSS (§6).** Otherwise contractor rates
    sit in the sales page's payload for anyone who opens dev tools.

## 11. Decisions — locked 2026-09-17, do not re-litigate

| # | Question | Decision | Consequence |
|---|---|---|---|
| **D1** | Does sales take money in this system? | **Full POS.** เงินจอง, เงินทำสัญญา, งวดผ่อนดาวน์ with due dates, an overdue list, printed numbered receipts. | Phase 7 is in scope. Needs a private storage bucket (§7.9) and a receipt-number counter. |
| **D2** | Can sales see build cost? | **No. Price only.** Sales sees what it sells for, never what it cost. กำไรต่อหลัง is admin/PM only. | Threads a `canSeeCost` flag through the plot page — see §6. Cost columns are omitted server-side. |
| **D3** | Who owns the status list? | **Admin can add, rename and recolour** in Settings. Every status must be tagged to a `stage` so reports survive new statuses. | Phase 2 includes a status-catalogue editor. Colours come from a fixed palette-key list (§8.1). |
| **D4** | Interactive site plan? | **Yes, and prioritised** — promoted from "maybe never" to Phase 4, right after the data import. | `projects.site_plan_*` + normalised `plots.map_x/map_y` + a drag-to-place admin editor (§7.8). |

Two consequences worth calling out, because they cut against the natural instinct while building:

- **D2 makes the plot page two-faced.** The same route renders materially different data for
  sales and for PM. Build the permission split in from the first commit of Phase 5; retrofitting
  it means auditing every column of every tab.
- **D4 front-loads work that has no data behind it yet.** That is why Phase 3 (import) sits in
  front of it. Building the map before there are real deals to colour produces a beautiful grey
  site plan and no way to tell whether it works.

---

### Sources consulted

- Thai sale sequence and timeline — SW19 Real Estate, `sw19.co.th/th/blog/buy-sell-process`
- Thai property CRM pipelines, loan-status stage — OurGreenfish, `blog.ourgreenfish.com`
- PLOY by BUILK (Thai real-estate sales CRM) — `ploycrm.com`
- Colour-coded inventory boards — redbriQ, Property xRM, UnitAtlas, Blindersoe
- Buyer selections / change orders — Buildertrend, CoConstruct, ECI Solutions, BuilderPad
- Buyer portal + construction-linked payments — PropFlo, Ascendix
- Defect inspection practice (ตรวจรับบ้าน) — Beaverman, MrHome Inspector, S Inspectors
