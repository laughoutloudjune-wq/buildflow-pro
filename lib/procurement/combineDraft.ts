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
