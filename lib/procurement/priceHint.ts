import type { MaterialPriceRow } from '@/actions/procurement/orders'

export const PRICE_WARN_PCT = 5

export type PriceHint = {
  cheapest: { unitPrice: number; supplierName: string; orderDate: string }
  /** Last price paid to the PO's current supplier (same unit), if any. */
  fromSupplier: { unitPrice: number; orderDate: string } | null
  /** % the typed price is above the cheapest one; <= 0 when at or below it. */
  overPct: number
  warn: boolean
}

/** Compares a typed unit price with what past POs paid for the same material
 * in the same unit. Rows are the last 6 months, newest first. Returns null
 * when nothing comparable exists. */
export function buildPriceHint(rows: MaterialPriceRow[], unit: string, supplierId: string, current: number): PriceHint | null {
  const u = unit.trim()
  const same = rows.filter((r) => r.unit === u)
  if (same.length === 0) return null
  const cheapestRow = same.reduce((best, r) => (r.unitPrice < best.unitPrice ? r : best), same[0])
  const mine = supplierId ? same.find((r) => r.supplierId === supplierId) : undefined
  const overPct = current > 0 ? ((current - cheapestRow.unitPrice) / cheapestRow.unitPrice) * 100 : 0
  return {
    cheapest: { unitPrice: cheapestRow.unitPrice, supplierName: cheapestRow.supplierName, orderDate: cheapestRow.orderDate },
    fromSupplier: mine ? { unitPrice: mine.unitPrice, orderDate: mine.orderDate } : null,
    overPct,
    warn: current > 0 && overPct > PRICE_WARN_PCT,
  }
}
