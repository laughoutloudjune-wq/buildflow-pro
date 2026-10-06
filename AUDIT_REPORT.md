# Buildflow Pro — System Audit Report

**Date:** 2026-09-23
**Scope:** Read-only review of the app code (`app/`, `actions/`, `components/`, `lib/`), the 93 database migrations, and the **live** Supabase database (functions, security rules, and row counts, checked with read-only queries). I changed no code and no data.
**Where numbers come from:** Counts marked "live" were queried from production on 2026-09-23.

---

## 0. Summary — read this first

The procurement, stock and billing flows are mostly built with care: the database does the heavy multi-step writes as single all-or-nothing operations, and many past bugs have been fixed properly. The serious problems fall into five areas:

1. **The database is open to anyone who has the public app key (Critical).** Someone who is *not logged in* can read, change or delete projects, plots, contractors, contractor job prices, contractor payment rows, the materials catalogue and BOQ. The key is shipped inside the website, so anyone who opens the login page has it. → **C-01**
2. **Some headline numbers are wrong today.** The dashboard's "Paid Out" card shows about **฿110k**. The real figure is about **฿1.6M** (job payments) or **฿2.2M** (bills marked paid out). Several reports quietly stop reading after 1,000 rows, and the main project already has **1,058** job rows. → **H-02, H-03**
3. **Money logic that will go wrong once used more:** supplier payment vouchers ignore PO discounts (H-01), a contractor bill can be re-approved or rejected after approval (H-04), a paid customer receipt can be deleted (H-07), and deleting a plot wipes its sale and payment history (H-06).
4. **Workflow gaps:** cancelling a PO leaves its purchase request looking "ordered", so the material is never bought (H-05). A sales user can't open a plot page because of a permission check (H-08). The permission screen says one thing while the buttons check another (M-02).
5. **Users almost never see why something failed.** Most refusals show a generic English error in production instead of the Thai reason (H-09). Thai and English are mixed across screens (U-01).

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 10 |
| Medium | 15 (M-01…M-14, U-01) |
| Low | 18 (L-01…L-17, U-02) |
| New work from June's answers | 4 (W-01…W-04, see §3) |
| Questions for June | all 15 answered (§3) |

**Update 2026-09-23:** June answered the questions. Her answers are recorded in §3 and the affected findings (H-02, M-02, M-03, M-07, M-08) have been adjusted. Q-04, Q-10 and Q-12 are closed with no action needed.

---

## 1. System map

### 1.1 Modules and who can use them

Access is set in `lib/permissions.ts` (defaults, which an admin can change in Settings → สิทธิ์ตามบทบาท). Many actions *also* hard-code a list of roles; see M-02.

| Module (sidebar section) | Pages | Default roles |
|---|---|---|
| ภาพรวม (Dashboard) | `/dashboard` | everyone logged in |
| ข้อมูลหลัก — Projects / Plots | `/dashboard/projects`, `/projects/[id]`, `/projects/[id]/[plotId]` | admin, pm, foreman |
| ข้อมูลหลัก — House models & BOQ | `/dashboard/boq`, `/boq/[id]` | admin, pm, foreman |
| ข้อมูลหลัก — Contractors | `/dashboard/contractors` | admin, pm |
| งานประจำวัน — Foreman | `/foreman/create-progress` (redirects to `/foreman/request`), `/foreman/create-dc`, `/foreman/history` | admin, foreman |
| งานประจำวัน — Billing (contractor bills) | `/dashboard/billing`, `/billing/request`, `/billing/[id]/review`, `/billing/[id]/print`, `/billing/create` (redirect) | admin, pm, accountant |
| ฝ่ายขาย — Sales | `/dashboard/sales` (board/table/map), `/sales/dashboard`, `/sales/receipts/[id]/print`, `/dashboard/sales-requests` | admin, pm, sales (+ foreman for work requests) |
| จัดซื้อ — Procurement | `/procurement/requests`, `/requests/[id]`, `/orders`, `/orders/create`, `/orders/[id]`, `/receipts`, `/payments` | admin, pm, accountant |
| สต็อก — Stock | `/dashboard/stock`, `/stock/[materialId]`, `/stock/movements`, `/stock/reports` | admin, pm, foreman |
| ควบคุมต้นทุน — Cost control | `/dashboard/cost-control` (qty / material cost / labour cost tabs) | admin, pm, accountant |
| รายงาน — Reports | `/reports/dc-history`, `/reports/house-history`, `/reports/contractor-cycle` (+ `/print`), `/reports/labor-budget` | admin, pm, accountant |
| ระบบ — Settings | `/settings` + users, permissions, companies, suppliers, materials, contractor-types, sale-statuses, signatures, billing-info, financial-defaults | admin |
| Auth | `/login`, `/set-password`, `/auth/confirm` | public |

**There is no accounting module.** Money is recorded in three places that don't connect: supplier payment vouchers (`payment_vouchers`), contractor payout flags on `billings` (plus a `payments` table written when a bill is approved), and customer payments (`sale_payments`). There is no ledger, chart of accounts or accounting export. See Q-09.

### 1.2 API routes (server endpoints)

| Route | Purpose | Login required? |
|---|---|---|
| `GET /api/procurement/orders/[id]/pdf` | PO as PDF/PNG (Puppeteer) | Yes (via `requireModuleAccess('procurement')` inside the data fetch) |
| `GET /api/procurement/requests/[id]/pdf` | One PR as PDF | Yes |
| `GET /api/procurement/requests/pdf?ids=` | Several PRs in one PDF | Yes |
| `GET /api/procurement/receipts/[id]/pdf` | Goods receipt (RI) PDF | Yes |
| `GET /auth/confirm` | Invite/password-reset link handler | Public (by design) |

Everything else runs through server actions in `actions/**` (about 190 exported functions) and database functions (RPCs).

### 1.3 Database tables (live, `public` schema)

| Area | Tables (approx. live rows) |
|---|---|
| Projects & construction | `projects` (32), `plots` (182), `plot_groups`, `plot_group_members` (41), `house_models`, `boq_master` (115), `job_assignments` (1,376), `contractors`, `contractor_types` |
| Contractor billing | `billings` (307), `billing_jobs` (311), `billing_adjustments` (680), `payments` (311), `notifications` (443) |
| Procurement | `suppliers` (61), `supplier_branches`, `companies`, `purchase_requests` (27), `purchase_request_items` (79), `purchase_request_plots`, `purchase_request_item_settlements`, `purchase_orders` (338), `purchase_order_items` (987), `purchase_order_plots`, `goods_receipts` (43), `goods_receipt_items` (108), `payment_vouchers` (0), `payment_voucher_receipts` (0), `po_boq_overrides`, `purchase_order_number_counters`, `goods_receipt_number_counters` |
| Materials & stock | `material_types` (1,376), `boq_material_items` (16), `stock_balances` (241), `stock_movements` (1,724) |
| Sales | `sale_statuses`, `customers` (36), `plot_sales` (36), `plot_sale_events`, `sale_payments` (0), `sale_receipt_number_counters`, `sales_work_requests` (1), `sales_work_request_number_counters` |
| Settings & users | `profiles` (5: 1 admin, 2 pm, 2 foreman), `organization_settings`, `document_signature_slots`, `settings` (legacy) |
| **Unused / leftover** | `invoices`, `invoice_items`, `master_data`, `progress_logs`, `inspections`, view `view_latest_progress` — nothing in the app reads them (L-01) |

