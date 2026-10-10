# BuildFlow Pro UI and motion implementation plan

**Status as of 2026-10-10.** (Shipped to production 2026-10-10: commits c6ea6c6, e25d52d, 006dd1b, and 1cbd8ca — the PO allocation audit fixes with migration 202610070003, applied live after a dry run and a check that no BOQ number moved. Work after that, listed as "built, not yet pushed", is committed locally only.) Rewritten to reflect the owner's decisions and the work already built. Sections marked ✅ are implemented, ☐ are still to do. Visual verification in a browser has not yet been done for most of this (see "Verification").

## Purpose

Bring the product UI into one coherent system and make it feel responsive. Reorganize presentation and simplify interaction flows where specified, while preserving business rules, permissions, data operations and route behavior. Do not restyle generated/printed documents (PDF and `*/print/**`). No new product features, data, dark theme, or dependencies.

## Decisions (owner-approved, take precedence over anything below)

1. **Desktop-first. No dedicated phone UI.** There is no drawer and no hamburger menu. Below 1024px the sidebar stays as the 80px icon rail (pure CSS, `max-lg:`), the collapse toggle is hidden, page padding is 16px / 20px / 24px by width, and wide tables scroll inside their own container. Pages should still wrap sensibly on small screens, but a separate mobile layout is out of scope. Anything in earlier drafts about a 280px drawer, a 390px acceptance test or a full-height mobile sheet is dropped.
2. **Department colours stay.** Each department keeps its own accent (see "Department identity"). Indigo remains the global colour for primary actions and focus; status colours keep their meaning.
3. **A short page fade on route change is wanted.** Content fades in with a 6px rise over 180ms (`app/dashboard/template.tsx`). It ends with `transform: none`, and falls back to opacity-only under reduced motion. Earlier drafts said not to animate route changes; that no longer applies.
4. **Naming:** คำขอซื้อ (PR), ใบสั่งซื้อ (PO), ใบรับสินค้า (RI), ใบสำคัญจ่าย (PP), งานเพิ่ม (DC), คำขอจากฝ่ายขาย (SR), BOQ. The TR (transfer request) feature and commission settings were removed.
5. **BuildFlow is one system.** Procurement uses the same components and palette as everything else; the Apple-style theme was removed. PDF/print output keeps its own look.

## Design direction

A calm, precise, information-rich "operations command center", light theme. Hierarchy comes from alignment, grouping, whitespace and typography, not gradients, heavy shadows or marketing-style cards.

### Modern surface treatment: restrained glass and depth ✅

Implemented 2026-10-08: `Card` has the soft shadow plus an inset top-edge highlight (stronger edge/shadow on `interactive` hover); `.elev-floating` and `.glass-popover` in `globals.css` are used by the modal panel, SearchableSelect list, notification bell and project switcher (solid fallback when `backdrop-filter` is unsupported); the sidebar is now solid white because nothing scrolls behind it; the sticky header and modal backdrop keep their blur. Tables stay flat.

Modernize the visual feel with deliberate layers and highlights, not a full neumorphic redesign.

- Keep primary data and reading cards solid white for contrast. Add a crisp border, a very soft resting shadow, and a faint top-edge highlight (a subtle inset line or restrained surface gradient). Interactive cards may gain a slightly stronger edge/shadow on hover.
- Use glass/blur only where content visibly moves behind a floating layer: the sticky header, the mobile-width icon rail only if content scrolls behind it, dropdown/popover surfaces, and modal/drawer backdrops. Keep sidebar labels and modal panels opaque enough to stay sharp. Use a thin edge and restrained shadow with the blur; provide a solid fallback.
- Do not blur table/card content or fixed panels without scrolling content behind them. Blur should signal elevation and separation, not be an all-over decoration.
- Avoid full neumorphism: paired light/dark inset shadows lower edge contrast and make data controls harder to parse. Use tactile depth through clear borders, one soft shadow, the faint top edge, and small press feedback instead.
- Avoid mirror-like reflection imagery or glossy streaks. “Reflection” means a barely visible highlight on the top edge of a raised summary/interactive surface, never behind text or strong enough to compete with department/status colors.
- Use a three-level elevation system: flat (table/inline groups), raised (cards), floating (menus/modals). Do not nest multiple shadows or blur layers. Department tints may mark a selected or featured surface while text and controls remain neutral.

