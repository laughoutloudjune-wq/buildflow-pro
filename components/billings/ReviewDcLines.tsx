import { formatCurrency } from '@/lib/currency'
import type { BillingAdjustmentForm } from '@/lib/types/billing'

type Line = BillingAdjustmentForm & { id?: string }

export const dcLineKey = (l: { description: string; unit: string; unit_price: number }) =>
  `${l.description.trim().replace(/\s+/g, ' ').toLowerCase()}|${l.unit}|${l.unit_price}`

const plotLabel = (n: string) => n.trim() || 'ไม่ระบุแปลง'

const descKey = (l: { description: string }) => l.description.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Extra-work lines grouped by job name (shown once), one row per plot with
 * a checkbox. Unticking a row takes it out of the approval (tick again to
 * bring it back). Amounts are the same quantity x price the editor uses.
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
  const groups = new Map<string, { title: string; rows: { line: Line; on: boolean }[] }>()
  const add = (l: Line, on: boolean) => {
    const k = descKey(l)
    const g = groups.get(k) || { title: l.description, rows: [] }
    g.rows.push({ line: l, on })
    groups.set(k, g)
  }
  active.forEach((l) => add(l, true))
  removed.forEach((l) => add(l, false))
  const amount = (l: Line) => l.quantity * l.unit_price
  const total = active.reduce((s, l) => s + amount(l), 0)
  const rowCount = active.length + removed.length

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 py-3 text-sm">
        <span className="text-slate-700">อนุมัติ {active.length} จาก {rowCount} แถว</span>
        <b className="tabular-nums text-slate-900">รวม ฿{formatCurrency(total)}</b>
      </div>
      {[...groups.entries()].map(([k, g]) => {
        const dupDocs = g.rows.filter((r) => r.on).flatMap((r) => duplicates[`${descKey(r.line)}|${r.line.plot_name ?? ''}`] || [])
        return (
          <div key={k} className="border-b border-slate-100 py-3 last:border-0">
            <div className="mb-1 font-medium text-slate-900">{g.title || '(ไม่มีชื่อ)'}</div>
            <div className="hidden grid-cols-[28px_1fr_90px_100px_110px] gap-2 pb-1 text-[11px] uppercase tracking-wide text-slate-400 sm:grid">
              <span />
              <span>แปลง</span>
              <span className="text-right">จำนวน</span>
              <span className="text-right">ราคา/หน่วย</span>
              <span className="text-right">รวม (บาท)</span>
            </div>
            {g.rows.map(({ line: l, on }, i) => (
              <label
                key={i}
                className={`grid grid-cols-[28px_1fr_auto] items-center gap-2 py-1.5 text-sm tabular-nums sm:grid-cols-[28px_1fr_90px_100px_110px] ${on ? '' : 'opacity-50'} ${editable ? 'cursor-pointer' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!editable}
                  onChange={() => (on ? onRemove(l) : onRestore(l))}
                  title={on ? 'เอาติ๊กออกเพื่อตัดแถวนี้ออกจากการอนุมัติ' : 'ติ๊กเพื่อนำกลับเข้าการอนุมัติ'}
                  className="h-[18px] w-[18px] accent-emerald-500"
                />
                <span>{l.plot_name?.trim() ? `แปลง ${plotLabel(l.plot_name)}` : plotLabel('')}</span>
                <span className="hidden text-right sm:block">{l.quantity} {l.unit}</span>
                <span className="hidden text-right sm:block">฿{formatCurrency(l.unit_price)}</span>
                <span className={`text-right font-medium ${on ? '' : 'line-through'}`}>
                  ฿{formatCurrency(amount(l))}
                  <span className="block text-[11px] font-normal text-slate-400 sm:hidden">{l.quantity} {l.unit} × ฿{formatCurrency(l.unit_price)}</span>
                </span>
              </label>
            ))}
            {dupDocs.length > 0 && <p className="mt-1 text-xs font-medium text-amber-700">อาจซ้ำ: มีรายการเดียวกันในใบเบิก #{[...new Set(dupDocs)].join(', #')} แล้ว</p>}
          </div>
        )
      })}
      {editable && <p className="pt-1 text-xs text-slate-500">ชื่องานเดียวกันรวมเป็นหัวข้อเดียว · เอาติ๊กออกเพื่อตัดแถวนั้นออกจากการอนุมัติ (ติ๊กอีกครั้งเพื่อนำกลับ)</p>}
    </div>
  )
}
