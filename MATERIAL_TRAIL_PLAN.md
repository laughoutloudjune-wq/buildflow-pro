# Material Trail — Audit & Plan (BOQ ↔ PR ↔ PO ↔ Stock)

Written 2026-10-16, revised the same day after June's feedback. Audit only — nothing in the app or database was changed.
Numbers were read from the live database on 2026-10-16.

**June's two questions**
1. Are BOQ, PR, PO and stock connected? If not, how do we connect them so there is an audit trail?
2. How do I buy for the store with no plot or BOQ, e.g. 30 bathroom mirrors when the BOQ says 3 per house? Does each kind of purchase need its own workflow?

---

## 1. Short answer: partly connected

The middle of the chain is connected. **The two ends are not, and history can be erased.**

```
  BOQ  ┄┄weak┄┄▶  PR  ━━━━━▶  PO  ━━━━━▶  Receipt  ━━━━━▶  Stock ledger  ┄┄none┄┄▶  Withdrawal (เบิก)
 (plan)          (ขอซื้อ)    (สั่งซื้อ)   (รับของ)          (in / out)              (to contractor/plot)

  ━━━ real link, you can click from one to the other      ┄┄┄ missing or optional link
```

| Link | Connected? | What exists today | What is missing |
|---|---|---|---|
| **BOQ → PR** | ⚠️ Weak | A PR line *may* name a BOQ job | Optional, and only 12 of 160 PR lines use it. BOQ itself has only 18 material lines filled in |
| **BOQ → PO** | ⚠️ Check only | When a PO is saved, the system compares it to BOQ and warns if over (asks for a reason) | No stored link from a PO line to a BOQ line, only the warning result |
| **PR → PO** | ✅ Yes | A PO line records which PR line(s) it fills and how much | Not required: 194 of 302 app-made PO lines have no PR behind them, and nothing marks why |
| **PO → Receipt** | ✅ Yes, strong | Every receipt line points to its PO line | — |
| **Receipt → Stock** | ✅ Yes | Every receipt line writes a stock entry pointing back to it; site deliveries also write the "used at plot" entry | **Undo received deletes these entries** instead of reversing them |
| **Stock → Withdrawal** | ❌ No document | Withdrawal is a stock "out" entry tagged with project / contractor / plot | No slip number, can't be referred to; not linked to any BOQ job |
| **Changes to PR / PO** | ❌ No history | Only the *last* approver / confirmer / receiver is kept | PO edits delete and rewrite lines; PO delete removes everything; no "who changed what, when" |
| **Plot view** | ⚠️ Partial | Plot page shows ordered and received from POs | Doesn't show PRs not yet ordered, withdrawals from store, site deliveries, BOQ, or a timeline |

**So for an auditor today:** you can follow a PR to its PO and receipt and see it arrive in stock. But you can't see what was corrected or undone, you can't see where store stock went by document, and a PM can't see the whole story for a plot.

---

## 2. Short answer: buying for the store

**Why it feels impossible today.** The request form makes you pick a **project** first. "For the store" only exists as a fake project called **สโตร์กลาง (ไม่ระบุงาน)** hidden in that list. 113 POs were bought that way, so it works, but nobody would guess it. The form also looks like it wants a plot and a BOQ job, even though both are optional.

**Don't build a separate workflow for each kind of purchase.** Keep **one** chain (PR → PO → Receipt → Stock) with the same numbers and the same history. Add one question at the top of the request: **"ซื้อเพื่ออะไร" (what is this purchase for?)**. The answer decides which fields show, where the goods go, and whether BOQ is checked:

| Purchase type | Examples | Plot / BOQ | Delivered to | BOQ check | Cost lands on |
|---|---|---|---|---|---|
| **1. For plots (ใช้กับแปลง)** | Roof sheets for plots 98-102 | Project + plot or batch required. BOQ job optional | Site or store (chosen at delivery) | Yes, warns over BOQ, reason required | The plots, when delivered to site or withdrawn |
| **2. Store stock (เติมสต็อกสโตร์)** | กระจก, ฟองน้ำ, แปรงทาสี, screws, **bulk mirrors**, tools | **No project, no plot, no BOQ** | Always the store | **No** (not used yet) | Nobody until withdrawn. Then the plot it's withdrawn for |
| **3. Office / overhead (ค่าใช้จ่ายส่วนกลาง)** | Office supplies, concrete plant, sales office | Overhead bucket, no plot | Wherever it's used | No | The overhead bucket |
| **4. Urgent buy without a PR** | Supplier on site, buy now | PO made directly | — | As per its type | As per its type |

