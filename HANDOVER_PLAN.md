# Buildflow Pro — Handover Plan (fixes from the 2026-09-23 audit)

**Written:** 2026-09-23
**Source:** `AUDIT_REPORT.md` (same folder). Issue IDs below (C-01, H-04, W-01…) refer to that report; read the matching section before starting a task.
**Owner decisions:** every "Decided" note below is June's answer and is final. Don't reopen it.

This plan is for whoever picks up the work next (a developer or a Claude session). Phases are in priority order. Each task says **what**, **where**, **how**, and **done when**. Finish and ship one phase before starting the next.

---

## 0. Ground rules (read before touching anything)

1. **Live database = production.** Supabase project `ovgtetlvzoremixrjoob` (ap-south-1). There is no staging copy.
2. **Ship a database change and its matching code together, in the same sitting.** Apply the migration, then commit and push the matching code to `main` right away (Vercel auto-deploys `main`). Never leave the live database ahead of the deployed app. This rule exists because it caused a real outage on 2026-09-23.
3. **Every migration also goes into `supabase/migrations/`** as `YYYYMMDDNNNN_short_name.sql`, restating functions in full (`create or replace function …`), the same way the existing files do.
4. **Server actions return errors; they don't throw them.** Next.js hides thrown messages in production. Pattern: `Promise<{ ok: true, … } | { error: string }>`, with the Thai message in `error`. Copy the style of `createPurchaseOrder` in `actions/procurement/orders.ts`.
5. **Thai first.** Every new label, button and message is Thai. Keep English only for known terms (BOQ, DC, PO, PR, WHT, VAT).
6. **Don't touch history:**
   - Leave the 288 imported POs (note starts `นำเข้าจากระบบเดิม`) as they are. Their status stays `paid` with no receipts or vouchers.
   - Leave the 43 mismatched job rows on plots Arada Vela 92/93/119 and Arada Prime 29 as they are.
   - Don't clean up Arada Vela plots 1–24.
7. **Before calling a task done:**
   - `npx tsc --noEmit` passes.
   - `npm run lint` passes.
   - `npx playwright test tests/e2e/boq-control-helpers.spec.ts` passes (no login needed).
   - After any migration, Supabase advisors show nothing new (`get_advisors` security + performance).
   - Anything that depends on role has been tried with a real **foreman**, **PM** and **admin** login. Ask June to sign in; don't mint sessions from the service key.
8. **Roles, as decided by June:**

   | Role | Does |
   |---|---|
   | admin | Everything. **Purchasing staff use admin** (no separate purchasing role). |
   | pm | Approves purchase requests and contractor bills; can also buy and receive. |
   | foreman | Contractor progress/DC bills, **purchase requests (new)**, stock withdrawals. Can see construction money. |
   | accountant | **Contractor payments only**: the payment cycle page and marking paid out. No procurement, no cost control. |
   | sales | Sales pages only. **Never sees construction money.** |

---

## Phase 1 — Close the open database (security, do first)

**Why:** Anyone with the public key that ships inside the website can read, change or delete core data without logging in (C-01).

### 1.1 Remove anonymous access · C-01 step 1, L-02 · Small
- **Migration** `…_revoke_anon_core_tables.sql`:
  - `revoke all on table` … `from anon` for: `projects, plots, plot_groups, plot_group_members, house_models, boq_master, boq_material_items, job_assignments, payments, contractors, contractor_types, material_types, inspections, settings, document_signature_slots, goods_receipt_number_counters, purchase_orders, purchase_order_items, purchase_order_plots, purchase_requests, purchase_request_items, purchase_request_plots, purchase_request_item_settlements, goods_receipts, goods_receipt_items, payment_vouchers, payment_voucher_receipts, stock_balances, stock_movements, suppliers, companies, notifications`.
  - `revoke execute on function public.payment_voucher_create(jsonb), public.payment_voucher_void(uuid) from anon, public;` then `grant execute … to authenticated;`
  - `alter table public.goods_receipt_number_counters enable row level security;` with no policies (only the security-definer `goods_receipt_create` writes it). Also `revoke all … from authenticated`.
  - `alter table public.document_signature_slots enable row level security;` plus a policy that lets `authenticated` select, and one that lets only `_billing_current_role() = 'admin'` insert/update/delete. `replaceSignatureSlots` in `actions/signature-slots-actions.ts` writes as admin.
  - Put the rollback (`grant … to anon`) in a comment at the top, the same as `202609140001_billing_anon_revoke.sql`.