- **Surfaces:** canvas (`#f5f5f7`), content (white), nested/selected (pale slate or the department tint). Avoid cards inside cards.
- **One primary action per page region**, indigo. Secondary actions neutral, destructive actions red with confirmation. Infrequent row actions may move into a compact menu; frequent ones stay visible.
- **Typography:** title 26px (22px below 640px), section 18px, body 14px, helper 12–13px. Tabular numerals and right alignment for numbers (`td.text-right` already uses tabular figures). No all-caps for long Thai text.
- **Content width** is chosen by page type through `PageContainer`: `wide` 1440 (dashboards, listings), `standard` 1200 (detail, settings lists), `form` 960, `narrow` 720. Dense reports and maps may use full width.
- **Density:** operational table rows 48–56px, header kept visible when a table scrolls (`TableFrame stickyHeader`), filters attached directly above the data they control.
- **Radii:** cards 16px, controls 10px, compact/icon buttons 8px (`rounded-lg`), pills full. No bare `rounded`.
- **Text contrast:** muted text on white is `text-slate-500` or darker. `text-slate-400` is for icons and placeholders only.

## Department identity ✅ (contract) / ☐ (wider use)

The mapping lives in `lib/navigation.ts` (one source of truth for route ownership and theme): construction **orange**, BOQ and cost **violet**, procurement **blue**, stock **cyan**, sales **pink**, reports and settings **slate**, overview **indigo**. Shared routes (e.g. คำขอจากฝ่ายขาย) appear under the department the viewer's sidebar places them in.

Theme tokens: `text`, `active`, `icon`, `solid`, `wash`, `tint`, `soft`, `chip`, `pill`, `selected`, `stepSolid`. Components read them through `useDepartment()` (`components/layout/DepartmentContext.tsx`); never hard-code a department colour in a page.

Used for identity only:
- ✅ sidebar group title, dot and active item; collapsed-rail colour bars
- ✅ top-bar stripe, tint and department label
- ✅ `PageHeader`: slim accent rule and department eyebrow above the title (every page that uses it)
- ✅ `PageToolbar` active-filter chips; the PR list's selected status pill; weekly plan modal selection and step markers
- ✅ icon surfaces on the dashboard KPI tiles, action queue and week panels (`theme.soft`); selected tabs (`theme.tab`). ☐ chart/section accents

Never used for: primary/secondary/danger buttons, focus rings, status colours, whole-page tints.

## Tokens and motion

Defined in `app/globals.css`: `--radius-card/control/compact`, `--motion-fast` 120ms, `--motion-base` 180ms, `--motion-overlay` 220ms, `--ease-enter`, `--ease-exit`. The project has no animation plugin, so animations are plain keyframes (`.anim-modal`, `.anim-backdrop`, `.anim-pop`, `.anim-page`, `toast-in/out`). ✅

| Interaction | Behavior | Status |
| --- | --- | --- |
| Button / link / row hover | colour or background only, 120ms; press scale 0.98 | ✅ |
| Sidebar collapse | width and content offset 200ms, same easing | ✅ |
| Sidebar section open/close | grid-rows disclosure 180ms, hidden items not tabbable | ✅ |
| Modal | backdrop fade + panel fade/rise 220ms (enter only) | ✅ |
| Dropdown (SearchableSelect) | 120ms pop | ✅ |
| Disclosure (weekly plan progress box, group expand chevron) | 180ms | ✅ |
| Progress bars | width transition 220ms, only on value change | ✅ |
| Toast | 180ms entrance, 160ms exit before removal | ✅ |
| Page change | 180ms fade/rise | ✅ |
| Loading | page-shaped skeleton (list / detail / dashboard); spinner only for short actions | ✅ |
| Reduced motion | no slide/scale, transitions instant, pulse off, spinners slow but keep turning | ✅ |

Modal exit animation is not implemented (most modals unmount on close). ☐ optional.

Modal surface (2026-10-08): frosted gaussian-blur backdrop (light tint, 14px blur, dark fallback without `backdrop-filter`), `elev-modal` panel shadow with a soft indigo-tinted ground glow and a faint top-edge highlight, subtle gradient header. Reflection is limited to that highlight and shadow, per the surface rules.

