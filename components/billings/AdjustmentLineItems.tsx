'use client'

import { Plus, Trash2 } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import type { BillingAdjustmentForm } from '@/lib/types/billing'

type Adjustment = BillingAdjustmentForm

type Props = {
  adjustments: Adjustment[]
  plotOptions: string[]
  onChange: (index: number, field: keyof Adjustment, value: Adjustment[keyof Adjustment]) => void
  onAdd: (type: 'addition' | 'deduction') => void
  onRemove: (index: number) => void
  totalAddAmount: number
  totalDeductAmount: number
  /** Label + value shown at the far right of the running-total bar. */
  netLabel?: string
  netValue?: number
  /** Tint the running-total bar; defaults to amber. */
  theme?: 'amber' | 'slate'
  /** Show who last edited each line (used on the PM review screen). */
  showSignature?: boolean
}

/** Parses a number input's raw value, coercing anything invalid (empty, NaN) to 0
 * instead of letting NaN flow into totals and render as "NaN" in the UI. */
function parseSafeNumber(raw: string): number {
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : 0
}

export default function AdjustmentLineItems({
  adjustments,
  plotOptions,
  onChange,
  onAdd,
  onRemove,
  totalAddAmount,
  totalDeductAmount,
  netLabel = 'ยอดสุทธิ',
  netValue,
  theme = 'amber',
  showSignature = false,
}: Props) {
  const net = netValue ?? totalAddAmount - totalDeductAmount
  const barClass = theme === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-slate-100 border-slate-200'
  const netTextClass = theme === 'amber' ? 'text-amber-800' : 'text-slate-800'

  return (
    <div>
      {adjustments.length > 0 && (
        <div className="grid grid-cols-12 gap-2 mb-1 items-center px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
          <div className="col-span-2">ประเภท</div>
          <div className="col-span-2">แปลง</div>
          <div className={showSignature ? 'col-span-3' : 'col-span-2'}>รายละเอียด</div>
          <div className="col-span-1">หน่วย</div>
          <div className="col-span-1 text-right">จำนวน</div>
          <div className="col-span-2 text-right">ราคา/หน่วย</div>
          {!showSignature && <div className="col-span-1 text-right">ยอด</div>}
          <div className="col-span-1"></div>
        </div>
      )}

      {adjustments.map((adj, index) => {
        const rowTotal = (adj.quantity || 0) * (adj.unit_price || 0)
        const isAdd = adj.type === 'addition'
        return (
          <div
            key={index}
            className={`grid grid-cols-12 gap-2 mb-2 items-start rounded-lg p-2 ${
              isAdd ? 'bg-green-50/60 border border-green-100' : 'bg-red-50/60 border border-red-100'
            }`}
          >
            <div className="col-span-2">
              <select
                value={adj.type}
                onChange={(e) => onChange(index, 'type', e.target.value as Adjustment['type'])}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="addition">งานเพิ่ม</option>
                <option value="deduction">งานหัก</option>
              </select>
            </div>
            <div className="col-span-2">
              {plotOptions.length > 0 ? (
                <select
                  value={adj.plot_name || ''}
                  onChange={(e) => onChange(index, 'plot_name', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">แปลง (ถ้ามี)</option>
                  {plotOptions.map((plot) => (
                    <option key={plot} value={plot}>{plot}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="แปลง"
                  value={adj.plot_name || ''}
                  onChange={(e) => onChange(index, 'plot_name', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm"
                />
              )}
            </div>
            <div className={showSignature ? 'col-span-3' : 'col-span-2'}>
              <input
                type="text"
                placeholder="รายละเอียดงาน"
                value={adj.description}
                onChange={(e) => onChange(index, 'description', e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
              />
              {showSignature && adj.signature?.user_id ? (
                <div className="mt-1 text-[11px] text-slate-500">
                  ลงชื่อโดย {adj.signature?.full_name || 'ไม่ระบุผู้แก้ไข'}
                  {adj.signature?.role ? ` (${adj.signature.role})` : ''}
                  {adj.signature?.at ? ` • ${new Date(adj.signature.at).toLocaleString('th-TH')}` : ''}
                </div>
              ) : null}
            </div>
            <div className="col-span-1">
              <input
                type="text"
                placeholder="หน่วย"
                value={adj.unit}
                onChange={(e) => onChange(index, 'unit', e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div className="col-span-1">
              <input
                type="number"
                placeholder="จำนวน"
                value={adj.quantity}
                onChange={(e) => onChange(index, 'quantity', parseSafeNumber(e.target.value))}
                className="w-full p-2 border border-gray-300 rounded-md text-sm text-right"
              />
            </div>
            <div className="col-span-2">
              <input
                type="number"
                placeholder="ราคาต่อหน่วย"
                value={adj.unit_price}
                onChange={(e) => onChange(index, 'unit_price', parseSafeNumber(e.target.value))}
                className="w-full p-2 border border-gray-300 rounded-md text-sm text-right"
              />
            </div>
            {!showSignature && (
              <div className={`col-span-1 py-2 text-right font-semibold text-sm ${isAdd ? 'text-green-700' : 'text-red-600'}`}>
                {isAdd ? '+' : '-'}{formatCurrency(rowTotal)}
              </div>
            )}
            <div className="col-span-1">
              <button type="button" onClick={() => onRemove(index)} className="p-2 text-red-500 hover:text-red-700">
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        )
      })}

      {!showSignature && adjustments.length > 0 && (
        <div className={`mt-3 flex items-center justify-end gap-6 rounded-lg border px-4 py-2 text-sm ${barClass}`}>
          <span className="text-slate-500">งานเพิ่มรวม: <span className="font-bold text-green-700">+{formatCurrency(totalAddAmount)}</span></span>
          <span className="text-slate-500">งานหักรวม: <span className="font-bold text-red-600">-{formatCurrency(totalDeductAmount)}</span></span>
          <span className={`font-bold ${netTextClass}`}>{netLabel}: <span className={net >= 0 ? 'text-green-700' : 'text-red-600'}>{formatCurrency(net)}</span></span>
        </div>
      )}

      <button
        type="button"
        onClick={() => onAdd('addition')}
        className="flex items-center gap-1 text-sm text-green-600 hover:text-green-800 mt-3"
      >
        <Plus className="h-4 w-4" />
        เพิ่มรายการงานเพิ่ม
      </button>
      <button
        type="button"
        onClick={() => onAdd('deduction')}
        className="flex items-center gap-1 text-sm text-red-600 hover:text-red-800 mt-1"
      >
        <Plus className="h-4 w-4" />
        เพิ่มรายการงานหัก
      </button>
    </div>
  )
}
