# Material Flow — Redesign Plan

Handoff spec for fixing how material moves through BuildFlow Pro: buying it,
receiving it, storing it, and issuing it out. Each phase is independently
shippable and has its own acceptance criteria.

**Audience:** an engineer (or Claude Sonnet) implementing this in `buildflow-pro`.
**Status:** design approved 2026-09-22. Phases 1-4 shipped (1-2 on 2026-09-22,
3-4 on 2026-09-23; migrations applied to the live project). Phase 5 (cutover
count) still needs to happen - see its own section below; do it the day this
deploys, not before.

---

## 1. Goal, in one paragraph

The store count is currently fiction. Every delivery the system receives adds to
the on-hand number, including deliveries that drove straight to a house and
unloaded there. Nobody ever withdraws that material — it was never in the store —
so it sits on the books forever. 104 materials have been received and never once
issued out, roughly 12,374 units of stock that almost certainly is not in the
yard. This plan adds the one fact the system never recorded (where the truck
actually unloaded), retires the fake "central stock project" that was invented to
work around its absence, and makes "what did this house really consume" answerable
from one rule instead of three.

## 2. What is actually broken

### 2.1 The missing question

The system asks one question when you buy — *which project?* — and uses that single
answer for three unrelated purposes:

1. **Which development is this for?** (Arada Vela, Arada Prime…)
2. **What kind of spend is this?** — which is why the projects table contains
   `ของเบิกสโตร์`, `ของใช้สำนักงาน`, `อุปกรณ์ช่าง`, `แพลนท์ปูน`, `ส่วนกลาง`, and four
   separate `เครื่องมือช่าง…` rows named after individual workers.
3. **Where does the material physically end up?** — **never asked.** It is guessed
   from #1. That guess is the bug.

`202609080005_central_stock_project.sql` created a pseudo-project to represent
"bought into central stock". That was a workaround for the missing third question,
and its own header comment admits the shape was chosen to avoid a downstream sweep.

### 2.2 The mechanics of the drift

`goods_receipt_create` posts one `'in'` stock movement per receipt line,
unconditionally, against the one shared pool (`stock_balances` is keyed on
`material_type_id` alone since `202608310001_stock_balances_single_pool.sql`).
There is no branch for "this never entered the store". Issue-outs
(`stock_request_create`) are manual and optional, so direct-to-site material is
never drawn back down.

### 2.3 Data reality (checked against production 2026-09-22)

Re-check these before starting if significant time has passed.

| Fact | Number |
|---|---|
| Goods-receipt `'in'` movements posted against a real project | 307 |
| Goods-receipt `'in'` movements posted against central stock | 9 |
| Materials received but **never** issued out | 104 |
| Units stuck on the books from those materials | ~12,374 |
| Manual `count_adjustment` movements (staff patching by hand) | 148 (119 in / 29 out) |
| …of which in September 2026 alone | 42 |
| Stock issue-outs (`manual_request`) | 1,191 |
| `material_usage_log` rows | **2**, last written 2026-07-31 |

Worst individual offender: `แผ่นหลังคาเมทัลชีท ลอน 760` shows **1,099 m on hand**
across 24 receipt lines and **zero** issue-outs. Roof sheet is cut per house. It is
on roofs.

The 148 hand corrections are the tell — staff already know the number is wrong and
are patching it manually rather than trusting it.

### 2.4 Two findings that make this cheaper than it looks

- **`material_usage_log` is dead.** 2 rows, last touched July. Stock issue-outs took
  over its job (1,191 rows). This is two ledgers to reconcile, not three. Retire the
  table rather than merging it.
- **The central-stock POs were almost never receipted.** Of 113 POs against
  `ของเบิกสโตร์`, only **2** reached `received`/`partially_received`. The rest are the
  historical Excel import (see `project-buildflow-po-import`) and never posted a stock
  movement. Converting them is a metadata relabel, not a ledger rewrite.