- **No app code change needed.** Every query runs as a logged-in user, and pages sit behind `/dashboard`.
- **Done when:**
  - `has_table_privilege('anon', t, 'SELECT')` is false for every table above.
  - The security advisor no longer shows `rls_disabled_in_public` or `anon_security_definer_function_executable`.
  - Foreman, PM and admin can each still open projects, a plot, stock, a PO and billing, create a stock withdrawal, and print a PO PDF.
  - The signature settings page still saves.

---

## Phase 2 — Stop money and records from going wrong

All of these are database guards plus small screen changes. Do them in one or two migrations and ship each with its code.

### 2.1 Contractor bill status rules · H-04 · Small
- **Migration:** restate these functions in full.
  - `billing_approve`: refuse unless the current status is `pending_review`.
  - `billing_reject`: refuse unless `pending_review`. If it ever runs on an approved bill, it must delete that bill's `payments` rows the same way `billing_undo_approve` does.
  - `billing_undo_approve` and `billing_delete`: refuse when `paid_out_at is not null` (message: unmark the payout first).
- **Screen:** `app/dashboard/billing/[id]/review/ReviewBillingPageClient.tsx`
  - Show ปฏิเสธ/อนุมัติ (around lines 567–573) only when `billing.status === 'pending_review'`.
  - Show "ย้อนสถานะอนุมัติ" (around line 325, currently labelled "Undo Approve") only when approved and not paid out.
  - Hide ลบ for paid-out bills.
- **Actions:** make `approveBilling`, `rejectBilling`, `undoApproveBilling` and `deleteBilling` (`actions/billing/reviews.ts`, `actions/billing/requests.ts`) return `{ error }` with Thai text instead of throwing.
- **Done when:** trying each blocked action shows a Thai reason, and the allowed paths still work end to end.

### 2.2 Protect sales money records · H-06, H-07 · Small–Medium
- **Migration:**
  - Change the foreign keys `plot_sales.plot_id → plots` and `sale_payments.plot_sale_id → plot_sales` from `ON DELETE CASCADE` to `ON DELETE RESTRICT`. Do the same for `plot_sale_events`.
  - Add columns to `sale_payments`: `voided_at timestamptz`, `voided_by uuid`, `void_reason text`.
- **Actions** (`actions/sale-payments-actions.ts`):
  - `deleteSalePayment`: refuse when `receipt_no` is set (Thai message: use void instead).
  - `markSalePaymentPaid`: refuse when already paid.
  - New `voidSalePayment(id, reason)`: sets the void fields and keeps the row and its receipt number.
- **Other screens:**
  - `deletePlot` (`actions/plot-actions.ts:135`): catch the foreign-key error and return "แปลงนี้มีข้อมูลการขาย ต้องยกเลิกการขายก่อน".
  - The receipt print (`app/dashboard/sales/receipts/[id]/print`) shows a large "ยกเลิก" when voided.
  - Overdue and total calculations ignore voided rows.
- **Done when:** a plot with a sale can't be deleted; a paid receipt can't be deleted or re-marked; a voided receipt prints as cancelled.

### 2.3 Cancelling a PO gives the request back · H-05 · Medium
- **Migration:**
  - `po_cancel`: before setting `cancelled`, add the ordered quantities back to the linked PR lines, using exactly the block already in `po_delete` (same-unit lines only). Then call `_pr_recompute_status`.
  - `_pr_recompute_status`: in the `closes_request_line` check, join `purchase_orders` and ignore `status = 'cancelled'`.
- **Done when:**
  - Test inside a transaction you roll back, the same way the 2026-09-23 undo-received fix was tested: PR → approve → PO for the whole quantity (PR becomes `ordered`) → cancel PO → PR is back to `approved` with the original quantity.

### 2.4 Receiving checks · M-08 · Small
- **Decided:** over-delivery is allowed, so warn but don't block.
- **Migration** `goods_receipt_create`:
  - Refuse unless the PO status is `sent` or `partially_received`.
  - Refuse any line whose `purchase_order_item_id` isn't on this PO.
  - Don't cap quantity.
- **Screen** `components/procurement/GoodsReceiptModal.tsx`: show a yellow warning next to any line where the entered quantity is above what's still outstanding.