### 1.4 Main workflows, traced through the code

**A. Buying materials: purchase request → approval → PO → receiving → payment**

1. **Purchase request (PR).** Raised on `/procurement/requests` via `createPurchaseRequest` → RPC `pr_create`, status `pending_review`. The database notifies PMs (`pr_pending_review`). The database lets a foreman create a PR, but the page and action need the `procurement` module, which foreman doesn't have (Q-01).
2. **Approve/reject.** `approvePurchaseRequest`/`rejectPurchaseRequest` → `pr_approve`/`pr_reject` (PM/Admin only). The requester is notified.
3. **Purchase order (PO).** `PurchaseOrderForm` → `createPurchaseOrder` → `po_create`. The PO gets `PO-YYYYMMDD###`, status `sent` (or `draft`). The PR's requested quantities are **reduced** by what was ordered, then `_pr_recompute_status` moves the PR to `ordered` when every line is covered. A BOQ check panel warns if the order goes over BOQ; an over-BOQ reason is saved in `po_boq_overrides`.
4. **Receiving.** On the PO page, "รับของ" → `GoodsReceiptModal` → `createGoodsReceipt` → `goods_receipt_create`. This creates an RI, adds to `quantity_received`, sets the PO to `partially_received`/`received`, posts stock movements (store = in; site = in + immediate out), overwrites the material's lead time, and closes the PR as `received` once all its POs are received.
5. **Undo receiving.** `unmarkPurchaseOrderReceived` → `po_unmark_received` reverses everything, unless a payment voucher exists or the stock has already been used.
6. **Payment.** `/procurement/receipts` → "สร้างใบสำคัญจ่าย" → `createPaymentVoucher` → `payment_voucher_create`. It totals the chosen receipts as *qty × unit price + VAT*. When every receipt on a PO is paid **and** the PO is fully `received`, the PO becomes `paid`. Voiding (`payment_voucher_void`) puts the PO back to `received`.
   *Live:* 0 payment vouchers exist yet. 265 POs are `paid` without any receipt or voucher; these came from the Excel import.

**B. Contractor progress billing: foreman → PM → payout**

1. **Job setup.** When a plot is created (`createPlot`), one `job_assignments` row is made per BOQ item of its house model, or copied from another plot. A PM assigns a contractor and agreed price (`assignContractor`, `updateAgreedPricePerUnit`) and moves the job out of `pending` (`updateJobStatus`). Only non-`pending` jobs can be billed.
2. **Request.** The foreman uses `/foreman/request` (the billing request page) → `createBillingRequest` → `billing_create_request`, status `pending_review`. A job can't have two pending requests; this is checked in the app code (not the database). PMs/admins are notified.
3. **Review.** `/billing/[id]/review` → PM edits amounts, WHT %, retention % → `approveBilling` → `billing_approve`. This replaces the job lines and adjustments, then **deletes and re-creates `payments` rows** (one per job, for the job amount only). `rejectBilling` → `billing_reject`. `undoApproveBilling` → `billing_undo_approve` deletes the `payments` rows.
4. **Payout.** `/reports/contractor-cycle` → `markBillingsAsPaidOut` sets `paid_out_at` plus the WHT/retention/deduction flags actually applied. `computeActualPayout` works out the transferred amount.
5. **Extra work (DC).** `/foreman/create-dc` → same pipeline with `type='extra_work'`. Only adjustments, no job lines. Reported on `/reports/dc-history`.

**C. Stock**

- **Stock in:** only through goods receipts (A.4), or the one-time opening balances.
- **Stock out:** `WithdrawDrawer` → `createStockWithdrawal` → `stock_request_create` (foreman/pm/admin; no approval step).
- **Count correction:** `createStockAdjustment` → `stock_adjustment_create` (pm/admin).
- **Reports:** `/stock/reports` (low stock, consumption by project/contractor, most active).

**D. Sales**

- **Board:** `/dashboard/sales` → `get_sales_board`. Status change → `sales_change_status`, which finds or creates the plot's `plot_sales` row and logs a `plot_sale_events` row.
- **Customer money:** `createSalePayment` / `generateDownPaymentSchedule` / `markSalePaymentPaid` write straight to `sale_payments`. Receipt numbers come from `sale_receipt_next_number`. The receipt prints at `/sales/receipts/[id]/print`.
- **Work requests to construction:** `sales_work_request_create` → queue on `/dashboard/sales-requests` → `sales_work_request_set_status` (accept → done), with notifications.

**E. Cost control:** `/dashboard/cost-control` compares BOQ planned quantity against issued (consumed) stock via `boq_control_rollup`, material cost via `getMaterialsSummaryForProject`, and labour via `getLaborLedger`.

---

## 2. Issues (sorted by severity)

Format: **ID · Category · Severity** / Where / What's wrong and how I know / Impact / Suggested fix / Effort

---

### CRITICAL

#### C-01 · Security / Data · Critical — Anyone with the public app key can read, change or delete core business data without logging in
- **Where:** Live database security rules on `projects`, `plots`, `plot_groups`, `plot_group_members`, `house_models`, `boq_master`, `boq_material_items`, `job_assignments`, `payments`, `contractors`, `contractor_types`, `material_types`, `inspections`, `settings`. Two more tables have security switched off entirely: `document_signature_slots` and `goods_receipt_number_counters`.
- **What / how I know:**
  - Each of these tables has one rule named "Allow all access" that applies to **everyone** (the `public` role, which includes the not-logged-in `anon` role), with condition `true`.
  - The `anon` role also holds SELECT/INSERT/UPDATE/DELETE rights on all of them (checked with `has_table_privilege('anon', …)`).
  - The Supabase security advisor also flags `rls_disabled_in_public` (ERROR) for the two tables with security switched off.
  - The "anon key" is public by design: it is in the JavaScript every visitor downloads.
- **Impact:** A stranger could:
  - download every contractor's agreed prices and every payment row;
  - change a job's agreed price, which changes what the foreman can bill;
  - delete `payments` rows, which makes finished work look unpaid so it can be billed again;
  - delete plots, projects or BOQ;
  - change who signs documents.

  The same open rules also let *any logged-in user* (for example a future sales user) edit these tables directly, going around every permission check in the app.
