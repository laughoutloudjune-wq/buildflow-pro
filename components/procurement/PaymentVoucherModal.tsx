'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useDepartment } from '@/components/layout/DepartmentContext'
import { formatCurrency } from '@/lib/currency'
import { todayInBangkok } from '@/lib/utils'
import { createPaymentVoucher } from '@/actions/procurement-actions'
import { getBoqCheckForReceipts, setPoBoqOverrides } from '@/actions/procurement/boq-control'
import { isBoqCheckLineOver } from '@/lib/procurement/boqControl'
import BoqCheckPanel from '@/components/procurement/BoqCheckPanel'
import PayoutPoComparison from '@/components/procurement/PayoutPoComparison'
import type { GoodsReceipt, PaymentMethod } from '@/lib/types/procurement'

const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'เงินสด',
  bank_transfer: 'เงินโอน',
  director_loan: 'เงินกู้ยืมกรรมการ',
}

function receiptAmount(r: GoodsReceipt): number {
  return (r.goods_receipt_items || []).reduce((sum, i) => sum + i.quantity_received * i.unit_price_at_receipt, 0)
}

/**
 * "สร้างใบสำคัญจ่าย": pay one supplier's receipts in one voucher. Shared by the
 * ใบรับสินค้า list and the งานจัดซื้อ window so both do exactly the same
 * thing: compare with the PO, show the BOQ check (a warning, never a stop),
 * take the date / method, then create the voucher.
 */