### 2.5 Contractor payout in one step · M-06, part of W-02 · Small
- **Migration:** new `billing_mark_paid_out(p_items jsonb, p_paid_at date)`, security definer. Role must be `admin`, `pm` or `accountant`. All-or-nothing. Refuse any bill that isn't `approved` or is already paid out.
  - Also new `billing_unmark_paid_out(p_ids uuid[])`, with the same roles.
- **Actions:** `markBillingsAsPaidOut` / `unmarkBillingsAsPaidOut` in `actions/billing/reviews.ts` call these instead of the loop of separate updates. Role check `['admin','pm','accountant']`.

### 2.6 Separate rejection fields · L-09 (needed by W-03) · Small
- **Migration:** add to `billings`: `review_note text`, `reviewed_by uuid`, `reviewed_at timestamptz`.
  - `billing_reject` writes these and stops overwriting `note` and `approved_by`.
- **Screens:** show `review_note` wherever the rejection reason appears (foreman history, billing list, review page).

---

## Phase 3 — Make the numbers right

### 3.1 Dashboard totals · H-02, M-03, M-11 · Medium
- **Decided:** "Paid Out" means money actually transferred to contractors. Sales never see construction money; foreman can.
- **How:**
  - Replace `getDashboardStats` (`actions/dashboard-actions.ts`) with one SQL function, `get_dashboard_stats()`, that returns the KPIs.
  - "จ่ายผู้รับเหมาแล้ว" = the sum over bills with `paid_out_at` set of the actual payout. Copy the `computeActualPayout` formula from `lib/billing.ts` exactly.
  - Keep the other KPIs, computed without row limits.
- **Screen** `app/dashboard/page.tsx`:
  - Thai labels (see 5.2).
  - Money cards only for roles with `billing`, `reports`, `cost_control` or `foreman`.
  - A sales user sees no money cards; link them to `/dashboard/sales/dashboard`.
- **Gate reads:** add `requireModuleAccess` to every read in `actions/billing/reports.ts`, `actions/billing/lookups.ts`, `actions/contractor-actions.ts` `getContractors`, and `actions/job-actions.ts` `getJobAssignments`. Allowed modules: billing / reports / foreman / projects / cost_control, never sales.
- **Done when:**
  - The "Paid Out" card equals, within ฿1, a hand-run SQL sum of actual payouts. As of 2026-09-23 the net total of paid-out bills was about ฿2.24M before WHT/retention.
  - A sales login sees no baht figure on `/dashboard`.

### 3.2 Remove silent 1,000-row cut-offs · H-03 · Small–Medium
- **Where:**
  - `getConsumptionReport` (`actions/stock-actions.ts:279`)
  - `getLaborLedger` (`actions/labor-budget-actions.ts:102`)
  - `getStockMovements` (`actions/stock-actions.ts:146`, currently `.limit(500)`)
- **How:** use `fetchAllRows` (`actions/_shared/fetch-all-rows.ts`), or do the sum in SQL. For the movements page, move date/material filters to the server and page the results (50 per page, like the PO list).
- **Done when:**
  - The labour ledger for Arada Vela lists all 1,058 job rows (live count 2026-09-23).
  - The movements page can show a movement from the oldest month.

### 3.3 Thai "today" everywhere · M-01 · Small
- Add `todayInBangkok()` and `monthRangeInBangkok()` to `lib/utils.ts`, using `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' })`.
- Replace every `new Date().toISOString().slice(0, 10)` or `.split('T')[0]`. List: `PurchaseOrderForm.tsx:292`, `GoodsReceiptModal.tsx:39,66`, `ReceiptsPageClient.tsx:59`, `PlotPaymentsSection.tsx:285`, `billing/[id]/review/page.tsx:19`, `reports/contractor-cycle/page.tsx:24`, `sale-payments-actions.ts:94,116,233`, `sales-work-requests.ts:137`, `QtyControlTab.tsx:138`.
- **Done when:** a grep for `toISOString().slice(0, 10)` finds nothing used as "today".

### 3.4 Payment vouchers respect discounts · H-01 · Medium
- **Migration:**
  - In `goods_receipt_create`, save a **net** `unit_price_at_receipt`: the line's unit price minus its line discount per unit, then minus the line's share of the PO header discount (share = line net ÷ PO total of line nets).
  - Add a check in `payment_voucher_create` that the total paid on a PO never goes over `purchase_orders.total_amount` (+ ฿1 rounding).
  - Don't change the existing 43 receipts. No vouchers exist yet, so nothing has been paid wrong.