- **Suggested fix:**
  1. Right away, remove all rights from `anon` on these 16 tables. This is the same safe step already done for billing on 2026-09-14. Everything in the app runs as a logged-in user, so nothing should break; verify with one foreman and one PM login.
  2. Then replace each "Allow all access" rule with proper per-action rules for logged-in users (who may read, who may write), the way the sales and procurement tables already do it. Switch security on for the two tables that have it off.
- **Effort:** Step 1 small. Step 2 medium–large (write rules per table, test per role).

---

### HIGH

#### H-01 · Bug / Data inconsistency · High — Supplier payment vouchers ignore PO discounts, so suppliers would be overpaid
- **Where:** `components/procurement/GoodsReceiptModal.tsx:130` (`unit_price_at_receipt: item.unit_price`); live RPC `payment_voucher_create` (amount = `sum(quantity_received × unit_price_at_receipt)` + VAT); `lib/pdf/goodsReceiptHtml.ts:102`; `app/dashboard/procurement/receipts/ReceiptsPageClient.tsx:27`.
- **What / how I know:** `po_create` works out the PO total after line discounts and a header discount. The receipt stores the **gross** unit price, before any discount. The payment voucher then sums gross price × quantity and adds VAT on top. Neither kind of discount is ever subtracted.
- **Impact:** On any discounted PO, the payment voucher total is higher than the PO total, and the voucher is what gets paid. It's not happening yet (live: 0 vouchers, 1 discounted PO), but it will as soon as vouchers are used on discounted orders. The receipt printout and the receipts list show the same too-high value.
- **Suggested fix:** Save the *net* unit price on each receipt line: the line discount spread per unit, plus that line's share of the header discount. Or have the voucher work out each receipt's share of the PO's net total. Add a check that the total paid across all vouchers for a PO can never exceed the PO total.
- **Effort:** Medium.

#### H-02 · Bug / Data · High — The dashboard "Paid Out" figure sums only the last 20 payment rows
- **Where:** `actions/dashboard-actions.ts:25` (`payments … .limit(20)`) and `:79` (`totalPaid = payments.reduce(...)`); shown on `app/dashboard/page.tsx` as "Paid Out — From posted payments".
- **What / how I know:** The query fetches only 20 rows for the "recent payments" list, and the same 20 rows are summed for the headline total. Live: last-20 sum = **฿109,858**. Sum of all `payments` = **฿1,597,364**. Bills actually marked paid out = **฿2,244,676** (net).
- **Impact:** The first number the owner/PM sees is off by roughly 15–20×. Also, `payments` rows are created when a bill is **approved**, not when it is **paid**, and hold job amounts only (no DC/extra work, deductions or WHT). So even a correct sum would not mean "paid out" (see Q-07).
- **Suggested fix:** Work out the total in the database with a proper sum. **Decided (Q-07): "Paid Out" = money actually transferred to contractors**, i.e. bills with `paid_out_at` set, valued with `computeActualPayout` (after WHT/retention/deductions that were really applied). Label it "จ่ายผู้รับเหมาแล้ว". Ideally move all dashboard sums into one database function (already an open to-do in `PERF_HANDOFF`).
- **Effort:** Small (fix the sum) / Medium (database-side dashboard).

#### H-03 · Bug · High — Several reports silently stop reading after 1,000 rows, and some already have
- **Where:**
  - `actions/stock-actions.ts:279` `getConsumptionReport` (both queries have no paging).
  - `actions/labor-budget-actions.ts:102` `getLaborLedger` (job_assignments query).
  - `actions/dashboard-actions.ts:24` (all job_assignments).
  - `actions/stock-actions.ts:146` `getStockMovements` (hard `.limit(500)`).
- **What / how I know:** The database hands back at most 1,000 rows per request. `actions/_shared/fetch-all-rows.ts` exists because this already bit the materials list. Live counts:
  - `stock_movements`: 1,724 rows (1,238 "out", 1,689 not opening-balance).
  - `job_assignments`: 1,376 rows. **Arada Vela alone has 1,058**, so even a single-project labour ledger for the main project is missing rows.
  - The movements page comment says "the whole ledger is 117 rows today", which is out of date.
- **Impact:** Stock consumption by project/contractor, the labour ledger (สมุดบัญชีค่าแรง) and the dashboard "Active Jobs"/project completion quietly under-count. Nobody gets an error. The movements page shows only the newest 500 of 1,724 moves, so filtering to an older date shows nothing.
- **Suggested fix:** Use `fetchAllRows` (or better, sum in the database) for every report that reads these tables. Replace the 500 cap with real server-side filtering and paging on the movements page.
- **Effort:** Small–Medium.

#### H-04 · Workflow / Bug · High — A contractor bill can be approved again, rejected after approval, or reverted after being paid out
- **Where:**
  - Live RPCs `billing_approve` and `billing_reject` (no check of current status).
  - `billing_undo_approve` and `billing_delete` (no check of `paid_out_at`).
  - `app/dashboard/billing/[id]/review/ReviewBillingPageClient.tsx:567-573`: the "ปฏิเสธ" and "อนุมัติและจบงาน" buttons are always shown; "Undo Approve" (line 325) is shown for every approved bill, paid out or not.
- **What / how I know:**
  - `billing_approve` just updates the row to approved, for any status.
  - `billing_reject` sets status to rejected but, unlike undo-approve, **does not delete the `payments` rows** that approval created.
  - Neither undo nor delete looks at `paid_out_at`. The contractor-cycle page hides "undo" for paid-out bills, but the review page doesn't.
- **Impact:**
  - Rejecting an approved bill leaves its money counted as "already paid", so the contractor can't bill the rest of that job, and cost reports count a rejected bill.
  - Re-approving an already-paid-out bill can silently change amounts that were already transferred.
  - Undoing a paid-out bill sends it back to the foreman as editable while it still shows as paid.

  Live data is clean today (0 rejected bills with payment rows), so this is waiting to happen.
- **Suggested fix:** In the database:
  - approve only from `pending_review`;
  - reject only from `pending_review`;
  - refuse undo/delete when `paid_out_at` is set (unmark payout first).

  In the page, show approve/reject only for pending bills.
- **Effort:** Small.

#### H-05 · Workflow / Data · High — Cancelling a PO doesn't reopen its purchase request, so the material is never bought
- **Where:** Live RPCs `po_cancel`, `po_create`, `_pr_recompute_status`; compare with `po_delete`.
- **What / how I know:**
  - `po_create` **reduces** the PR line's `quantity_requested` by the quantity ordered, and closes lines marked `closes_request_line`.
  - `po_delete` gives the quantity back and recomputes the PR.
  - `po_cancel` only sets `status='cancelled'`. It doesn't give the quantity back or recompute the PR.
  - `_pr_recompute_status` also counts `closes_request_line` from **cancelled** POs, because it has no status filter.