## 3. Decisions already made (do not re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Number of stock locations | **One central yard.** No per-site stores, no contractor-held stock. | Confirmed by the user 2026-09-22, and consistent with what `202608310001` confirmed in August. Keeps the balance a single number per material and avoids a transfer flow nobody asked for. |
| Where the material went | New **destination** on each receipt line: `store` or `site` | This is the missing fact. Everything else follows from it. |
| Fake projects | **Split out properly** via a typed `projects.kind`, not nullable `project_id` | See §4.3 — delivers clean pickers and separate spend reporting without the risky sweep that `202609080005` explicitly declined to do. |
| Direct-to-site accounting | Post an `'in'` **and** an immediate `'out'` | One rule for consumption; movement history still shows the delivery; balance is correct at every instant. See §4.2. |
| What counts against a BOQ line | **Consumption, not purchase** | Once material can be bought for house 101 *and* issued to house 101, counting both double-counts it. Supersedes the "PO lines plus issue-outs" rule in `BOQ_CONTROL_PLAN.md` §2. |
| `material_usage_log` | **Retire** (drop after Phase 4) | Dead table, 2 rows. Merging it is work with no payoff. |

## 4. The model

### 4.1 Three questions per purchase line

| Question | Field | Values |
|---|---|---|
| Who is it for? | `project_id` + `plot_id`/`plot_group_id` (exists today) | a development + optional house/batch, **or nothing** ("no job yet") |
| Where did it unload? | **`destination`** (new) | `store` \| `site` |
| What kind of spend? | **`projects.kind`** (new) | `development` \| `overhead` |

The case that is unsayable today — *ordered for house 101, parked in the store* —
becomes `project=Arada Vela, plot=101, destination=store`. Today there is no way to
record that at all.

"Bought into central stock" stops being a project and becomes
`project=NULL, destination=store`.

### 4.2 What each destination does to the ledger

**`destination = 'store'`** — today's behaviour, unchanged. One `'in'` movement.
Balance rises. Someone must issue it out later.

**`destination = 'site'`** — post an `'in'` immediately followed by an `'out'`
(`source_type = 'direct_to_site'`), carrying the line's project/plot/batch.

Why the pair rather than posting nothing:

- **One rule for consumption.** "Everything a house consumed" = all `'out'`
  movements scoped to it. Direct deliveries and store issues answer to the same
  query. If site deliveries posted nothing, every consumption report would have to
  union two differently-shaped sources forever.
- **History survives.** A material's movement list still shows the delivery, so
  "where did those 1,099 m of roof sheet go?" has an answer on the page.
- **No spurious failures.** The `'in'` lands before the `'out'`, so the
  negative-balance guard inside `_stock_movement_post` can never reject a legitimate
  receipt for an untracked material.

Cost: two ledger rows per direct line instead of zero, and `prev_qty`/`new_qty` on
the pair will read as a no-op round trip. Acceptable — the movements page should
render the pair as a single "ส่งตรงหน้างาน" row rather than two.

### 4.3 Why `projects.kind` instead of nullable `project_id`

The literal version of "split them out" is: make `project_id` nullable on purchase
orders and stock movements, add a `cost_centres` table, and point overhead spend at
it. `202609080005` looked at exactly this and backed off, because `project_id` is
assumed non-null by "every downstream report/PDF/dashboard that reads projects.name
off it". That assessment is still correct, and the sweep is large and risky.

Tagging the rows achieves the same user-visible outcome at a fraction of the risk:

- Pickers filter on `kind = 'development'`, so office and tool spend stops appearing
  where a real development belongs — this is what the eight `is_central_stock = false`
  filters scattered across `actions/` are already trying to do by hand
  (`dashboard-actions.ts:22`, `sales-actions.ts:56`, `boq-control.ts:188`,
  `labor-budget-actions.ts:273`, `billing/lookups.ts:139`, `stock-actions.ts:170`,
  `project-actions.ts:20`). They all collapse into one `kind` filter.
- Reports group by `kind`, so overhead is separable from construction cost for the
  first time.
- Nothing becomes nullable. No sweep.

The row for `ของใช้สำนักงาน` still physically lives in the projects table, which is
conceptually ugly. That is the accepted trade. Revisit only if overhead reporting
grows real requirements of its own.

**`ของเบิกสโตร์` is different and does get deleted** — destination replaces it
entirely. `หนองหงส์` and `สุวรรณอพาร์ทเมนท์` are real external contract jobs, not
buckets: they stay `kind = 'development'`.

## 5. Phases