export default function PaymentVoucherModal({
  receipts: initialReceipts,
  others = [],
  onClose,
  onCreated,
}: {
  /** Receipts of ONE supplier, none of them paid yet. */
  receipts: GoodsReceipt[]
  /** Other unpaid receipts of the same supplier, offered as tick boxes so
   * several can go into one voucher. */
  others?: GoodsReceipt[]
  onClose: () => void
  onCreated: (result: { id: string; pp_no: string }) => void
}) {
  const toast = useToast()
  const { theme } = useDepartment()
  const [paymentDate, setPaymentDate] = useState(() => todayInBangkok())
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [whtPercent, setWhtPercent] = useState('')
  const [reference, setReference] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [boqCheck, setBoqCheck] = useState<Awaited<ReturnType<typeof getBoqCheckForReceipts>>>({ perPo: [], overCount: 0 })
  const [isBoqCheckLoading, setIsBoqCheckLoading] = useState(true)
  // Keyed `${poId}:${materialTypeId}` - a payment can span several POs, and
  // material ids aren't unique across them.
  const [boqReasons, setBoqReasons] = useState<Record<string, string>>({})

  const [pickedIds, setPickedIds] = useState<string[]>(() => initialReceipts.map((r) => r.id))
  const everyReceipt = useMemo(() => [...initialReceipts, ...others.filter((o) => !initialReceipts.some((r) => r.id === o.id))], [initialReceipts, others])
  const receipts = useMemo(() => everyReceipt.filter((r) => pickedIds.includes(r.id)), [everyReceipt, pickedIds])
  const receiptIds = useMemo(() => receipts.map((r) => r.id), [receipts])
  const receiptKey = receiptIds.join(',')
  const total = useMemo(() => receipts.reduce((sum, r) => sum + receiptAmount(r), 0), [receipts])
  const wht = Math.max(0, Number(whtPercent) || 0)
  const whtAmount = Math.round(total * wht) / 100
  const supplierId = receipts[0]?.purchase_orders?.supplier_id || null

  useEffect(() => {
    if (!receiptKey) return
    let cancelled = false
    getBoqCheckForReceipts(receiptKey.split(','))
      .then((r) => {
        if (!cancelled) setBoqCheck(r)
      })
      .catch(() => {
        if (!cancelled) setBoqCheck({ perPo: [], overCount: 0 })
      })
      .finally(() => {
        if (!cancelled) setIsBoqCheckLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [receiptKey])

  async function handleCreatePayment() {
    if (receipts.length === 0 || !supplierId) return
    const companyId = receipts[0].purchase_orders?.company_id
    if (!companyId) {
      toast.error('ไม่พบบริษัทผู้ซื้อของใบรับสินค้าที่เลือก')
      return
    }
    setIsSaving(true)

    // Write whatever over-BOQ reasons were typed before creating the
    // voucher (decision: warn and record, never block - a line left blank
    // simply stays unacknowledged rather than stopping the payment).
    try {
      for (const po of boqCheck.perPo) {
        const overrides = po.lines
          .filter(isBoqCheckLineOver)
          .map((l) => ({ materialTypeId: l.materialTypeId, reason: (boqReasons[`${po.poId}:${l.materialTypeId}`] || '').trim(), plannedQuantity: l.plannedQty, totalAfterThisPo: l.totalAfter }))
          .filter((o) => o.reason.length > 0)
        if (overrides.length > 0) await setPoBoqOverrides(po.poId, overrides)
      }
    } catch (error) {
      setIsSaving(false)
      toast.error(error instanceof Error ? error.message : 'บันทึกการอนุมัติเกิน BOQ ไม่สำเร็จ')
      return
    }

    createPaymentVoucher({
      supplier_id: supplierId,
      company_id: companyId,
      payment_date: paymentDate,
      payment_method: paymentMethod,
      // Withholding tax and the bank / cheque reference have no column of their
      // own; they are kept as lines in the voucher note so they print and show.
      note:
        [
          wht > 0 ? `หัก ณ ที่จ่าย ${wht}% = ฿${formatCurrency(whtAmount)} (จ่ายสุทธิ ฿${formatCurrency(total - whtAmount)})` : '',
          reference.trim() ? `อ้างอิง: ${reference.trim()}` : '',
          note.trim(),
        ]
          .filter(Boolean)
          .join('\n') || undefined,
      receipt_ids: receiptIds,
    })
      .then((result) => {
        if ('error' in result) {
          toast.error(result.error)
          return
        }
        toast.success(`สร้างใบสำคัญจ่าย ${result.pp_no} แล้ว`)
        onCreated(result)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'สร้างใบสำคัญจ่ายไม่สำเร็จ'))
      .finally(() => setIsSaving(false))
  }

  return (
    <Modal isOpen onClose={onClose} title="จ่ายเงิน" panelClassName="max-w-3xl">
      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">1. ใบรับสินค้าที่จะจ่าย</h3>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-800">{receipts[0]?.purchase_orders?.suppliers?.name}</p>
            <ul className="mt-1 space-y-0.5 text-slate-500">
              {everyReceipt.map((r) => (
                <li key={r.id} className="flex justify-between">
                  <label className="mb-0 flex cursor-pointer items-center gap-2">
                    {everyReceipt.length > 1 && (
                      <input
                        type="checkbox"
                        checked={pickedIds.includes(r.id)}
                        disabled={pickedIds.length === 1 && pickedIds.includes(r.id)}
                        onChange={(e) => setPickedIds((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id)))}
                        aria-label={`เลือก ${r.ri_no}`}
                      />
                    )}
                    {r.ri_no}
                    {r.purchase_orders?.po_no ? <span className="ml-2 text-xs">PO {r.purchase_orders.po_no}</span> : null}
                  </label>
                  <span className="tabular-nums">฿{formatCurrency(receiptAmount(r))}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-800">
              <span>ยอดรวมใบรับสินค้า</span>
              <span className="tabular-nums">฿{formatCurrency(total)}</span>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">2. เทียบกับใบสั่งซื้อ (PO)</h3>
          <PayoutPoComparison receiptIds={receiptIds} />
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">3. ตรวจสอบ BOQ</h3>
          {isBoqCheckLoading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> กำลังตรวจสอบ BOQ...
            </div>
          ) : (
            boqCheck.perPo.length > 0 && (
              <div className="space-y-2">
                {boqCheck.perPo.map((po) => (
                  <div key={po.poId}>
                    <p className="mb-1 text-xs font-medium text-slate-500">ใบสั่งซื้อ {po.poNo}</p>
                    <BoqCheckPanel
                      lines={po.lines}
                      scopeLabel={po.scopeLabel}
                      onReasonChange={(materialTypeId, reason) =>
                        setBoqReasons((prev) => ({ ...prev, [`${po.poId}:${materialTypeId}`]: reason }))
                      }
                    />
                  </div>
                ))}
              </div>
            )
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">4. รายละเอียดการจ่าย</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">วันที่จ่าย</label>
              <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full" />
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">รูปแบบการชำระเงิน</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="รูปแบบการชำระเงิน">
                {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
                  <label
                    key={m}
                    className={`mb-0 flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-sm ${
                      paymentMethod === m ? theme.pill : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input type="radio" name="payment_method" className="sr-only" checked={paymentMethod === m} onChange={() => setPaymentMethod(m)} />
                    {PAYMENT_METHOD_LABEL[m]}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">หัก ณ ที่จ่าย (%)</label>
              <input type="number" min="0" step="0.5" value={whtPercent} onChange={(e) => setWhtPercent(e.target.value)} className="w-full" placeholder="ไม่หักใส่ว่าง" />
              {wht > 0 && <p className="mt-1 text-xs text-slate-500">หัก ฿{formatCurrency(whtAmount)} · จ่ายสุทธิ ฿{formatCurrency(total - whtAmount)} (ยอดนี้บันทึกในหมายเหตุ)</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">อ้างอิง (เลขโอน / เช็ค)</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className="w-full" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">หมายเหตุ</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full" />
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="text-sm">
            <p className="text-slate-500">
              ยอดที่จะจ่าย <span className="text-lg font-bold tabular-nums text-slate-900">฿{formatCurrency(total)}</span>
            </p>
            {boqCheck.overCount > 0 && (
              <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> เกิน BOQ {boqCheck.overCount} รายการ — ระบุเหตุผลในหัวข้อ 3 (ไม่บังคับ)
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button type="button" size="sm" onClick={handleCreatePayment} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : boqCheck.overCount > 0 ? (
                'บันทึกการจ่ายเงิน (เกิน BOQ)'
              ) : (
                'บันทึกการจ่ายเงิน'
              )}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
