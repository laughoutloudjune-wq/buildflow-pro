/**
 * Hand-off between the "combine purchase requests" picker and the PO form.
 *
 * The picker decides WHAT is being ordered - which request lines, how much of
 * each, grouped into supplier-facing lines - and the ordinary PO form takes it
 * from there (prices, VAT, dates, terms), so there is exactly one place an
 * order is priced and saved. The draft lives in sessionStorage only for that
 * one navigation; nothing in it is trusted by the server, which re-validates
 * every allocation inside po_create.
 */

export type LineAllocationDraft = {
  purchase_request_item_id: string
  quantity: string
  pr_no: number | null
  /** Plot / plot group label of the request, for display only. */
  plot_label: string | null
}

export type CombineDraftLine = {
  material_type_id: number
  material_name: string
  material_unit: string
  unit_price: number
  allocations: LineAllocationDraft[]
  /** Set instead of `allocations` (which is then empty) for a request line
   * asked in a different unit than the material is sold in: it can't be
   * allocated, so it becomes its own order line linked to the request line
   * with "this order covers the request" ticked. `quantity` is in the
   * material's unit. */
  single?: {
    purchase_request_item_id: string
    quantity: string
    request_unit: string
    pr_no: number | null
  } | null
}

export type CombineDraft = {
  projectId: string
  supplierId: string
  /** Union of every selected request's plots, so the order is BOQ-scoped to
   * exactly the plots it serves. */
  plotIds: string[]
  lines: CombineDraftLine[]
}

export const COMBINE_DRAFT_KEY = 'po-combine-draft'

export function saveCombineDraft(draft: CombineDraft): void {
  try {
    sessionStorage.setItem(COMBINE_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Storage unavailable (private mode, quota) - the picker reports it.
    throw new Error('ไม่สามารถส่งต่อข้อมูลไปยังหน้าสร้างใบสั่งซื้อได้ (เบราว์เซอร์ไม่อนุญาตให้เก็บข้อมูลชั่วคราว)')
  }
}

export function takeCombineDraft(): CombineDraft | null {
  try {
    const raw = sessionStorage.getItem(COMBINE_DRAFT_KEY)
    if (!raw) return null
    sessionStorage.removeItem(COMBINE_DRAFT_KEY)
    const draft = JSON.parse(raw) as CombineDraft
    return draft && Array.isArray(draft.lines) ? draft : null
  } catch {
    return null
  }
}

/** Sum of a line's allocation quantities - the supplier-facing line total. */
export function allocationTotal(allocations: { quantity: string | number }[]): number {
  return allocations.reduce((sum, a) => sum + (Number(a.quantity) || 0), 0)
}

/** Turns ticked request lines into the draft the PO form opens with: lines
 * for the same material become one supplier-facing line that keeps its
 * per-request breakdown; a line asked in another unit stays on its own (see
 * CombineDraftLine.single). Same rules the combine page uses. */
export function buildCombineDraft(
  picks: {
    line: {
      purchase_request_item_id: string
      project_id: string
      plot_ids: string[]
      plot_label: string | null
      pr_no: number
      material_type_id: number
      material_name: string
      unit: string
      request_unit: string
      unit_mismatch: boolean
      unit_price: number
    }
    qty: number
  }[],
  projectId: string,
  supplierId: string
): CombineDraft {
  const groups = new Map<string, { head: (typeof picks)[number]['line']; rows: typeof picks }>()
  for (const pick of picks) {
    const key = pick.line.unit_mismatch ? `line:${pick.line.purchase_request_item_id}` : `material:${pick.line.material_type_id}`
    const group = groups.get(key) || { head: pick.line, rows: [] }
    group.rows.push(pick)
    groups.set(key, group)
  }

  const plotIds = Array.from(
    new Set(picks.filter((p) => p.line.project_id === projectId).flatMap((p) => p.line.plot_ids))
  )

  const lines: CombineDraftLine[] = Array.from(groups.values()).map(({ head, rows }) => {
    const single = head.unit_mismatch
    return {
      material_type_id: head.material_type_id,
      material_name: head.material_name,
      material_unit: head.unit,
      unit_price: head.unit_price,
      allocations: single
        ? []
        : rows.map((r) => ({
            purchase_request_item_id: r.line.purchase_request_item_id,
            quantity: String(r.qty),
            pr_no: r.line.pr_no,
            plot_label: r.line.plot_label,
          })),
      single: single
        ? {
            purchase_request_item_id: rows[0].line.purchase_request_item_id,
            // A line asked in another unit has no same-unit number to prefill.
            quantity: rows[0].qty > 0 ? String(rows[0].qty) : '',
            request_unit: rows[0].line.request_unit,
            pr_no: rows[0].line.pr_no,
          }
        : null,
    }
  })
  return { projectId, supplierId, plotIds, lines }
}
