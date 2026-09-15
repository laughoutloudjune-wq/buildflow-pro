'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/currency'
import { isBoqCheckLineOver, type BoqCheckLine, type BoqCheckOverride } from '@/lib/procurement/boqControl'

// Re-exported so existing call sites (`import BoqCheckPanel, { type
// BoqCheckLine } from '.../BoqCheckPanel'`) keep working - the canonical
// definitions now live in lib/procurement/boqControl.ts so server-only code
// (the PDF builder, the receipt/payment actions) can share them without
// importing a 'use client' module.
export type { BoqCheckLine, BoqCheckOverride }

type Props = {
  lines: BoqCheckLine[]
  /** e.g. 'กลุ่มแปลง 98-102'. */
  scopeLabel: string
  /** Omit both this and onReasonChange to render read-only (print, PR preview). */
  onAcknowledge?: (overrides: { materialTypeId: number; reason: string }[]) => Promise<void>
  /** Alternative to onAcknowledge for a host that batches several panels'
   * reasons into one outer save (the payment voucher modal, which writes
   * every PO's overrides right before creating the voucher rather than per
   * panel) - fired on every keystroke instead of rendering its own
   * "รับทราบ" button. */
  onReasonChange?: (materialTypeId: number, reason: string) => void
  existingOverrides?: BoqCheckOverride[]
  isSaving?: boolean
}

/**
 * The owner's check at the moment money moves (BOQ_CONTROL_PLAN.md 9) -
 * shared by the PO detail page, the purchase request preview, the goods-
 * receipt modal, and the payment voucher modal. Collapsed by default when
 * every line is in budget (must not slow down the normal case) but always
 * expandable to the full material breakdown - not just a summary count -
 * since "what's actually in this PO/receipt" is useful to see either way.
 * Expanded automatically, with a red banner and a mandatory reason per over
 * line, when anything is over. Decision: warn and record, never block - the
 * acknowledge button records reasons, it never prevents the document itself
 * from being saved.
 */
export default function BoqCheckPanel({ lines, scopeLabel, onAcknowledge, onReasonChange, existingOverrides, isSaving }: Props) {
  const overrideByMaterial = useMemo(() => new Map((existingOverrides || []).map((o) => [o.materialTypeId, o])), [existingOverrides])
  const overLines = useMemo(() => lines.filter(isBoqCheckLineOver), [lines])
  const [isExpanded, setIsExpanded] = useState(overLines.length > 0)
  const [reasons, setReasons] = useState<Record<number, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (lines.length === 0) return null

  const isOver = overLines.length > 0
  const unresolvedOverLines = overLines.filter((l) => !overrideByMaterial.has(l.materialTypeId))
  const canAcknowledge = unresolvedOverLines.every((l) => (reasons[l.materialTypeId] || '').trim().length > 0)
  const hasValues = lines.some((l) => l.thisDocValue != null)

  async function handleAcknowledge() {
    if (!onAcknowledge) return
    setIsSubmitting(true)
    try {
      await onAcknowledge(unresolvedOverLines.map((l) => ({ materialTypeId: l.materialTypeId, reason: reasons[l.materialTypeId].trim() })))
      setReasons({})
    } finally {
      setIsSubmitting(false)
    }
  }

  const saving = isSaving || isSubmitting

  return (
    <div className={`overflow-hidden rounded-lg border ${isOver ? 'border-red-200' : 'border-emerald-200'}`}>
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className={`flex w-full items-center gap-2 px-3 py-2.5 text-sm ${isOver ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}
      >
        {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        {isOver ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
        <span className="font-semibold">{isOver ? `เกิน BOQ ${overLines.length} รายการ` : 'อยู่ในงบ BOQ ทั้งหมด'}</span>
        <span className={isOver ? 'text-red-600' : 'text-emerald-600'}>({scopeLabel})</span>
        {!isExpanded && <span className="ml-auto shrink-0 text-xs opacity-80">{lines.length} รายการ</span>}
      </button>

      {isExpanded && (
        <div className={`border-t p-3 ${isOver ? 'border-red-100 bg-white' : 'border-emerald-100 bg-white'}`}>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-3 py-2">วัสดุ</th>
                  <th className="px-3 py-2 text-right">BOQ ตามแบบ</th>
                  <th className="px-3 py-2 text-right">ซื้อไปแล้ว</th>
                  <th className="px-3 py-2 text-right">ใบนี้</th>
                  {hasValues && <th className="px-3 py-2 text-right">มูลค่าใบนี้</th>}
                  <th className="px-3 py-2 text-right">รวมทั้งหมด</th>
                  <th className="px-3 py-2 text-right">เกิน/เหลือ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line) => {
                  const over = isBoqCheckLineOver(line)
                  const diff = line.plannedQty - line.totalAfter
                  const override = overrideByMaterial.get(line.materialTypeId)
                  return (
                    <tr key={line.materialTypeId} className={over ? 'bg-red-50/40' : undefined}>
                      <td className="px-3 py-2 align-top font-medium text-slate-800">
                        {line.materialName}
                        {over && (
                          <div className="mt-1.5 max-w-sm">
                            {override ? (
                              <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                                <span className="font-medium text-slate-700">อนุมัติแล้ว:</span> {override.reason}
                                <br />
                                <span className="text-slate-400">
                                  โดย {override.approvedBy} · {new Date(override.approvedAt).toLocaleDateString('th-TH')}
                                </span>
                              </p>
                            ) : onAcknowledge || onReasonChange ? (
                              <textarea
                                value={reasons[line.materialTypeId] || ''}
                                onChange={(e) => {
                                  const value = e.target.value
                                  setReasons((prev) => ({ ...prev, [line.materialTypeId]: value }))
                                  onReasonChange?.(line.materialTypeId, value)
                                }}
                                placeholder="เหตุผลที่ซื้อเกิน BOQ (จำเป็นต้องระบุ)"
                                rows={2}
                                className="w-full rounded border border-red-200 px-2 py-1 text-xs"
                              />
                            ) : (
                              <p className="text-xs text-red-500">ยังไม่มีการอนุมัติเกิน BOQ</p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right align-top text-slate-600">
                        {line.plannedQty.toLocaleString('th-TH')} {line.unit}
                      </td>
                      <td className="px-3 py-2 text-right align-top text-slate-600">
                        {line.alreadyQty.toLocaleString('th-TH')} {line.unit}
                      </td>
                      <td className="px-3 py-2 text-right align-top font-medium text-slate-800">
                        {line.thisDocQty.toLocaleString('th-TH')} {line.unit}
                      </td>
                      {hasValues && (
                        <td className="px-3 py-2 text-right align-top text-slate-600">
                          {line.thisDocValue != null ? `฿${formatCurrency(line.thisDocValue)}` : '-'}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right align-top font-medium text-slate-800">
                        {line.totalAfter.toLocaleString('th-TH')} {line.unit}
                      </td>
                      <td className={`px-3 py-2 text-right align-top font-medium ${over ? 'text-red-600' : 'text-emerald-600'}`}>
                        {line.plannedQty > 0 ? (
                          <>
                            {over ? '-' : '+'}
                            {Math.abs(diff).toLocaleString('th-TH')} {line.unit}
                          </>
                        ) : (
                          <span className="text-slate-400">ไม่มีใน BOQ</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {onAcknowledge && unresolvedOverLines.length > 0 && (
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="danger" onClick={handleAcknowledge} disabled={!canAcknowledge || saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                รับทราบ - อนุมัติเกิน BOQ
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