## Shared components ✅

`Button` (40px / 32px, focus ring), `Card` (`interactive` prop), `PageHeader`, `Badge`, `Modal` (focus capture, Tab containment, focus restore, top-most-only Escape, unique title id), `SearchableSelect` (native-select look, Escape closes only the list, Enter picks first), `Toast`, `NoticeBanner` (icon, role), global form defaults with `aria-invalid` error state, `focus-visible` outline for links/buttons.

### Shared page patterns ✅ (built) / ☐ (adoption)

`PageContainer`, `PageSection`, `PageToolbar`, `TableFrame`, `EmptyState`, `PageSkeleton`, `Breadcrumb` live in `components/ui/`. Adoption:
- ✅ `PageContainer`: used by about 35 pages (settings, stock, procurement, billing, BOQ, contractors, projects, reports, foreman, both dashboards, sales requests).
- ✅ `PageToolbar` + `TableFrame` + `EmptyState`: procurement PR / PO / RI / PP lists and the sales-requests list.
- ✅ `TableFrame`: DC report, companies, contractor types.
- ✅ `TableFrame` also on suppliers, materials, project detail, plot construction tab, stock overview/movements/reports/material detail and BOQ detail; stock overview and movements use `PageToolbar`. ✅ plot materials tab, permission matrix (sticky header and module column), users table also on `TableFrame`; ☐ still on their own styling: contractors cards, sales board table (each has bespoke content inside the card). Billing now uses `PageToolbar` + `EmptyState`.
- ✅ `Breadcrumb` on project, plot, PO, PR, BOQ and stock detail pages (replaces the "back" links; the PO modal keeps its close button).
- ☐ `PageSection` has not yet been used to regroup long pages.

## Page archetypes

Apply the structure that fits the task; do not make every screen the same card grid.

1. **Overview/dashboard:** title and context; compact KPI strip (tiles needing attention weigh more); one summary visualisation if useful; action queue/alerts; recent and per-project detail below. ✅ Dashboard overview redesigned 2026-10-08: neutral KPI tiles with the department accent on icon surfaces, amber only on tiles that need attention, and a "งานที่ต้องจัดการ" action queue (pending approvals, stale requests, SR new/overdue, warnings first) directly under the KPI strip; the old bottom work-request card was folded into it.
2. **List/management:** one create action in the header; one `PageToolbar` above results with count, active-filter chips and reset; table in `TableFrame`; `EmptyState` distinguishing no-data from no-results; bulk actions only when something is selected. ✅ Reference pages: `procurement/requests`, `procurement/orders`, `sales-requests`.
3. **Detail/workspace:** breadcrumb, entity title, status and primary actions in the header, key facts summarised, related content in consistent tabs/sections. ✅ Breadcrumbs on all detail pages; selected tabs use the department accent (`theme.tab`) on plot detail, billing, cost control, foreman history and signature settings. ☐ Key-facts summary regions not redone.
4. **Create/edit workflow:** named field groups, validation beside fields, conditional fields only when relevant, visible save/cancel, a dedicated page (not a cramped modal) for genuinely complex flows. ✅ settings forms use the `form`/`narrow` widths. ☐ No full reference redo.
5. **Report/ledger:** filters and period at top, summary before the table, aligned numbers, export/print separated from filtering, existing calculations and print output untouched. ✅ Reference: `reports/dc-history` (toolbar with explicit search action and filter chips, neutral summary tiles before the table, table in `TableFrame`; the amber tints were removed because amber is reserved for warnings). ✅ labor budget, house-history and contractor-cycle filters moved onto the shared toolbar (the cycle toolbar is wrapped in `no-print`, so printing is unchanged); ☐ contractor-cycle reconciliation layout and the rest of that page untouched.
6. **Map/planning:** map or schedule gets the dominant canvas, filters and selection summary stay visible, detail in a connected side panel. ☐ Sales board and weekly plan not yet reworked into a side-panel layout.

## Dashboard week panels ✅

The "สัปดาห์นี้" block on the overview is four department panels (sales, construction, procurement, unassigned) instead of labelled text lines: a 3px department accent strip, an icon surface, a title with its total, rows with a count pill and chevron, SR items as category chips, and an amber state for unassigned work. Construction now also counts งานซ่อม (repair).

