# Buildflow Pro: Workflow diagram plan

**Written:** 2026-10-06
**Source:** June's workflow diagram plus the two new UI mockups (Dashboard "This Week" and site plan with status panel).
**Owner decisions (final):**
- Build order is **1 → 3 → 4 → 2** (see below).
- The PM check (the red C) works the same for over-BOQ materials and over-BOQ extra work. One check, one rule.
- A **Sales exec** approves both the **TR** (transfer request) and the **SR** (sale request).
- **Commission is a fixed amount**, set per plot or per project (not a percentage).

Ground rules are the same as `HANDOVER_PLAN.md` section 0: ship each migration together with its code, server actions return errors instead of throwing, Thai labels first, and sales never sees construction money.

---

## Step 1. Site plan status panel (small, no new data)

**What:** On the site plan page, add a right-hand panel next to the map:
- A "transferred" progress bar (for example 30/139).
- Colored count buttons: Reserved (จอง), Appraisal (ประเมิน), Inspect house (ตรวจบ้าน), Waiting transfer (รอโอน).
- Clicking a button highlights or filters those plots on the map.

**Where:** `components/sales/SalesMapView.tsx`, `components/plots/SitePlanMap.tsx`, `app/dashboard/sales/SalesBoardPageClient.tsx`.

**Data:** The statuses exist already (`sale_statuses`). **Appraisal (ประเมิน) is not an existing status**, so add one with a migration (stage `closing`, between loan approved and inspection). Counts come from the existing plot sale data.

**Done when:** The counts match the sales board, clicking a button filters the map, and it works on a phone.

## Step 3. Weekly plan (construction side)

**What:** A monthly → weekly plan with three work lists under each week: main work, DC, other work. Each item has an owner, a plot and a week.
- The weekly plan shows the sales items that need construction (open SRs, plots in inspect-house or waiting-transfer).
- A "meeting" marker on the week records that the plan was agreed.

**Where:** New tables (plan, plan items), new actions file and a new page under `app/dashboard/projects` or a top-level "แผนงาน" entry. Reuse `plot-phase-schedule` for the monthly targets.

**Open questions for June before building:** Who creates the weekly plan (PM only)? Can foremen tick items done?

## Step 4. Dashboard "This Week"

**What:** The mockup: four columns (Sales, Construction, Accounting/Purchasing, Unassigned) under the existing KPI cards, all fed from the weekly plan and request tables.
- **Sales column:** open SR count and TR count (TR shows 0 until step 2 is done).
- **Construction column:** inspect-house, main work, other work for this week.
- **Accounting/Purchasing column:** open PR count.
- **Unassigned:** plan items with no owner.

**Where:** `app/dashboard/page.tsx` and `actions/dashboard-actions.ts`. Sales role still gets its own dashboard (`/dashboard/sales/dashboard`) and never sees construction money.

**Done when:** Every number on the card links to the list it counts.

## Step 2. TR, SR approval and commission (sales side)

**What:**
- **TR (transfer request):** its own numbered document per plot sale. Lines: price, discount, promotion, commission. Flow: draft → submitted → **approved by Sales exec** → done. Feeds the customer check (เช็คลูกค้า) later.
- **SR approval:** today an SR goes straight to construction. Change it so a new SR first waits for the **Sales exec** to approve it, and only then does it appear in the construction queue.
- **Commission:** a fixed amount, with a default per project and an optional override per plot. The amount is copied onto the TR when it is created, so later rate changes don't alter old TRs.

**Open question for June before building:** Is "Sales exec" a new role, or an existing sales user who has an approver flag? Recommendation: a flag on the profile. A new role would touch every access rule in the database.

**Where:** New migration (TR table + number counter, commission table, SR approval status), `actions/sales-actions.ts`, `actions/sales-work-requests.ts`, plot sales tab, `app/dashboard/sales-requests`.

---

## Not in this plan yet

The owner approvals (red A) on the voucher, labor payment and customer check, the site-update step, and the material deduction line were not confirmed in the code check. Look at them after step 2.