- **Screen:** `GoodsReceiptModal.tsx:130` stops sending the gross price, or the database ignores the price the screen sends.
- **Done when:** a test PO of 10 × ฿100 with a 10% line discount, 5% header discount and VAT 7% exclusive, fully received, gives a voucher total equal to the PO total. Test in a rolled-back transaction.

### 3.5 Consumption report units · M-09 · Small
- Show value (quantity × last PO price) per project/contractor, or show counts plus a per-material drill-down. Never add up different units.

---

## Phase 4 — Workflow changes June asked for

### 4.1 Foreman purchase requests · W-01 · Medium
- **Decided:** foreman raises the request; purchasing (admin) raises the PO.
- **Build:**
  - New page `app/dashboard/foreman/purchase-request/`, with a new item "ขอซื้อวัสดุ" in `components/layout/ForemanShell.tsx`.
  - Phone-friendly form: project → plot/plot group → material lines (searchable material, quantity, unit) → needed-by date → note.
  - A "คำขอของฉัน" list with status chips (รอตรวจสอบ / อนุมัติแล้ว / สั่งซื้อแล้ว / รับของแล้ว / ไม่อนุมัติ + reason).
  - The foreman sees no prices, suppliers or POs.
- **Actions:** a new `createForemanPurchaseRequest` and `getMyPurchaseRequests`, gated `requireModuleAccess('foreman')`, calling the existing `pr_create` RPC (it already allows foreman). Don't open the procurement module to foreman. Reuse the line-entry part of `components/procurement/PurchaseRequestForm.tsx` only if it can be done without showing prices.
- **Notifications:** a PO raised from their request, and goods received, notify the requester (M-14). This needs new notification types added to the `notifications.type` CHECK constraint, and wiring in `components/layout/NotificationBell.tsx` and `actions/notifications-actions.ts`.
- **Done when:** a foreman login creates a request from a phone-sized screen, PM gets notified and approves, admin raises the PO, and the foreman sees "สั่งซื้อแล้ว".

### 4.2 Accountant = contractor payments only · W-02, M-02 · Small–Medium
- `lib/permissions.ts` `DEFAULT_ROLE_PERMISSIONS.accountant`: `billing: true` (read), `reports: true`, everything else `false` (procurement and cost_control off).
  - If reports should show only the contractor payment cycle, add a new module key `contractor_payments` that gates `/dashboard/reports/contractor-cycle`, and give accountant only that.
- The payout buttons come from 2.5. The approve/reject/undo buttons stay hidden for accountant.
- Also update the saved settings row (`organization_settings.role_permissions`) if an admin has already saved the matrix, so the new default actually takes effect.
- **Done when:** an accountant login sees only the payment cycle (and the billing list read-only), and can mark and unmark paid out.

### 4.3 Rejected contractor bills: tab, edit, resubmit · W-03 · Medium
- **Needs:** 2.1 and 2.6 done first.
- **Migration:** `billing_update_request` also allows `status = 'rejected'` (owner or PM/admin). When saving a rejected bill it sets status back to `pending_review`, clears `review_note`/`reviewed_*`, and notifies PM/admins (same fan-out as `billing_create_request`).
- **Screens:**
  - `app/dashboard/foreman/history/ForemanHistoryPageClient.tsx`: tabs รอตรวจสอบ / ถูกปฏิเสธ / อนุมัติแล้ว. Rejected rows show the reason and a "แก้ไขแล้วส่งใหม่" button, which opens the existing edit flow (`/dashboard/foreman/request?editId=…` or `create-dc?editId=…`).
  - `app/dashboard/billing/BillingPageClient.tsx`: a "ถูกปฏิเสธ" tab.
- **Done when:** foreman submits → PM rejects with a reason → foreman sees it under ถูกปฏิเสธ, edits and resubmits → PM sees it pending again and can approve.

### 4.4 Sales users can open plot pages · H-08 · Small
- `app/dashboard/projects/layout.tsx`: `requireModuleAccess(['projects', 'sales'])`.
- `app/dashboard/projects/page.tsx` and `[id]/page.tsx` must still send sales away: gate those pages themselves on `'projects'`. Only `[id]/[plotId]` is for sales.
- **Done when:** with a test sales account (June creates it via invite), the links from the sales board open the plot page with no cost figures, and `/dashboard/projects` still redirects.