### Phase 1 — Record the destination (ships the fix) - SHIPPED 2026-09-22

**Migration** `2026MMDD0001_material_destination.sql`

```sql
-- intended destination, set at order time, used only to pre-fill the receipt
alter table public.purchase_order_items
  add column if not exists intended_destination text
  check (intended_destination in ('store','site'));

-- the authoritative fact: where the truck actually unloaded
alter table public.goods_receipts
  add column if not exists default_destination text not null default 'store'
  check (default_destination in ('store','site'));

alter table public.goods_receipt_items
  add column if not exists destination text
  check (destination in ('store','site'));
-- NULL = inherit the receipt's default_destination, mirroring the PO-line
-- override convention from 202609220002.

alter table public.stock_movements drop constraint stock_movements_source_type_check;
alter table public.stock_movements add constraint stock_movements_source_type_check
  check (source_type in ('goods_receipt','manual_request','opening_balance',
                         'count_adjustment','direct_to_site'));
```

Restate `goods_receipt_create` in full (this repo's convention — Postgres has no
partial function replace). Current source of truth:
`202609220002_po_item_project_plot_override.sql` (the per-line loop around line 750).
Resolve `coalesce(gri.destination, gr.default_destination)` and, when it is `'site'`,
post the matching `'out'` right after the existing `'in'`.

**UI** — `components/procurement/GoodsReceiptModal.tsx` (215 lines, small):
a header toggle defaulting from the PO lines' `intended_destination`, plus a per-line
override. `components/procurement/PurchaseOrderForm.tsx:377` gains the optional
intended-destination picker per line.

**Acceptance:** receive a PO line marked `site` → `stock_balances` unchanged, two
movements written, the material's movement page shows one "ส่งตรงหน้างาน" entry
carrying the plot. Receive one marked `store` → behaves exactly as today.

### Phase 2 — Type the projects - SHIPPED 2026-09-22

**Migration** `2026MMDD0002_project_kind.sql`

```sql
alter table public.projects
  add column if not exists kind text not null default 'development'
  check (kind in ('development','overhead'));

update public.projects set kind = 'overhead'
where name in ('ของใช้สำนักงาน','อุปกรณ์ช่าง','แพลนท์ปูน','ส่วนกลาง',
               'เครื่องมือช่างต่าย','เครื่องมือช่างบุ๋ม',
               'เครื่องมือช่างสุนทร','เครื่องมือช่างเอ็มลี่',
               'อารดา 1','อารดา 2','แปลง 17-20');
```

Replace the eight scattered `is_central_stock = false` filters with a single
`kind = 'development'` filter. Keep `is_central_stock` as a column for now — Phase 3
removes it.

Implementation note: the migration also tags `ของเบิกสโตร์` itself (`is_central_stock
= true`) as `kind = 'overhead'`, on top of the 11 named buckets above — it isn't a
development either, and collapsing every `is_central_stock = false` filter down to
`kind = 'development'` only works if it doesn't leak back in as the one row still
defaulting to `'development'`. `is_central_stock` and the procurement-only
`includeCentralStock` opt-in are otherwise untouched; Phase 3 still owns actually
retiring the row.

**Acceptance:** project pickers across procurement, sales, billing, BOQ and labour
show only real developments. Cost reports can group by `kind`.

### Phase 3 — Retire the central-stock pseudo-project - SHIPPED 2026-09-23 (option (a))

Only 2 of its 113 POs were ever received, so this is mostly relabelling.

1. Repoint those 113 POs and their lines away from the pseudo-project. Two options,
   decide before starting:
   - **(a)** Keep the row, rename it clearly (e.g. `สโตร์กลาง (ไม่ระบุงาน)`), set
     `kind = 'overhead'`. Zero risk. The row lingers.
   - **(b)** Make `project_id` nullable on `purchase_orders` / `purchase_order_items`
     / `stock_movements` and do the downstream sweep. Correct, larger.
2. Backfill `destination = 'store'` on the 2 receipts that did post movements.
3. Drop `projects.is_central_stock` and the `includeCentralStock` option on
   `getProjects` (`actions/project-actions.ts:13`, 3 call sites).