- **Impact:** After a PO is cancelled (supplier out of stock, wrong vendor), the request still says "สั่งซื้อแล้ว". It drops off the "approved requests waiting for a PO" list, so nobody re-orders, and the site waits for material that isn't coming. The original requested quantity is also lost, because it was overwritten.
- **Suggested fix:** Make cancel do the same PR give-back as delete, and ignore cancelled POs when recomputing PR status. Better long term: stop overwriting `quantity_requested`; keep the requested quantity fixed and work out "outstanding" from the non-cancelled PO lines.
- **Effort:** Medium.

#### H-06 · Data · High — Deleting a plot permanently erases its sale, customer payments and receipts
- **Where:** `actions/plot-actions.ts:135` `deletePlot` (gated on `projects` only). Database delete rules: `plot_sales → plots` CASCADE, `sale_payments → plot_sales` CASCADE, `plot_sale_events → plot_sales` CASCADE, `sales_work_requests → plots` CASCADE, `job_assignments → plots` CASCADE, `payments → job_assignments` CASCADE.
- **What / how I know:** Queried the live foreign-key delete rules. The deletion is only blocked if the plot has billed jobs (`billing_jobs` blocks it) or purchase/stock history.
- **Impact:** A PM tidying up a plot that has a buyer but no construction bills yet removes the whole sale record: customer link, status history, every down-payment row and every numbered receipt. It can't be undone. Receipts are financial documents and must not disappear.
- **Suggested fix:** Change those links to block deletion (not cascade) for `plot_sales` and `sale_payments`. Show a clear message ("this plot has a sale, cancel the sale first"). Consider "archive plot" instead of delete.
- **Effort:** Small.

#### H-07 · Data / Workflow · High — A paid customer payment with an issued receipt number can be deleted or overwritten
- **Where:** `actions/sale-payments-actions.ts:212` `deleteSalePayment` (no check on `paid_at`/`receipt_no`); `:110` `markSalePaymentPaid` (re-running it on an already-paid row overwrites `paid_at`, `amount_paid` and `method`).
- **What / how I know:** Both write directly to the table with no status check.
- **Impact:** Receipt numbers (`RC-…`) get gaps with no trace, and the record of money a customer paid can vanish or change after a receipt was printed and handed over. This is an audit and tax problem.
- **Suggested fix:** Once a payment has a receipt number, block delete and edit. Add a "void receipt" action that keeps the row, records who, when and why, and prints "ยกเลิก" on the receipt.
- **Effort:** Small–Medium.

#### H-08 · Workflow / Bug · High — Sales users can't open the plot page the sales board links to
- **Where:** `app/dashboard/projects/layout.tsx:4` (`requireModuleAccess('projects')`) wraps `app/dashboard/projects/[id]/[plotId]/page.tsx`. Links from `app/dashboard/sales/SalesBoardPageClient.tsx:250,376,456`.
- **What / how I know:** The sales plan widened the plot page to allow `['projects','sales']`, but the section's layout runs first and still requires `projects`. The default `sales` role has `projects:false`, so it gets bounced to `/dashboard`.
- **Impact:** When sales staff get accounts (none exist yet: live roles are 1 admin, 2 pm, 2 foreman), every plot link on the sales board, the table and the overdue-payments card sends them back to the dashboard. The การขาย tab, payments and receipts on the plot page are unreachable for them.
- **Suggested fix:** Let the projects layout allow `['projects','sales']` (the plot page already hides cost data for sales), or move the plot page's check into the page itself. Test with a sales login.
- **Effort:** Small.

#### H-09 · UX / Bug · High — In production, users see a generic English error instead of the real (Thai) reason
- **Where:** Every server action that `throw`s a message instead of returning it. For example:
  - `actions/procurement/orders.ts:257` `unmarkPurchaseOrderReceived`, whose carefully translated "can't undo, already paid / already withdrawn" messages are thrown;
  - `createGoodsReceipt`, `voidPaymentVoucher`, `cancelPurchaseOrder`, `deletePurchaseOrder`, `approvePurchaseRequest`/`reject`, `createPurchaseRequest`;
  - all of `actions/billing/reviews.ts` (approve, reject, undo, mark paid out);
  - `createStockWithdrawal`, `createStockAdjustment`, most settings actions.
- **What / how I know:** The code's own comment at `actions/procurement/orders.ts:151-160` explains that Next.js removes the message from any error thrown across a server-action boundary in production. That is why a few actions were switched to return `{ error }`. Most weren't. The billing database functions also raise English-only messages ("Can edit pending review only", "Only PM/Admin can approve billing") with no Thai translation table.
- **Impact:**
  - A foreman whose stock withdrawal is refused for insufficient stock sees "An error occurred in the Server Components render…".
  - A PM whose "undo receiving" is refused doesn't learn that a payment voucher is the reason.
  - Non-technical users can't fix what they can't read, so they will call June.
- **Suggested fix:** Use one pattern everywhere: actions return `{ ok } | { error: thaiMessage }` and never throw for expected refusals. Keep one shared English→Thai translation list for database error messages.
- **Effort:** Medium (many files, mechanical).

#### H-10 · Security / Data · High — Any logged-in user can rewrite contractor bills directly (known issue, still open)
- **Where:** Live rules on `billings`, `billing_jobs`, `billing_adjustments`: "Allow all" (`ALL`, role `public`, condition `true`) next to the intended `*_select` rules.
- **What / how I know:** Recorded in project notes on 2026-09-14 and re-confirmed live today. Anonymous access was removed then; logged-in access is still wide open.
- **Impact:** Any logged-in user, including a foreman, can call the database directly and set their own bill to `approved`, change `net_amount`, or delete bills, skipping PM review. The intended "foreman sees only own bills" filter doesn't apply either.
- **Suggested fix:** As already planned: write insert/update/delete rules (writes only through the approval functions; foreman edits only own pending bills), test with a foreman login, then drop "Allow all".
- **Effort:** Medium.

---

### MEDIUM

#### M-01 · Bug · Medium — "Today" is worked out in UTC, so before 07:00 Thai time forms default to yesterday
- **Where:**
  - Screens: `components/procurement/PurchaseOrderForm.tsx:292` (PO date → also the PO number), `components/procurement/GoodsReceiptModal.tsx:39,66` (received date → RI number), `app/dashboard/procurement/receipts/ReceiptsPageClient.tsx:59` (payment date), `components/plots/PlotPaymentsSection.tsx:285`.
  - Server (Vercel runs in UTC): `app/dashboard/billing/[id]/review/page.tsx:19`, `app/dashboard/reports/contractor-cycle/page.tsx:24`, `actions/sale-payments-actions.ts:94,116,233`, `actions/sales-work-requests.ts:137`, and the dashboard month start/end in `dashboard-actions.ts`.