## Weekly plan ✅

The BOQ-linked plan (job assignment per plot per week, locked once a week is agreed) is described in `WEEKLY_MONTHLY_PLAN_IMPLEMENTATION.md` and is built. UI built on top of it:

- **Add-plan modal:** four guided steps (work source → plots and weeks → work → people and progress), live summary "N งาน · M แปลง · K สัปดาห์ = X รายการแผน", final button "สร้าง X รายการแผน", per-step validation with focus on the first problem, optional collapsed progress details, compact separate edit form. Wide modal (max-w-4xl). Mobile sheet behavior is dropped (decision 1).
- **Batch plans display as one row** ("แปลง 103–107 (5 รายการ · เสร็จ 2/5)") with expand-to-plots, group tick and group delete. Data stays one row per plot.
- **Weekly summary** (average PLAN/ACTUAL per day, count behind plan) and a **monthly workload board** (month totals, trade chips per week, warnings for no owner, no contractor and behind plan).
- **Monthly week card visual refinement ✅ (built 2026-10-08):** the current card reads as inline text pasted into a surface. Recompose it into clear zones: (1) a prominent clickable week header with current-week cue and agreed status pill; (2) aligned summary metrics for planned/completed work and actionable exceptions; (3) a separate row of trade/category chips; (4) task preview rows with a type/BOQ marker, readable title, and plot/contractor metadata on a secondary line. Avoid bracketed labels and long concatenated metadata. For long weeks, show a few tasks plus an explicit “view all N” disclosure. Use the construction orange accent on the current-week edge/header cue, semantic colors only for real statuses/exceptions, a solid white surface, subtle border/shadow, and a faint top-edge highlight. No blur or neumorphic inset shadows on the data card.
- **Sale request form** with searchable plot picker and the four categories (แจ้งซ่อม, ส่วนกลาง, เก็บงาน, โอนบ้าน); the modal is `max-w-3xl` (widened 2026-10-10).

## Module migration status

Order: procurement → projects/plots/BOQ → stock and cost control → billing and foreman → sales, reports, settings, contractors → login/password.

| Module | State |
| --- | --- |
| Procurement | ✅ Apple theme removed; four lists on shared patterns; bare radii fixed; icon buttons labelled. ☐ detail pages (PO, PR) not redesigned |
| Projects / plots / BOQ | ✅ width frames, breadcrumb on project and plot detail. ☐ tables, tab accents, BOQ detail |
| Stock / cost control | ✅ width frames, dashboard skeleton for cost control. ☐ tables to `TableFrame` |
| Billing / foreman | ✅ width frames; foreman banner removed, tab bar kept; billing filters on `PageToolbar`, empty states, accent tabs. ☐ billing card list not converted to a table |
| Sales / reports / settings / contractors | ✅ sales requests list; settings widths and header cleanup; DC report table. ☐ remaining tables, report reference page |
| Login / password | ☐ shared hard-coded background replaced with the token; otherwise untouched |

Repo-wide cleanups already applied: bare `rounded` → `rounded-lg` (checkboxes excluded), `transition-all` removed, hand-made h1 headings replaced by `PageHeader`, muted text darkened, department colours moved to theme tokens.

## Whole-system UI audit and route-specific build brief

The earlier plan named modules but did not fully audit the screens inside them. This register makes the route-level scope explicit. The findings below come from source/UI-structure review; the rendered pages and edge states still require the visual verification listed later. A shared-component pass alone does not complete a route.

### Approval and money-decision screens