Type 4 already happens (194 PO lines). The plan doesn't block it. It makes the PO say **"ไม่มีคำขอซื้อ — เหตุผล: …"**, so the audit shows it was a deliberate choice, not a missing link.

### The mirror example (30 mirrors, BOQ = 3 per house)
- **You know which 10 houses they're for:** Type 1 for a batch of 10 plots. BOQ allows 3 × 10 = 30, so there's no warning. For 30 mirrors across only 5 houses, you'd get a warning ("over BOQ by 15") and type a reason. It doesn't block you.
- **Buying ahead or in bulk for a better price:** Type 2, store stock. 30 mirrors go into the store with no plot and no BOQ check. Each time 3 are withdrawn for a house, that withdrawal is charged to the house and counted against its BOQ. The BOQ check happens when material is **used**, not when it's bought. The system already counts "used" this way since the Sept material-flow change.

Either way you can always see where all 30 mirrors are: the mirror's store ledger lists the purchase, the delivery, and every slip that took some out.

---

## 3. The plan to connect everything

Rule for the whole plan: **every quantity that moves is a numbered document line, and nothing is ever deleted.** A mistake is fixed by a reversing line that points at the original.

### Phase A — Stop erasing history *(do first, everything else depends on it)* — BUILT 2026-10-16, committed locally, migration NOT applied, NOT pushed
> **As built:** migration `202610160001_document_history.sql` adds `document_events` + one trigger on every PR/PO/receipt/voucher table (and update/delete on `stock_movements`). Undo-received, PO delete and voucher void now require a reason. History panel on PR, PO and receipt; audit page `/dashboard/procurement/history`.
> **One deviation:** undo-received still removes the receipt and stock rows, but every removed row is copied into the history first (who, when, why, full content). Ledger reversal rows are deferred to Phase F so the 8+ stock/receipt totals did not have to change.
> **To ship:** apply the migration and push the code together, minutes apart. Old code against the new database makes undo/delete/void refuse with "กรุณาระบุเหตุผล".

- One shared history log for PR, PO, receipt and issue slip: what happened (created, edited, approved, rejected, ordered, received, undone, cancelled), who, when, and the old → new value.
- "Undo received" writes a **reversal** (stock goes back down with a reason) instead of deleting the receipt and stock entries.
- Editing a PO keeps the old line values in history. Once a PO has anything received or linked, deleting it is replaced by **cancel**.
- A **ประวัติ** panel on every PR, PO and receipt page.
- **Done when:** undo a receipt and edit a PO, and both the original and the correction are still visible with who / when / why.

### Phase B — Purchase type on PR and PO *(answers question 2)* — BUILT 2026-10-16, committed locally, migration NOT applied, NOT pushed
> **As built:** no new column on PR/PO. The purpose is the kind of the project the document is saved against. Migration `202610160002_store_purchase_kind.sql` moves สโตร์กลาง to its own `projects.kind = 'store'` (only one allowed), and adds a guard so store-stock lines can never be received as "ส่งตรงหน้างาน". Both forms open with "ซื้อเพื่ออะไร". Store hides project/plot, overhead shows only overhead categories, and project works as before. PO line overrides still list every project. The low-stock report has a "สร้างคำขอซื้อเติมสต็อก" button that opens a store PR with those materials (quantities left blank). The optional "store item" catalog flag was not built.
> **Safe to apply on its own:** old code keeps working against it. Apply after Phase A's migration (file order).