- **What / how I know:** All of these use `new Date().toISOString().slice(0,10)`, which gives the UTC date.
- **Impact:** Early-morning entries (foremen and deliveries often start before 7am) get yesterday's date. The PO/RI number carries the wrong day. "Overdue" customer payments are a day off. Month-end dashboard totals shift by 7 hours.
- **Suggested fix:** Use one shared "today in Asia/Bangkok" helper everywhere.
- **Effort:** Small.

#### M-02 · Workflow / Incompatibility · Medium — The permission screen and the action buttons disagree
- **Where:** `lib/permissions.ts` (editable matrix) vs hard-coded role lists in `requireAuthRole(['admin','pm'])` across `actions/procurement/*`, `actions/billing/reviews.ts`, `actions/settings-actions.ts` (admin only), and the database functions (`v_role not in ('pm','admin')`).
- **What / how I know:**
  - `accountant` gets `procurement` and `billing` by default, but can't create a PO, receive goods, create a payment voucher, approve a bill or mark a payout. Every write refuses them.
  - Granting `settings` to a PM shows the settings pages, but every save needs `admin`.
  - The reverse also happens: the database lets a foreman create a PR (`pr_create` allows foreman), but the app requires the `procurement` module.
- **Impact:** An admin who ticks a box in สิทธิ์ตามบทบาท expects it to work. Users see pages full of buttons that all fail, and the failures are masked by H-09.
- **Suggested fix:** Pick one source of truth. Either split the matrix into "view" and "approve/pay" rights and check those in both app and database, or clearly label on the permissions screen which actions are fixed to PM/Admin. Hide buttons the user can't use.
- **Decided by June's answers:**
  - **Foreman** raises purchase requests; purchasing staff raise POs (Q-01) → W-01.
  - **Purchasing** records deliveries from the delivery invoice (Q-02). Receipts stay office-only; the open point is which login role purchasing staff have (Q-13).
  - **Accountant** works only on contractor payments (Q-03): they need the contractor payment cycle page and the "mark paid out / unmark" buttons, and **no** procurement or cost-control access. Today's default gives the opposite (procurement yes, payout buttons no) → W-02.
- **Effort:** Medium–Large.

#### M-03 · Security / Data · Medium — Cost figures reach roles that shouldn't see them (breaks "sales sees price, never cost")
- **Where:** Ungated reads: `getDashboardStats` (shown to every role on `/dashboard`), `actions/billing/reports.ts` (`getBillings`, `getBillingById`, `getApprovedContractorCycleReport`, `getPlotHistoryReport`, `getExtraWorkReport`), `actions/billing/lookups.ts` (`getBillableJobs`, `getBillingOptions`, `getJobProgressHistory`), `actions/contractor-actions.ts` `getContractors`, `actions/job-actions.ts` `getJobAssignments`. Combined with the open rules in C-01/H-10.
- **What / how I know:** None of these check module access; the database doesn't filter either.
- **Impact:** A sales or foreman login sees contractor payout totals on the dashboard (Approved This Month, Paid Out, contractor risk list with amounts), and could fetch any bill or contractor rate.
- **Suggested fix:** Add module checks to every read action. **Decided (Q-08): sales must see no construction money at all; foreman may.** So: hide every money card and contractor amount on `/dashboard` for sales, block sales from the billing/contractor/job read actions, and give sales its own dashboard (the sales dashboard already exists). Foreman keeps seeing money.
- **Effort:** Small–Medium.

#### M-04 · Workflow · Medium — A partly delivered PO has no "close short" or cancel path
- **Where:** `app/dashboard/procurement/orders/[id]/PurchaseOrderDetailPageClient.tsx` (`canCancel` = draft/sent only); live `po_cancel` refuses when anything was received; `payment_voucher_create` only marks a PO `paid` when status is `received`.
- **What / how I know:** From `partially_received` the only ways out are receive the rest, or edit the ordered quantity down to what arrived (the edit function allows this, but nothing tells the user).
- **Impact:** When a supplier can't deliver the rest, the PO stays "รับของบางส่วน" forever, never reaches "ชำระแล้ว", and clutters the open-orders list and BOQ "ordered" totals.
- **Suggested fix:** Add a "ปิดใบสั่งซื้อ (ส่งไม่ครบ)" action that sets the ordered quantity to the received quantity, with a reason, and recomputes status and the PR.
- **Effort:** Small–Medium.

