# BuildFlow UI rules

## Departments
Defined once in `lib/navigation.ts`. The sidebar and the header read from it. Add new routes there.
Areas: ก่อสร้าง, BOQ & ต้นทุน, จัดซื้อ, สต็อก, ฝ่ายขาย, รายงานและระบบ. Shared routes (e.g. คำขอจากฝ่ายขาย) are listed once, under the viewer's own department.

## Page context
- The top bar shows `department / page title` on every dashboard route. Pages do not repeat the department.
- Each page has one `PageHeader` (the only h1): title, optional subtitle, actions on the right.
- Primary action = default `Button`; everything else `secondary`. One primary per page header.

## Colour
- Each department has one accent colour, defined in `lib/navigation.ts`: ก่อสร้าง orange, BOQ & ต้นทุน violet, จัดซื้อ blue, สต็อก cyan, ฝ่ายขาย pink, รายงานและระบบ slate. It appears on the sidebar group, the active menu item and the top-bar stripe/label. Overview is indigo.
- Page content stays neutral. Green / amber / red are reserved for status and never used as a department colour. A status must also carry text or an icon, never colour alone.

## Terms
- Use Thai labels. Keep these English abbreviations, always with the Thai name on first use on a page: DC (ใบเบิกงานเพิ่ม), PR (ใบขอซื้อ), PO (ใบสั่งซื้อ), SR (คำขอจากฝ่ายขาย), BOQ.
- Avoid English headings like "Foreman Workflow"; use the Thai page title.

## Foreman
Stays a field-focused area: same shell and controls as the rest of the app, plus a tab bar for its four tasks (touch targets >= 44px). No separate banner.

## Layout
- Page root: `space-y-6` between heading, filters, summaries and content.
- Width: forms/settings detail `max-w-3xl`; lists and detail pages `max-w-6xl`; dense tables `max-w-screen-2xl`; maps, dense financial tables and report grids stay full width. Always `mx-auto`.
- Do not hand-roll an h1 with an eyebrow/back-link: use `PageHeader` and put the back link in `actions`.

## States
- Loading and error for every dashboard route come from `app/dashboard/loading.tsx` (`PageSkeleton`, a page-shaped placeholder) and `error.tsx`. Use `PageLoading` (spinner) only for short actions; do not hand-roll page-level spinners.
- Radii: cards 16px (`rounded-2xl`), controls 10px, compact/icon buttons `rounded-lg`. No bare `rounded`.
- Procurement forms use the same palette as the rest of the app. The Apple-style theme was removed; the PO PDF has its own renderer in `lib/pdf/`.
- Empty states: centred text, `py-8`-`py-12`, `text-slate-500` (not `-400`, which is too faint on white to meet AA contrast), one sentence saying what is missing and, where possible, what to do.
- Muted helper text on white: `text-slate-500` or darker (swept across the app 2026-10-08). `text-slate-400` is for icons and placeholders only.

## Small screens
No dedicated phone UI. Below 1024px the sidebar stays as the 80px icon rail (CSS only, `max-lg:`), the toggle is hidden, and page padding drops to 16/20px. Wide tables scroll inside their own container, not the page.

## Page patterns (components/ui)
- `PageContainer` width by page type: `wide` 1440 (dashboards, listings), `standard` 1200 (detail, settings lists), `form` 960, `narrow` 720. Don't write `max-w-*` on a page root.
- `PageToolbar`: the single toolbar above a list (filters as children, built-in search, result count, removable active-filter chips, reset).
- `TableFrame`: table border/scroll region plus default header/cell/row styling (zero-specificity, so classes still override). `stickyHeader` + `maxHeight` for long tables.
- `EmptyState`: `empty` (nothing yet) vs `no-results` (filter removed everything), with a next action when there is one.
- `PageSection`: titled block on long pages. `PageSkeleton`: loading shapes (list / detail / dashboard).
- Reference pages: lists = `procurement/requests`, `procurement/orders`, `sales-requests`; form widths = settings pages.

## Department accent (read the theme, never hard-code)
Use `useDepartment()` (components/layout/DepartmentContext) and the theme tokens in lib/navigation.ts (`text`, `chip`, `pill`, `selected`, `soft`, `solid`...). Accent = identity only: header eyebrow/rule, selected filters/tabs, icon surfaces. Never for primary buttons, focus rings or status.