| Screen | Current friction found | Build direction |
| --- | --- | --- |
| `/dashboard/billing` — claim queue ✅ built, not yet pushed (2026-10-10: PM-review claims sort first with oldest waiting on top, "รอมา N วัน" with an amber stale warning over 3 days, labelled row action; the cards are still cards, not a table) | Filters and bulk print coexist with claim selection, while claims are presented as separate cards. PM queue priority can be lost in the list. | Make pending PM review the primary queue. Each row/card should surface doc number, project/plots, contractor, requester/date, amount, age, and status in one scan. Make stale claims visually actionable. Keep printing/bulk selection distinct from review navigation. |
| `/dashboard/billing/[id]/review` — **PM approve page** ✅ built, not yet pushed (2026-10-10: breadcrumb, status badge and project/plots/contractor in the header; labelled request facts; DC evidence panel in neutral colours with full-size photo links; main-work table in `TableFrame` with changed-% rows highlighted, "ปรับจาก X%" and a below-previous warning; a sticky decision bar showing main work, DC, deductions, remaining after approval and net amount beside reject/approve; approve now asks to confirm the stated net amount; calculations, permissions, undo and delete unchanged) | Critical omission in the previous plan. The header emphasizes document number and destructive actions; project/plot/requester/date are in a separate “ข้อมูลจาก Foreman” card. Main-work review is a dense nine-column table with editable approved percentages and nested history. DC evidence, adjustments, final calculation, and approve/reject are distributed down a long page; the decision buttons are at the bottom. | Redesign as a dedicated approval workspace. Header: breadcrumb, doc/status, project, plots, contractor, requester/date. A persistent decision summary shows requested amount, adjusted amount, approved net, and remaining balance while reviewing. Main-work lines clearly compare requested % vs approved %, amount, and remaining-after-approval; edited lines show a visible changed state and any validation/limit warning. Keep prior history collapsed per line and visually subordinate. Give DC reason and photos an evidence panel. Separate additions/deductions and their subtotals. Put approve/reject together in a sticky decision bar with the final amount; reject opens reason entry, approve confirms the stated amount. Preserve existing calculations, permission rules, locked/paid states, undo approval, and delete actions. |
| `/dashboard/procurement/requests`, `/dashboard/procurement/requests/[id]` — PR approval ✅ list part built, not yet pushed (pending requests first, oldest on top, "รอมา N วัน" with warning over 3 days); ✅ detail page: sticky decision / next-step bar (approve or reject; create PO and settle once approved) with item count, requester and needed-by date; reject reason opens inside the bar (built, not yet pushed) | Approval, rejection, editing, request details and line status are split between a list, modal and detail body. | Surface pending requests as a decision queue with requester, project/plots, age, item count and total. Detail has a stable request summary, materials table, status/rejection history, then one explicit approve/reject/edit region. Keep decision actions available without scrolling through unrelated content. |
| `/dashboard/procurement/orders/[id]` — PO lifecycle / BOQ exception ✅ lifecycle part built, not yet pushed (2026-10-10: four-step timeline with dates and people; "ยืนยันสั่งซื้อ" / "รับของ" as the one prominent next action; status switch, reverse receipt and close-short grouped as secondary; cancel separate and red; BOQ panel and allocation trace untouched) | Status selector, document actions, receive/undo/close-short/cancel actions compete in the header. BOQ check, receipt history, allocation trace and editable PO content all need different levels of attention. | Separate lifecycle summary/timeline from actions. Promote the next valid action (receive when sent); group reversal and cancellation as secondary/destructive. BOQ exception panel compares planned, ordered and remaining quantity/value and makes override reason/approval state explicit. Keep supplier-facing documents separate from internal PR/plot allocation trace. |
| `/dashboard/procurement/receipts` and goods-receipt flow ✅ built, not yet pushed (goods-receipt modal now shows ordered / already received / this receipt / remaining side by side, inline over-quantity warning with icon and text, receipt value total and a count of exceptions beside the save button) | Receiving quantities and over-BOQ variance are part of the same form, so exceptions can be missed among normal line entry. | Keep ordered, previously received, this receipt and remaining quantities together for each material. Give variances a clear inline exception state and any required approval/reason before save. Keep delivery note/date and receipt total visible. |
| `/dashboard/procurement/payments` — payment vouchers ✅ create-voucher flow built, not yet pushed (numbered sections: receipts, PO comparison, BOQ check, payment details; payable total and over-BOQ warning beside the save button) | Payable receipts, PO matching, allocations and payout totals need a stronger reconciliation hierarchy. | Prioritize unpaid/part-paid work. Show supplier, selected receipts, PO allocation, deductions and payable total together before finalization. Make mismatches explicit; visually quiet completed payment history. Right-align tabular currency. |
| `/dashboard/weekly-plan` — agree/lock decision ✅ built, not yet pushed (2026-10-10: status card says who/when, what is locked and what stays editable; "เปิดแก้ไขแผน" and "ตกลงแผนในที่ประชุมแล้ว" sit on the card, apart from "add plan") | Agree/unagree changes which plan data can be edited but can read as one more button in the content flow. | Present agreement status, who/when, what becomes locked, and which progress fields remain editable together at the top of the week. Keep “agree/reopen” adjacent to that state and separate from “add plan.” |

