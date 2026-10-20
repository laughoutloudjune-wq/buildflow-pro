import { formatCurrency } from '@/lib/currency'
import type { BillingAdjustmentForm } from '@/lib/types/billing'

type Line = BillingAdjustmentForm & { id?: string }

export const dcLineKey = (l: { description: string; unit: string; unit_price: number }) =>
  `${l.description.trim().replace(/\s+/g, ' ').toLowerCase()}|${l.unit}|${l.unit_price}`

const plotLabel = (n: string) => n.trim() || 'ไม่ระบุแปลง'

/**
 * Extra-work lines with the same job merged into one row, a chip per plot.
 * Tapping a chip takes that plot out of the approval (and back in). The
 * amounts are the same quantity x price the editor below uses.
 */
export default function ReviewDcLines({
  active,
  removed,
  editable,
  duplicates,
  onRemove,
  onRestore,
}: {
  active: Line[]
  removed: Line[]
  editable: boolean
  /** "description|plot" -> doc numbers of other bills with the same line */
  duplicates: Record<string, string[]>
  onRemove: (line: Line) => void
  onRestore: (line: Line) => void
}) {
  const groups = new Map<string, { head: Line; active: Line[]; removed: Line[] }>()
  for (const l of active) {
    const k = dcLineKey(l)
    const g = groups.get(k) || { head: l, active: [], removed: [] }
    g.active.push(l)
    groups.set(k, g)
  }
  for (const l of removed) {
    const k = dcLineKey(l)
    const g = groups.get(k) || { head: l, active: [], removed: [] }
    g.removed.push(l)
    groups.set(k, g)
  }
  const total = (lines: Line[]) => lines.reduce((s, l) => s + l.quantity * l.unit_price, 0)

  return (
    <div>
      {[...groups.entries()].map(([k, g]) => {
        const qty = g.active.reduce((s, l) => s + l.quantity, 0)
        const dupDocs = g.active.flatMap((l) => duplicates[`${l.description.trim().replace(/\s+/g, ' ').toLowerCase()}|${l.plot_name ?? ''}`] || [])
        return (
          <div key={k} className="border-b border-slate-100 py-3 last:border-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-slate-900">{g.head.description || '(ไม่มีชื่อ)'}</span>
              <span className="text-sm tabular-nums text-slate-700">
                {qty} {g.head.unit} × ฿{formatCurrency(g.head.unit_price)} = <b>฿{formatCurrency(total(g.active))}</b>
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {g.active.map((l, i) => (
                <button
                  key={`a${i}`}
                  type="button"
                  disabled={!editable}
                  onClick={() => onRemove(l)}
                  title={editable ? 'แตะเพื่อตัดแปลงนี้ออกจากการอนุมัติ' : undefined}
                  className="rounded-lg border-[1.5px] border-emerald-500 bg-emerald-50 px-2.5 py-1 text-sm font-semibold text-emerald-700 disabled:cursor-default"
                >
                  {plotLabel(l.plot_name ?? '')}
                  {l.quantity !== 1 ? ` ×${l.quantity}` : ''} ✓
                </button>
              ))}
              {g.removed.map((l, i) => (
                <button
                  key={`r${i}`}
                  type="button"
                  disabled={!editable}
                  onClick={() => onRestore(l)}
                  title="แตะเพื่อนำกลับเข้าการอนุมัติ"
                  className="rounded-lg border-[1.5px] border-slate-300 bg-white px-2.5 py-1 text-sm text-slate-400 line-through"
                >
                  {plotLabel(l.plot_name ?? '')}
                </button>
              ))}
            </div>
            {dupDocs.length > 0 && <p className="mt-1 text-xs font-medium text-amber-700">อาจซ้ำ: มีรายการเดียวกันในใบเบิก #{[...new Set(dupDocs)].join(', #')} แล้ว</p>}
          </div>
        )
      })}
      {editable && <p className="pt-1 text-xs text-slate-500">ชื่องานเดียวกันรวมเป็นแถวเดียว · แตะแปลงเพื่อตัดออกจากการอนุมัติ (แตะอีกครั้งเพื่อนำกลับ)</p>}
    </div>
  )
}