### 4.5 Copy jobs only from the same house type · M-07 (future only) · Small
- **Decided:** from now on, copying jobs is allowed only from a plot with the same house type. Past plots stay as they are.
- `actions/plot-actions.ts` `createPlot`: when `source_plot_id` is given, load that plot and refuse (Thai message) unless it has the same `house_model_id` **and** the same `project_id`. The screen (`ProjectDetailPageClient.tsx:176`) already filters the list, but the server must check too.
- `actions/plot-actions.ts` `updatePlot`: if `house_model_id` changes and the plot already has job rows, refuse with "แปลงนี้มีรายการงานของแบบบ้านเดิมแล้ว เปลี่ยนแบบบ้านไม่ได้".
  - Alternative, if June prefers: allow it only when none of the old jobs has a contractor, price or bill, and delete those old jobs in the same step.
- **Done when:** both attempts are refused with a Thai message, and normal plot creation and copy still work.

### 4.6 Close a partly delivered PO · M-04 · Small–Medium
- New RPC `po_close_short(p_id, p_reason)`, admin/pm only, from `partially_received`:
  - set each line's `quantity_ordered = quantity_received`;
  - recompute totals the same way `po_update` does;
  - set status `received`;
  - append the reason to the note;
  - give the un-ordered quantity back to the PR (like 2.3).
- **Button:** "ปิดใบสั่งซื้อ (ส่งไม่ครบ)" on `PurchaseOrderDetailPageClient.tsx`.

### 4.7 Receipts listed on the PO page · M-13 · Small
- Show `getGoodsReceiptsForOrder` (already exists, unused) as a "ใบรับสินค้า" list on the PO detail page: RI no., date, delivery note no., amount, paid or not.

### 4.8 Deactivate users · M-10 · Small–Medium
- An admin-only "ปิดการใช้งาน / เปิดใช้งาน" button on `app/dashboard/settings/users/UsersPageClient.tsx`, using the service-role client (`lib/supabase/admin.ts`) `auth.admin.updateUserById(id, { ban_duration: '876000h' | 'none' })`.
- `updateUserRole` refuses to remove the last admin, and refuses an admin demoting themself.

---

## Phase 5 — Messages and language

### 5.1 Readable errors everywhere · H-09 · Medium
- Convert every action that still `throw`s for an expected refusal to return `{ error }`. Main files: `actions/procurement/{requests,orders,receipts,payments}.ts`, `actions/billing/*.ts`, `actions/stock-actions.ts`, `actions/settings-actions.ts`, `actions/boq-actions.ts`, `actions/contractor-actions.ts`, `actions/project-actions.ts`, `actions/job-actions.ts`.
- Make one shared list, `lib/errors.ts`, that maps English database messages to Thai. Merge the existing `PR_/PO_/PP_ERROR_TRANSLATIONS` into it and add the billing and stock messages.
- Update each calling screen to read `result.error` and show it in the toast.

### 5.2 Thai labels · U-01, L-13, L-17 · Medium
- **Dashboard:** all titles and hints in Thai (`app/dashboard/page.tsx`).
- **Sidebar** (`components/layout/Sidebar.tsx`):
  - "Dashboard" → "ภาพรวม"
  - drop "(Foreman)" / "(For PM)"
  - use one term, "คำขอซื้อ", everywhere (also in `NotificationBell.tsx`).
- **Billing review:** "Undo Approve", "EXTRA WORK", "Foreman %", "PM %" → Thai.
- **Header titles:** add procurement, stock, sales and settings pages to `lib/dashboard-page-titles.ts`.
- **Status labels:** one shared `lib/status-labels.ts` for PO / PR / billing labels and colours. Replace the copies in `PurchaseOrdersPageClient`, `PurchaseOrderDetailPageClient`, `MaterialCostTab`, `PurchaseRequestDetail`, `PurchaseRequestsPageClient`, `BillingPageClient` and `ForemanHistoryPageClient`.

### 5.3 App dialogs instead of browser pop-ups · L-14 · Small–Medium
- Replace `prompt()` / `confirm()` / `alert()` with `components/ui/ConfirmDialog.tsx`, or a small reason-input modal for PO cancel and the sales work request. Do the ones foremen touch first: foreman history, plot detail, stock.