### Daily operational screens

| Screen family | Routes covered | Audit finding / build direction |
| --- | --- | --- |
| Dashboard overview | `/dashboard` | The page has KPI tiles, a prioritized action queue, and four department panels for the week. Preserve the department panel treatment and theme accents. Make the actionable queue the clear first-read region; weight overdue/attention KPIs above informational totals and avoid seven equally prominent tiles. Keep permission-filtered financial data understandable. |
| Project list/workspace ✅ cards state open/closed in words (switch has role and label), department icon surface, labelled delete (built, not yet pushed); ☐ no progress figure because the list has no progress data | `/dashboard/projects`, `/dashboard/projects/[id]` | Project cards need a repeatable scan order: project/name/location, status, progress, then edit/delete actions. Project detail should establish project identity and summary before tabs/content; group long sections instead of stacking unrelated cards. |
| Plot workspace | `/dashboard/projects/[id]/[plotId]`, `components/plots/*` | The plot has overview, sales, construction, materials, requests and history tabs with separate editing permissions. Keep project breadcrumb and plot identity/status prominent; use the construction department accent for selected tab/context. Apply consistent section headings, table shells, empty states and permission-aware actions within every tab. |
| Site plan/map ☐ NOT done: plot detail still opens in a pop-up; a connected side panel needs a layout change to the zoom/pan canvas that must be checked on screen | `components/plots/SitePlanMap.tsx`, project site-plan modal | Keep the map as the primary canvas and connect selected plot detail to it in a side panel. Make map legend, plot selection, status, zoom and edit affordances distinguishable; avoid placing a floating opaque card over important map content. |
| Sales board | `/dashboard/sales` | Grid/table/map views represent the same plots with different density. Use one scope/filter bar and preserve its state when switching views. Cards emphasize status, customer, price and construction progress; table uses aligned columns; map selection opens a connected detail panel. |
| Sales dashboard/promotions ✅ promotions: value received shown before the controls, active/disabled badge in words, disabled cards stay readable (no 60% fade), labelled item actions, empty state (built, not yet pushed); ✅ sales dashboard: overdue alert first, neutral tiles with the money headline emphasised, "current status" section (built, not yet pushed) | `/dashboard/sales/dashboard`, `/dashboard/sales/promotions` | Dashboard should distinguish trend/performance from current plot status and avoid a wall of equal KPI cards. Promotion cards need offer/benefit, date range and active state before edit/activate actions; expired/disabled items should remain readable. |
| Sales requests | `/dashboard/sales-requests`, plot request tab/form | Make category, plot, due date, owner and next status/action scannable. Distinguish overdue via semantic warning, not department tint. Preserve plot context when viewing a request from a plot. |
| BOQ / house models ✅ house-model cards: toolbar search, edit/delete reachable by keyboard and always shown on touch (were hover-only), labelled, empty state (built, not yet pushed); ✅ BOQ detail: summary strip (total, item count, trades, cost per m²), toolbar search, import button no longer a bespoke green button (built, not yet pushed) | `/dashboard/boq`, `/dashboard/boq/[id]`, `components/boq/*`, `components/materials/*` | House-model cards should prioritize name/code, project scope and area; move edit/delete to predictable accessible actions. BOQ detail should bring phase, job/material totals, cost and variance into a coherent summary, then use grouped phase/material sections with persistent save context on long editing flows. |
| Cost control | `/dashboard/cost-control` and quantity/material/labor tabs | Keep project scope and active tab visible. Distinguish quantity overruns, material cost, labor cost, outside-BOQ and unassigned amounts; make high-risk rows actionable and place caveats next to the affected totals. Permission-hidden labor should not leave a misleading empty state. |
| Stock ✅ overview now lists negative then out-of-stock rows first and leads with the exception tiles (built, not yet pushed) | `/dashboard/stock`, `/dashboard/stock/[materialId]`, `/dashboard/stock/movements`, `/dashboard/stock/reports` | Overview leads with negative/zero/low stock exceptions, then filters/list. Material detail foregrounds on-hand and recent movement with adjustment/withdraw actions. Movement rows clearly show direction, quantity, source/destination, project/contractor and date. Reports separate reorder attention from historical usage. |
| Foreman ✅ history rows state the next step per status, 44px labelled action buttons, empty states (built, not yet pushed); ✅ entry choice cards (neutral, 44px+, department icon), progress-claim and DC forms: numbered sections, shared field styles, submit bar with the total, amber removed, error banners; purchase-request history shows next step (built, not yet pushed) | `/dashboard/foreman`, `/create-progress`, `/create-dc`, `/purchase-request`, `/request`, `/history` | Field flows need visible project/plot context, short grouped steps, touch-friendly controls, clear photo/attachment preview and a decisive submitted state. Progress and DC forms should share structure but make their different evidence/fields clear. History should show current status and next step in the list. Keep the foreman tab bar as local navigation. |
| Weekly plan | `/dashboard/weekly-plan`, `components/weekly-plan/*` | Keep the guided add-plan modal and live item-count preview. Week cards use separate header/metrics/trade/task zones; week view differentiates PLAN/ACTUAL; exceptions (late, missing owner/contractor) are scannable. Preserve grouped plot plans and expand-to-plot behavior. |