- Add the "ซื้อเพื่ออะไร" question with the 4 types above. The form only shows the fields that type needs.
- Store stock: no project/plot/BOQ fields. It's saved against the store bucket behind the scenes and delivery is locked to store.
- The สโตร์กลาง fake project disappears from the project picker (it stays in the data so old POs still work).
- Optional: mark catalog items as "store items" (consumables, tools) so they default to store stock.
- Low-stock list gets a button: **"สร้างคำขอซื้อเติมสต็อก"**.
- **Done when:** you can request 30 mirrors for the store without picking a project, plot or BOQ job.

### Store withdrawals ↔ BOQ (June's 3 fixes, replaces Phase D and part of E) — BUILT 2026-10-16, committed locally, migration NOT applied, NOT pushed
June's point: the store-stock flow (buy for store → store → withdraw for a plot → compare to BOQ) already exists. It just had gaps. Three fixes, no new steps for staff:
1. **Plot or batch required on withdrawals** for any project that has plots. The withdrawal form no longer offers "ทั้งโครงการ" there, and the database refuses it too. Projects without plots are unaffected.
2. **Slip numbers** `IS-YYYYMMDDNNN` are stamped automatically on every withdrawal line. The 1,313 old rows were back-numbered into 1,210 slips by their original date. The number shows in the stock history lists (searchable) and in the save message.
3. **The plot page's วัสดุ tab** now shows BOQ (with waste allowance) │ ordered │ received │ withdrawn from store │ delivered straight to plot │ used │ % of BOQ. Expanding a row lists every PO and every withdrawal slip / delivery. Attribution is the same as the BOQ control page (checked: plot 122 matches exactly).
Migration: `202610160003_stock_issue_slips.sql`. Apply after 0001 and 0002.

### Phase C — Make the links required or explained *(answers question 1)*
- PO line without a PR line: allowed, but a reason is required ("ซื้อด่วน", "ซื้อหน้างาน", …), shown in history.
- Type 1 PR lines: suggest the matching BOQ job automatically (same material + plot's house model), so the BOQ link fills itself instead of staying empty.
- Over-BOQ reasons stay as today (warn, don't block), and are saved against the PO line so they appear in the plot trail.

### Phase D — Numbered issue slips (ใบเบิก)
- Withdrawals stay instant with no approval (decided 2026-10-16). Each one just gets a slip number, who recorded it, the contractor, the plot/batch, and a printable slip.
- A wrong slip is fixed by a reversal slip, never edited or deleted.
- Old withdrawals get a slip back-filled, marked "ย้อนหลัง".

### Phase E — Plot trail for the PM
On the plot page, per material: **BOQ planned │ requested (PR not yet ordered) │ ordered (PO) │ delivered straight to plot │ withdrawn from store │ total used │ vs BOQ**. Plus a dated timeline of every PR, PO, receipt and slip that touched the plot, each one clickable. The sales role still sees no prices.

### Phase F — Store ledger per material
The existing material stock page gains a running balance, a document number + link on every line, reversals shown next to what they reverse, filters (project / plot / contractor / date), and export. This is where store-stock items like the mirrors are traced.

### Phase G — Per-plot quantities on batch requests *(optional, last)*
On a batch PR line, enter the quantity per plot (default = even split). This replaces the "ประมาณ" even-split estimates on the plot trail.

### Not code, but needed before the numbers can be trusted
- **Physical store count** (material-flow Phase 5, still open). Store balances carry ~12,000 units of phantom stock until it's done.
- **Fill in BOQ material lines** for the real house models, or every "vs BOQ" column stays blank.
- Old data (Excel-imported POs, withdrawals with no plot, receipts from before store/site existed) stays as-is, labelled "ข้อมูลเก่า", not guessed.

---

## 4. Order
**A → B → C → D → E → F → G.**
- A first: an audit trail is worthless if history can be deleted.
- B next: it's what blocks you today (store buying) and it's small.
- C and D close the remaining gaps in the chain.
- E and F are the screens that show the connected trail.
- G is a nice-to-have.

## 5. Still open (I'll use the recommended option unless you say otherwise)
1. **Tools/equipment:** treat them like consumables (once withdrawn, gone), or track who holds each tool and when it comes back? *Recommended: like consumables for now.*
2. **PO delete:** only allowed for a PO with nothing received or linked, otherwise cancel. *Recommended.*