### 5.4 Search on growing lists · L-15 · Small
- Add a search box to: purchase requests, projects, house models/BOQ, foreman history, sales work requests.

---

## Phase 6 — Finish the security work

Do this before any new staff get accounts (especially sales users).

### 6.1 Proper rules per table · C-01 step 2 · Medium–Large
- For each table from 1.1 that has `"Allow all access"`, replace it with per-action rules for `authenticated`:
  - read: roles that have the module;
  - write: roles allowed to change it.
- Follow the pattern of the sales tables (`202609180003_sales_phase2.sql`), using `_billing_current_role()`.
- Sales must get **no** read on `job_assignments`, `payments`, `billings*`, `contractors` or `boq_master` prices.
- Test every screen with each role after each table. Do one table group per deploy (projects/plots; BOQ; contractors/jobs/payments; materials).

### 6.2 Billing tables · H-10 · Medium
- Add insert/update/delete rules for `billings`, `billing_jobs`, `billing_adjustments`:
  - writes only via the `billing_*` functions (security definer), so direct writes can be denied;
  - foreman reads only own bills;
  - PM/admin/accountant read all.
- Then drop `"Allow all"`.
- **Done when:** a foreman login can't change another bill or its own bill's status with a direct API call, and the whole foreman → PM → payout flow still works.

---

## Phase 7 — Cleanup (whenever there's time)

- **L-01:**
  - Delete the unused actions `markPurchaseOrderReceived` (and the `po_mark_received` function), `getCurrentViewerRole`, `getCurrentViewerPermissions`, `getPaymentVoucherById`, `getCurrentRequesterId`.
  - After a final check that nothing reads them, drop `invoices`, `invoice_items`, `master_data`, `progress_logs`, `inspections`, `settings` and the view `view_latest_progress`.
- **L-02:** pin `search_path` on the 6 functions the advisor lists; turn on leaked-password protection in Supabase Auth.
- **L-03:** `app/auth/confirm/route.ts` accepts `next` only if it starts with a single `/`.
- **L-04:** drop the duplicate job_assignments → boq_master foreign key (keep NO ACTION, see M-12).
- **L-06:** the down-payment schedule keeps month-end dates (31 Jan → 28/29 Feb).
- **L-07:** validate sale payment amounts (> 0, numeric).
- **L-08:** `getBillableJobs` returns an error instead of an empty list.
- **L-10:** make `createPlot` all-or-nothing with one SQL function.
- **L-16:** remove the dead preview tab code on the billing review page, or add its tab button.
- **M-12:** before deleting a BOQ line or house model, count affected jobs and block if any has a contractor, price or payment.
- **W-04:** add `purchase_orders.is_imported boolean default false` and set it true where `note like 'นำเข้าจากระบบเดิม%'`. Reports can then filter on it. Don't change anything else on those rows.
- **L-12:** add end-to-end tests for PO → receive → voucher and for bill submit → reject → resubmit → approve → paid out, using the existing `tests/e2e/helpers/auth.ts` logins.

---

## Not in scope (June decided)

- No accounting/ledger module now (maybe a small one later).
- No approval step for stock withdrawals; they are records only.
- No "purchasing" role; purchasing staff use admin.
- No clean-up of past data: the 4 mismatched-BOQ plots, Arada Vela plots 1–24, the duplicate same-name house types, and the imported POs.

## Progress checklist