### Reports, reference data and account screens

| Screen family | Routes covered | Audit finding / build direction |
| --- | --- | --- |
| Contractors ✅ search and trade filter on the shared toolbar, labelled edit/delete, retention box neutral (amber is for warnings), empty state (built, not yet pushed); ☐ workload / payment-cycle context | `/dashboard/contractors` | Lead with contractor identity, type/trade, active status, current workload and payment-cycle context. Separate edit, history and destructive actions; keep history legible in dialogs and provide a useful empty state. |
| Reports/ledgers | `/dashboard/reports/dc-history`, `/house-history`, `/contractor-cycle`, `/labor-budget`; print routes are excluded from redesign | Every report starts with scope/period and filters, then summary, then detailed data. House-history drilldown needs clear linkage to the selected plot/house. Contractor cycle and labor budget must make gross, deductions/retention, paid and payable values easy to reconcile. Preserve calculations and print layouts. |
| Settings ✅ index cards take their group's department colour instead of six competing colours (built, not yet pushed) | `/dashboard/settings` and `/companies`, `/contractor-types`, `/financial-defaults`, `/materials`, `/permissions`, `/sale-statuses`, `/signatures`, `/suppliers`, `/billing-info`, `/users` | Group settings index by task. Lists use shared toolbar/table/empty patterns; forms use readable widths and named sections. Permission matrix keeps role and module headers visible while scanning. Signature/billing-info pages show upload, ordering, preview and save state. User management separates invite/edit/disable/delete and makes role/status explicit. |
| Login/password ✅ shared notice banners, autocomplete attributes, live password-length and match feedback beside the fields (built, not yet pushed) | `/login`, `/set-password` | Apply shared type, field, error and button patterns while keeping authentication visually focused. Distinguish invalid credentials, expired links and password requirements with local explanatory feedback. |

### Cross-screen improvement rules

- Align every decision workflow—PM billing approval, PR approval, PO over-BOQ, receipt variance, weekly agreement—as **context → evidence/lines → financial or schedule impact → decision**. The decision and its consequences must not be separated by a long scroll.
- Keep key context visible before an action: document/status, project/plot or supplier, requester/owner, and amount/quantity impact.
- Use cards for distinct objects or summaries, not as automatic wrappers around every section. Prefer aligned rows/sections when information is related.
- Keep critical totals/actions sticky only when the panel cannot cover content, errors or keyboard focus. Preserve the key identifier column when a table must scroll horizontally on the desktop-first icon-rail layout.
- Hover-revealed actions must also be available on keyboard focus and touch.
- Audit all states per route: populated, loading, empty, no results, error, pending, disabled, locked, success and destructive confirmation.

### Coverage statement