#### M-05 · Validation · Medium — A contractor bill can exceed the job's contract value
- **Where:** `app/dashboard/billing/request/CreateBillingRequestPageClient.tsx:125-144` (`handleAmountChange` doesn't cap), `:385` (`max=` on the input only); review page has no cap; `lib/billing.ts` `validateBillingPayload` and `billing_approve` don't check remaining value.
- **What / how I know:** `remainingAfter` is clamped to 0 for display (`:351`), which hides an over-request. Progress % can exceed 100 when entered via the amount box.
- **Impact:** A foreman typo (an extra zero) or deliberate over-billing passes to the PM looking like "คงเหลือ 0". Only the PM's attention prevents overpaying a contractor. Live data is clean (0 over-billed jobs).
- **Suggested fix:** Check in the database at approval that each job's total approved amount ≤ contract value (or allow with a required reason). Show a red warning in both forms when the amount is over the remaining value.
- **Effort:** Small–Medium.

#### M-06 · Bug · Medium — Marking contractor payouts isn't all-or-nothing and can overwrite a previous payout
- **Where:** `actions/billing/reviews.ts:140` `markBillingsAsPaidOut` (one separate update per bill, run in parallel, no check of existing `paid_out_at`); `:185` `unmarkBillingsAsPaidOut` (no status filter).
- **What / how I know:** From reading the code.
- **Impact:** If one update fails midway, some bills are marked paid and others aren't, and the user sees a generic error (H-09). Re-marking a batch that includes an already-paid bill changes its recorded pay date and WHT/retention amounts, which breaks the payment history used for WHT certificates.
- **Suggested fix:** One database function that marks the whole batch in a single all-or-nothing step and refuses bills that are already paid out.
- **Effort:** Small.

#### M-07 · Data inconsistency · Medium — 43 job rows belong to a different house model than their plot
- **Where:** Live data: `job_assignments ⋈ boq_master` where `boq_master.house_model_id ≠ plots.house_model_id` = **43 rows**. Causes: `actions/plot-actions.ts` `createPlot` "copy from another plot" doesn't check the source plot uses the same model; changing a plot's house model doesn't remove the old model's jobs (`syncPlotJobs` in `actions/job-actions.ts:100` only adds).
- **Impact:** Those plots show, and can be billed for, jobs from the wrong house. Progress %, labour budget and cost-per-house are wrong for them.
- **Detail (checked live after Q-11):** the 43 rows are on 4 plots, and ฿67,000 has already been paid against them:

  | Plot | Plot's house model | Jobs came from | Jobs | Billed | Paid |
  |---|---|---|---|---|---|
  | Arada Vela 92 | Cozy B (Arada Vela) | Cozy B **of Arada Prime** | 14 | 1 | ฿1,400 |
  | Arada Vela 119 | Cozy B (Arada Vela) | Cozy B **of Arada Prime** | 14 | 2 | ฿3,900 |
  | Arada Vela 93 | **Cozy A** | a Cozy B BOQ | 14 | 5 | ฿60,900 |
  | Arada Prime 29 | Prime A | Prime B (water pump install only) | 1 | 1 | ฿800 |

  House models are separate per project: "Cozy B" in Arada Prime and "Cozy B" in Arada Vela are two different BOQs with their own prices. Plots 92/119 were most likely created by "copy jobs from another plot" and a plot from the other project was picked. Plot 93 is either a Cozy A house carrying Cozy B work by mistake, or its house model was changed after its jobs were made.
- **Suggested fix:** Only allow copying from a plot in the same project with the same model. When the model changes, list jobs that don't belong and let the PM remove the unbilled ones. **Decided: leave the 4 existing plots as they are; guard the future only.**
- **Effort:** Small (guard) + data review.

#### M-08 · Bug · Medium — Receiving goods isn't checked against the PO's status or quantities in the database
- **Where:** Live `goods_receipt_create`.
- **What / how I know:**
  - It doesn't check that the PO is `sent`/`partially_received` (so receiving against a `draft`/`cancelled` PO is possible if called directly).
  - It doesn't check that `quantity_received` ≤ outstanding.
  - It doesn't check that each line belongs to this PO. The stock posting loop doesn't filter by PO, so a stray line from another PO would post stock without updating that PO's quantities.

  Today only the screen prevents this (`canReceive`, pre-filled remaining quantity), and the quantity box isn't capped there either.
- **Impact:** Over-receipt inflates stock and makes the PO look over-delivered, and payment would then pay for more than was ordered. Cancelled POs could come back to life as "partially_received".
- **Suggested fix:** Add the status check and the "line belongs to this PO" check. **Decided (Q-05): over-delivery is allowed** (rare), so don't block it; instead show a yellow warning on the receive screen when the quantity is above what's outstanding, and keep payment based on what was actually received.
- **Effort:** Small.

#### M-09 · Data / Report · Medium — The stock consumption report adds up quantities in different units
- **Where:** `actions/stock-actions.ts:279-340` `getConsumptionReport` (byProject/byContractor sum `quantity` across all materials).
- **Impact:** "Project X consumed 4,312" mixes bags of cement, metres of pipe and pieces of tile. The number means nothing, but it looks precise.
- **Suggested fix:** Show value (quantity × last cost) or a count of movements, or require choosing one material first.
- **Effort:** Small.

#### M-10 · Workflow · Medium — Users can't be deactivated, and an admin can remove their own admin role
- **Where:** `app/dashboard/settings/users/UsersPageClient.tsx` (no disable/remove); `actions/settings-actions.ts:262` `updateUserRole` (no guard for the last admin or self-demotion; the new role isn't validated in code).
- **Impact:** A departed foreman keeps a working login (with the open rules in C-01/H-10, that means real data access). An admin who accidentally demotes themself leaves no admin to fix it.
- **Suggested fix:** Add "ปิดการใช้งาน" (ban the user in Supabase Auth) and block removing the last admin.
- **Effort:** Small–Medium.

#### M-11 · Data inconsistency · Medium — "Paid", "approved" and "net" mean different things in different places
- **Where:**
  - `payments` rows = job amounts at approval (no adjustments/DC);
  - `billings.net_amount` = work + additions − deductions (no WHT/retention);
  - `computeActualPayout` = what was actually transferred;
  - dashboard "Approved This Month" uses `net_amount` by `billing_date`;
  - "Recently Approved" uses `approved_at`;
  - labour ledger reads `payments`.
- **Impact:** The dashboard, contractor-cycle, labour ledger and house-history can show different "paid" totals for the same contractor or plot. Managers can't reconcile them.
- **Suggested fix:** Define 3 named figures (Approved, Transferred, Withheld) in one shared function or database view and use them everywhere. Consider retiring `payments` in favour of `billing_jobs` + `paid_out_at`.
- **Effort:** Medium.

#### M-12 · Workflow · Medium — Deleting a BOQ line or house model can silently delete jobs and their payment rows
- **Where:** `actions/boq-actions.ts:148` `deleteBOQItem`, `:60` `deleteHouseModel`. Delete rules: `job_assignments → boq_master` CASCADE, `payments → job_assignments` CASCADE (blocked only when `billing_jobs` exist).
- **Impact:** Removing a BOQ line that has un-billed but assigned jobs (contractor + agreed price set), or legacy payments not linked to a bill, deletes those without warning across every plot using the model.
- **Suggested fix:** Before deleting, count affected jobs across plots and require confirmation, or block if any job has a contractor/price/payment. Prefer "retire line" over delete.
- **Effort:** Small.

#### M-13 · UX / Workflow · Medium — Undoing a receipt is all-or-nothing, and the PO page doesn't list its receipts
- **Where:** `PurchaseOrderDetailPageClient.tsx`; `getGoodsReceiptsForOrder` exists in `actions/procurement/receipts.ts` but nothing on screen uses it.
- **Impact:** To fix one wrong delivery out of three, the PM must undo all three and re-enter two. On the PO page they can't see which RIs exist or their dates.
- **Suggested fix:** Show a "ใบรับสินค้า" list on the PO page, with per-receipt undo later.
- **Effort:** Medium.

#### M-14 · Workflow · Medium — Not every step sends a notification
- **Where:** Live `notifications.type` allows 8 types. POs, receipts, payment vouchers and stock withdrawals send none; `po_create` and `goods_receipt_create` contain no notification insert.
- **Impact:** The foreman who asked for material isn't told when it's ordered or delivered, and the office isn't told when material arrives on site. People keep asking each other by LINE.
- **Suggested fix:** Notify the PR requester when a PO is raised against their request and when goods are received.
- **Effort:** Small–Medium.

---

### LOW

#### L-01 · Incompatibility / Outdated code · Low — Leftover tables, views and actions
- **Where:**
  - Tables `invoices`, `invoice_items`, `master_data`, `progress_logs`, `inspections`, `settings`, and view `view_latest_progress` (flagged "Security Definer View" ERROR by the advisor). Nothing reads them.
  - Unused actions: `getCurrentViewerRole`/`getCurrentViewerPermissions` (`actions/auth-actions.ts`, which still use the slow `getUser()`), `getGoodsReceiptsForOrder`, `getPaymentVoucherById`, `getCurrentRequesterId`.
  - `markPurchaseOrderReceived` (`actions/procurement/orders.ts:242` → `po_mark_received`) is still callable although no screen uses it. It sets a PO to `received` **without** a receipt or stock movement, which is exactly the "status label only" behaviour removed today.
- **Suggested fix:** Drop the unused tables and view after a final check. Delete the unused actions, especially `markPurchaseOrderReceived`/`po_mark_received`.
- **Effort:** Small.

#### L-02 · Security hygiene · Low — Database advisor warnings
- `payment_voucher_create`/`payment_voucher_void` can still be called by `anon`. They refuse internally (the role lookup returns `''`), but the right should be revoked like the other functions.
- 6 functions have an unpinned search path (`get_sales_board`, `get_sales_dashboard`, `_profiles_guard_role_change`, …).
- Leaked-password protection is off in Supabase Auth.
- **Effort:** Small.

#### L-03 · Security · Low — The invite/reset link handler accepts any `next` value
- **Where:** `app/auth/confirm/route.ts:16` → redirects to `${origin}${next}`.
- **Impact:** A crafted `next=@evil.example` would send someone to another site *after* a valid login link is used. Low risk, since it needs a real token.
- **Suggested fix:** Accept only paths starting with a single `/`.
- **Effort:** Small.

#### L-04 · Data · Low — Duplicate link from job_assignments to boq_master with different delete rules
- There are two constraints on the same link, one CASCADE and one NO ACTION. **Fix:** Drop one after choosing the intended behaviour (see M-12). **Effort:** Small.

#### L-05 · Data · Low — Billing adjustment "signature" and plot name are packed into the description text
- **Where:** `actions/_shared/billing-adjustments.ts` `encodeAdjustmentDescription`. Reports have to decode free text.
- **Fix:** Separate columns. **Effort:** Medium.

#### L-06 · Bug · Low — Down-payment schedule jumps a month when the contract date is the 29th–31st
- **Where:** `actions/sale-payments-actions.ts:190` (`setMonth(+n)`: 31 Jan + 1 month → 3 Mar).
- **Fix:** Clamp to the last day of the month. **Effort:** Small.

#### L-07 · Validation · Low — Customer payment amounts aren't validated
- **Where:** `createSalePayment` accepts 0/negative `amount_due`; a non-numeric amount_paid → database error text shown raw.
- **Effort:** Small.

#### L-08 · Bug · Low — `getBillableJobs` hides errors as "no jobs"
- **Where:** `actions/billing/lookups.ts:149` (`console.error` then `return []`).
- **Impact:** A network/permission failure looks like "this contractor has nothing to bill".
- **Effort:** Small.

#### L-09 · Data · Low — `billing_reject` overwrites the foreman's note and records the rejecter as `approved_by`
- **Fix:** Separate `review_note`/`reviewed_by` fields, the same as purchase requests already have. **Effort:** Small.

#### L-10 · Bug · Low — `createPlot` isn't all-or-nothing
- **Where:** `actions/plot-actions.ts` `createPlot`. The plot is inserted, then jobs; if the jobs insert fails, the plot stays with no jobs.
- **Fix:** One database function. **Effort:** Small.

#### L-11 · Performance / Scale · Low — Lists load everything at once
- **Where:** PO list (all 338 POs with every item), receipts, payments, billing list, dashboard 500-bill limit (`dashboard-actions.ts`: monthly figures will under-count once there are more than 500 bills).
- **Effort:** Medium.

#### L-12 · Testing · Low — Few automated tests
- 5 end-to-end specs (`tests/e2e`), and none cover the PO → receipt → voucher money path or billing approve/reject/payout, the areas where H-01/H-04/H-05 live.
- **Effort:** Medium.

#### L-13 · UX · Low — Header title shows "BuildFlow" on many pages
- **Where:** `lib/dashboard-page-titles.ts` has no entries for `/procurement/*`, `/stock/*`, `/sales*`, `/sales-requests`, or most settings sub-pages.
- **Effort:** Small.

#### L-14 · UX · Low — Browser pop-ups instead of the app's own dialog
- **Where:** `confirm()` in 20 files, `prompt()` for the PO cancel reason (`PurchaseOrderDetailPageClient.tsx`) and in `SalesRequestsPageClient.tsx`, `alert()` in 3 files. Only the billing screens use `ConfirmDialog`.
- **Impact:** Looks inconsistent. On phones (foreman) native pop-ups are small, and the "cancel reason" box gives no hint about what to write.
- **Effort:** Small–Medium.

#### L-15 · UX · Low — Missing search/filter where lists will grow
- No search on: purchase requests list, projects list, house models/BOQ, foreman history, sales work-request queue.
- Only the PO list has paging.
- **Effort:** Small each.

#### L-16 · UX · Low — Dead "preview" tab on the billing review page
- **Where:** `ReviewBillingPageClient.tsx:580` renders a PDF preview for `activeTab === 'preview'`, but only the "แก้ไขข้อมูล" tab button exists.
- **Fix:** Add the tab or remove the code. **Effort:** Small.

#### L-17 · UX · Low — Same words, different styling or wording
- PO status "ยืนยันสั่งซื้อ" is green in the list but indigo on the detail page.
- Status label lists are copied into 4+ files (`PurchaseOrdersPageClient`, `PurchaseOrderDetailPageClient`, `MaterialCostTab`, `PurchaseRequestDetail`, …), so they will drift.
- Sidebar says "คำขอซื้อ", notifications say "ใบขอซื้อ".
- **Fix:** One shared status/label file. **Effort:** Small.

---

### USER EXPERIENCE (cross-cutting)

#### U-01 · UX · Medium — Thai and English are mixed across screens
- **Examples:**
  - The whole dashboard is English ("Dashboard Overview", "Total Projects", "Active Jobs", "Paid Out", "Open PM Queue", "Quality Alerts") — `app/dashboard/page.tsx`.
  - Sidebar: "Dashboard", "ตรวจหน้างาน (Foreman)", "รายการเบิกจ่าย (For PM)" — `Sidebar.tsx:49,62,63`.
  - Billing review: "Undo Approve", "EXTRA WORK", "Foreman %", "PM %".
  - Every billing database error is English; many server messages are English ("Project is required", "At least one material line is required").
- **Impact:** Office staff and foremen who don't read English get lost at the very first screen and at every error.
- **Suggested fix:** Thai-first labels everywhere (English only in brackets where it's a known term, e.g. "BOQ", "DC", "PO"), plus the shared error translation list from H-09.
- **Effort:** Medium.

#### U-02 · UX · Low — Too many ways to open the same thing
- The PO opens as a modal from the list and as a full page from links; PRs the same. Behaviour after save differs slightly between them (see `onRefresh` comments in `PurchaseOrderDetailPageClient.tsx`).
- **Fix:** Pick one (the full page is simpler to share by link). **Effort:** Medium.

---

## 3. June's answers (2026-09-23) and what they change

| # | Question | June's answer | What it means for the work |
|---|---|---|---|
| Q-01 | Should foremen raise purchase requests? | **Yes. Foreman requests, purchasing raises the PO.** | New work **W-01**. |
| Q-02 | Who records deliveries? | **Purchasing, from the supplier's delivery invoice.** | Receipts stay office-side, no change to who can receive. See new Q-13 about which login role purchasing uses. |
| Q-03 | What does the accountant do? | **Contractor payments only. No procurement.** | New work **W-02**. |
| Q-04 | Is public sign-up off? | **Yes, invite only.** | Closed. No action. |
| Q-05 | Can suppliers over-deliver? | **Allowed, but rare.** | M-08 changed: warn, don't block. |
| Q-06 | What happens to a rejected bill? | **Show it in a "rejected" tab. The foreman can edit/recheck it and send it again for approval.** | New work **W-03**. Also confirms H-04: rejecting must fully undo any approval money. |
| Q-07 | What does "Paid Out" mean? | **Money actually transferred to contractors.** | H-02 fix defined. |
| Q-08 | Who sees construction money on the dashboard? | **Sales: never. Foreman: yes.** | M-03 fix defined. |
| Q-09 | Accounting module? | **Maybe a small one in future.** | Not now. When H-01/M-11 are fixed, keep the three money records easy to join later (clear dates, amounts, WHT/VAT columns). |
| Q-10 | Keep the 265 imported "paid" POs as they are? | **Keep the data, it may matter for reports.** | Closed, no clean-up. Every fix must leave these rows untouched. Suggest marking them as "imported" so reports can include/exclude them on purpose (**W-04**). |
| Q-11 | The 43 job rows from another house model? | **Asked for more explanation.** | Explained in M-07 (4 plots, ฿67,000 paid). Needs a site check per plot. |
| Q-12 | Should stock withdrawals need approval? | **No, it's recording only.** | Closed. No action. |

### New work from the answers

#### W-01 · Workflow · High — Foreman purchase request page
- **Today:** the database already lets a foreman create a request and notifies PMs, but the procurement menu (and `createPurchaseRequest`, which checks the `procurement` module) is closed to foreman.
- **Build:** a simple "ขอซื้อวัสดุ" page inside the foreman menu (phone-friendly): project/plot, materials, quantities, needed-by date, plus "my requests" with status. The foreman should not see supplier prices or POs. Notify the foreman when the request is approved, rejected, ordered and received (links to M-14).
- **Effort:** Medium.

#### W-02 · Workflow / Permissions · Medium — Accountant = contractor payments only
- **Today:** accountant defaults to billing, reports, procurement and cost control, but the payout buttons (`markBillingsAsPaidOut` / `unmarkBillingsAsPaidOut`) refuse anyone who isn't PM/Admin.
- **Build:** default accountant permissions to the contractor payment cycle page (and billing list read-only) only. Remove procurement and cost control. Allow accountant to mark/unmark paid out. Approving bills stays PM/Admin. The contractor cycle page currently sits in the "reports" module together with other reports, so it may need its own permission.
- **Effort:** Small–Medium.

#### W-03 · Workflow · Medium — Rejected bills: a tab, edit and resubmit
- **Today:** `billing_update_request` only allows editing while `pending_review`. A rejected bill is a dead end, so the foreman re-types a new one.
- **Build:** a "ถูกปฏิเสธ" tab on the foreman history page and the PM billing list. Show the PM's reason (store it separately, see L-09, instead of overwriting the foreman's note). Allow the foreman to edit a rejected bill and "ส่งตรวจอีกครั้ง", which moves it back to pending and notifies PMs. Keep a small history (rejected on X by Y, resubmitted on Z).
- **Effort:** Medium.

#### W-04 · Data · Low — Mark imported history
- Add an "imported from old system" flag to the 288 imported POs (they are already identifiable by their note `นำเข้าจากระบบเดิม`). Reports can then show or hide them on purpose rather than by accident.
- **Effort:** Small.

### Second round of answers (2026-09-23)

| # | Question | June's answer | What it means for the work |
|---|---|---|---|
| Q-13 | What login role do purchasing staff use? | **Admin.** | No new "purchasing" role. PO, receiving and payment vouchers stay PM/Admin. |
| Q-14 | Arada Vela plots 1–24 have no jobs, and duplicate same-name house types exist | **Not started yet, no plan right now.** | No action. |
| Q-15 | What's correct on site for the 4 mismatched plots? | **Leave the past as it is.** | No data clean-up. |
| (M-07) | Mismatched house types | **From now on, only allow copying jobs from a plot with the same house type. Leave past history alone.** | M-07 fix is now "future guard only" (see HANDOVER_PLAN.md). |

---

## 4. Suggested order of work

1. **This week (safety):** C-01 step 1 (remove anonymous access, small), H-04 (bill status guards), H-06 + H-07 (protect sales money records), H-08 (sales plot page), H-02 (dashboard sum).
2. **Next (correct numbers):** H-03 (row limits), H-01 (payment discounts), H-05 (PO cancel → PR), M-01 (Thai date), M-06, M-08.
3. **Then (usability and the new work):** W-01 (foreman purchase requests), W-02 (accountant), W-03 (rejected bills), H-09 + U-01 (Thai errors and labels), M-02, M-04, M-13, M-14.
4. **Then (security finish):** C-01 step 2 and H-10 (proper per-table rules, tested per role), M-03, M-10.
5. **Cleanup:** L-items.

---

## 5. How this audit was done, and its limits

- **Read:** all route/page entry files, all server actions for procurement, billing, stock, settings, dashboard, plots and sales payments, and the key screens (PO detail, goods receipt modal, billing request and review, sidebar/layout).
- **Live database:** pulled the current definitions of the procurement, billing and payment functions (the migrations were rewritten many times, so the live version is what counts), the security rules and rights for every table, delete rules for every link, and row counts. All queries were read-only.
- **Not done:** I didn't log in or click through the app, so UX findings come from the code, not from watching users. The 1,745-line contractor-cycle page, the sales import tool, the site-plan map and the PDF templates got only a light read. Some Low/UX issues there are probably missed.