| Phase | Task | Status |
|---|---|---|
| 1 | 1.1 Remove anonymous access | ✅ (2026-09-23, needs role smoke-test — see below) |
| 2 | 2.1 Bill status rules | ✅ (2026-09-23, needs role smoke-test — see below) |
| 2 | 2.2 Protect sales money records | ✅ (2026-09-23, needs role smoke-test — see below) |
| 2 | 2.3 PO cancel gives request back | ✅ (2026-09-23, needs role smoke-test — see below) |
| 2 | 2.4 Receiving checks | ✅ (2026-09-23, needs role smoke-test — see below) |
| 2 | 2.5 Payout in one step | ✅ (2026-09-23, needs role smoke-test — see below) |
| 2 | 2.6 Separate rejection fields | ✅ (2026-09-23, needs role smoke-test — see below) |
| 3 | 3.1 Dashboard totals | ✅ (2026-09-23, needs role smoke-test — see below) |
| 3 | 3.2 Row cut-offs | ✅ (2026-09-23) |
| 3 | 3.3 Thai "today" | ✅ (2026-09-23) |
| 3 | 3.4 Vouchers respect discounts | ✅ (2026-09-23, needs role smoke-test — see below) |
| 3 | 3.5 Consumption units | ✅ (2026-09-23) |
| 4 | 4.1 Foreman purchase requests | ✅ (2026-09-23, needs role smoke-test — see below) |
| 4 | 4.2 Accountant scope | ✅ (2026-09-23, needs role smoke-test — see below) |
| 4 | 4.3 Rejected bills resubmit | ✅ (2026-09-23, needs role smoke-test — see below) |
| 4 | 4.4 Sales plot page | ✅ (2026-09-23, needs a real sales login to smoke-test — see below) |
| 4 | 4.5 Same house type copy guard | ✅ (2026-09-23) |
| 4 | 4.6 Close short PO | ✅ (2026-09-23, needs role smoke-test — see below) |
| 4 | 4.7 Receipts on PO page | ✅ (2026-09-23) |
| 4 | 4.8 Deactivate users | ✅ (2026-09-23, needs role smoke-test — see below) |
| 5 | 5.1 Readable errors everywhere | ✅ (2026-09-24, needs role smoke-test — see below) |
| 5 | 5.2 Thai labels | ✅ (2026-09-24) |
| 5 | 5.3 App dialogs instead of browser pop-ups | ✅ (2026-09-24/25 — foreman history, plot detail, PO cancel/close-short/unmark-received, sales work request reject done 09-24; remaining 27 call sites across contractors/contractor-types/plot groups/projects/house models/suppliers/companies/users/material types/BOQ material items/payment vouchers/PO bulk delete/BOQ items/contractor-cycle report/PO form unsaved-changes guard done 09-25) |
| 5 | 5.4 Search on growing lists | ✅ (2026-09-24) |
| 6 | 6.1 Per-table rules | ✅ (2026-09-24, needs role smoke-test — see below. Covers projects/plots/plot_groups/plot_group_members, boq_master/boq_material_items/house_models, contractors/contractor_types, job_assignments, payments, material_types. New get_plot_jobs_public() RPC serves sales's plot-detail job list without price, since job_assignments itself now excludes sales at the row level.) |
| 6 | 6.2 Billing rules | ✅ (2026-09-24, needs role smoke-test — see below. billings/billing_jobs/billing_adjustments' leftover "Allow all" dropped; _select policies now include accountant; no insert/update/delete policy added on purpose, so direct writes are refused and only the billing_* SECURITY DEFINER functions can write.) |
| 7 | L-01 Unused actions/tables/view/function | ✅ (2026-09-24) |
| 7 | L-02 search_path pin | ✅ (2026-09-24) |
| 7 | L-02 leaked-password protection | ☐ (Supabase Auth dashboard setting, not reachable from a migration - needs June to flip it in Authentication > Providers > Email) |
| 7 | L-03 auth/confirm next validation | ✅ (2026-09-24) |
| 7 | L-04 duplicate FK | ✅ (2026-09-24) |
| 7 | L-06 down-payment month-end clamp | ✅ (2026-09-24) |
| 7 | L-07 sale payment validation | ✅ (2026-09-24) |
| 7 | L-08 getBillableJobs errors | ✅ (2026-09-24) |
| 7 | L-10 createPlot all-or-nothing | ✅ (2026-09-24, needs role smoke-test — see below) |
| 7 | L-16 dead preview tab | ✅ (2026-09-24 — removed; also dropped the now-pointless getOrganizationSettings/getSignatureSlots fetch on every review-page load) |
| 7 | M-12 BOQ/house model delete guard | ✅ (2026-09-24) |
| 7 | W-04 is_imported flag | ✅ (2026-09-24) |
| 7 | L-12 e2e tests | ✅ (2026-09-24 — new tests/e2e/po-lifecycle.spec.ts, plus 2 more tests added to billing-workflow.spec.ts, covering reject/resubmit/paid-out. Same conservative shape as the existing specs: reaches each stage of PO→receive→voucher and submit→reject→resubmit→approve→paid-out and asserts the right thing is on screen, gated behind new env vars for records already in that state, rather than performing new mutations against the live database. I have no E2E credentials, so none of this has actually been run - only `--list`/tsc/lint verified.) |