The route inventory includes shell/overview; billing queue, creation/request, PM review and print; BOQ list/detail; contractors; cost control; foreman root/create/history/request flows; procurement PR/PO/receipt/payment lists, detail, create and combine; project/plot; reports and print; sales dashboard/board/promotions/requests and receipt print; settings root and each settings screen; stock overview/detail/movements/reports; weekly plan; login and password setup. PDF/print pages are inventoried but intentionally retain their document-specific UI. Source review does not establish final visual quality; browser review remains required.

## Balanced implementation sequence

No route or department is ranked above another. The phases below are ordered only by shared-system dependencies; each phase must cover every in-scope route and department before it is considered complete.

1. **Route/state inventory and visual baseline:** for every route in the coverage statement, record the populated state plus relevant loading, empty, error, pending, disabled, locked, and confirmation states. Capture desktop and narrow icon-rail layouts. Do not use a few representative screens as a substitute for the full inventory.
2. **Shared foundation:** finish and verify the shared shell, department context, page patterns, controls, cards, tables, dialogs, feedback, and motion tokens. Record any necessary domain-specific exception in the plan before introducing it.
3. **System-wide consistency passes:** apply one design concern across all modules at a time: page header/context; content widths and section hierarchy; filter/search bars; cards and data tables; status and department accents; forms and validation; loading/empty/error states; overlays and action placement. Each pass must include dashboard, approval, operational, report, settings, and auth routes—not one module at a time with the rest deferred.
4. **Workflow clarity pass across all routes:** apply the same context → information/evidence → impact → action pattern to every decision workflow, including PM billing approval, PR approval, PO/receipt exceptions, weekly-plan agreement, status changes, and destructive actions. These receive the same coverage and design standard as the other page families; none is the first or only priority.
5. **Motion and surface pass across all routes:** apply the agreed restrained glass/depth, card hierarchy, department accent, responsive behavior, and motion rules consistently. Review all screens for visual balance and accessibility, not only shared components.
6. **Full-route visual verification and correction:** revisit every inventoried route/state at the agreed viewport sizes, fix inconsistencies wherever found, and repeat the pass until the same design rules hold throughout the product. A route is not “done” because its module or shared primitive has been migrated.

Optional row-action menus, header user menu and modal exit animation are polish within the same system-wide pass; they do not replace or outrank route coverage.

## Acceptance criteria (desktop-first)

- At 1024px and 1440px the sidebar keeps its 256px/80px behaviour and the content column stays aligned during collapse. Below 1024px the icon rail shows, content has no overlap, and no page-level horizontal scroll appears outside intentionally scrollable tables.
- Every in-scope route follows one archetype, uses the right `PageContainer` width, and has a clear primary action and context.
- Every department-owned route shows its accent in the page header and in selected filters/tabs, while buttons, focus rings and status colours are identical across departments.
- Lists use `PageToolbar` + `TableFrame` + `EmptyState`; long forms use grouped sections at readable widths.
- Generated PDFs and print pages are unchanged.
- Every interactive element has a visible keyboard focus state; modal focus enters, stays contained and returns to its opener; Escape closes only the top modal.
- Motion follows the table above and does not cause content jumps; reduced motion removes slides and scales.
- Loading, empty, error, disabled and pending states are consistent and reserve their layout.
- Route behavior, permissions, data operations and copy are unchanged except for the naming decisions above.
- No new dependency.

## Verification (not yet done)

The dev preview has not yet been visually checked across all routes. To verify: log in on the preview, then inspect every route in the coverage statement at 1024px and 1440px (and a narrow width for the icon rail), with the sidebar expanded and collapsed where available, plus reduced-motion mode. Cover every page family and all relevant route states; do not stop after checking representative pages.

## Execution guidance

Work one design concern at a time across the full route inventory; do not finish one department while leaving the others on a visibly different system. Before changing a shared component, check all its consumers. Avoid broad regex rewrites of classes; where a script is used, make it match an exact structure and review the diff. Track completion by route and state so coverage stays balanced. After each pass report changed files, deviations from this plan, and routes/states verified. Do not alter database or business logic under this plan. The old TR/commission tables were dropped from the live database on 2026-10-10 (migration `202610100001_drop_tr_and_commission.sql`); no database step is pending under this plan.