4. Retire `app/dashboard/stock/central/` and `getCentralStockPurchases`
   (`actions/stock-actions.ts:371`) — the "purchases into central stock" report is
   replaced by filtering receipts on `destination = 'store'`, which is the number that
   page was always trying to approximate.

**Acceptance:** no code references `is_central_stock`. Buying for the yard is
expressed as "no job yet + unloaded at the store".

Implementation notes: option (a) chosen by the user 2026-09-23 (consistent with
202609080005 and Phase 2 both already declining the nullable-`project_id` sweep for
the same reason). Nothing needed repointing — the 113 POs already read correctly once
the row is tagged `kind = 'overhead'` (Phase 2) and renamed (this migration); they were
mislabelled, never wrong. The 2 real receipts already carried `default_destination =
'store'` from Phase 1's column backfill, verified against production before writing
the migration — step 2 above was a no-op check, not a write. `getProjects`'s
`includeCentralStock` option is renamed `includeOverhead` rather than dropped outright
(procurement PO/PR forms still need to pick any overhead bucket, not just the
central-stock placeholder) - same true/false semantics, just accurately named now that
Phase 2 already made it cover every bucket, not one row.

### Phase 4 — One consumption rule - SHIPPED 2026-09-23

Rewrite the "purchased" side of BOQ control to count **consumption** — all `'out'`
movements, whether `manual_request` or `direct_to_site` — instead of PO lines plus
issue-outs. Purchases become a separate "on order" figure.

This supersedes `BOQ_CONTROL_PLAN.md` §2 row 1. Update that file when this lands, or
the two plans contradict each other.

Then drop `material_usage_log`. Check `getMaterialVarianceForJob` for the last reader
first; `boq_material_items` is unaffected.

**Acceptance:** a house supplied entirely by direct delivery and a house supplied
entirely from the store both show correct consumption against BOQ, with no
double-count for material bought against a plot and then issued to it.

Implementation notes: `boq_control_rollup`'s SQL needed no changes at all - its
`issued` CTE already filters only on `sm.type = 'out'` with no `source_type`
restriction, so it already summed `manual_request` and `direct_to_site` together once
Phase 1 started posting the latter. The actual fix lived entirely in
`lib/procurement/boqControl.ts`: `totalUsedQty` (ordered+issued) turned out to be
shared by two different consumers that both needed to survive - the cost-control
rollup (the one this phase targets) AND the "would this push us over budget"
precommitment checks at PO/PR/receipt signing time (`getBoqCheckForDraft`,
`getBoqCheckForPurchaseOrder`, the PR draft check), which intentionally want
ordered+issued as their basis so an over-order trips the warning before it ships.
Blindly redefining `totalUsedQty` to mean consumption-only broke those (and an
existing test locking in the old behaviour) - the actual fix added a new
`consumedQty()` (issuedQty alone) and pointed only `percentUsed`/`rowStatus`/
`excessValue` at it, leaving `totalUsedQty` and every precommitment check untouched.
`material_usage_log` turned out to back a real, nav-linked foreman page
("บันทึกวัสดุ", reachable from `/dashboard/foreman/create-progress` and buttons on
the plot construction tab and the billing request form) even though the table itself
had only 2 rows ever - confirmed with the user before removing it; retired the whole
feature (page, `JobMaterialLogModal`, the CRUD/variance actions) along with the table.

### Phase 5 — Cutover count

Not code. The ~12,374 phantom units do not fix themselves.

Walk the yard, enter real quantities through the existing `createStockAdjustment` /
`AdjustStockModal` flow, let the system write off the difference. Do this **on the day
Phase 1 ships**, not before — otherwise the count starts drifting again immediately.

Mark those adjustments with a recognisable note so the historical break is visible in
the movement ledger afterwards.

## 6. Open items

- **Returns.** Leftover material carried back from a house to the yard has no flow.
  Not in scope here; it becomes easy once destination exists (an `'in'` with
  `source_type = 'return_from_site'`). Confirm whether this actually happens on site
  often enough to be worth building.
- **Bulk consumables.** `material_types.is_requestable = false` materials (cement and
  similar) are received but never withdrawn by design — see
  `202609010001_material_types_cement_receive_only.sql`. Under the new model these
  should almost always be `destination = 'site'`. Consider defaulting
  `intended_destination` from `is_requestable` rather than making someone pick.
