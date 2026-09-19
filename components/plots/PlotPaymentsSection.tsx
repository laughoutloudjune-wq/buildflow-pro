'use client'

import { useState, useTransition } from 'react'
import { CalendarClock, CheckCircle2, Loader2, Plus, Printer, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import {
  createSalePayment,
  deleteSalePayment,
  generateDownPaymentSchedule,
  markSalePaymentPaid,
  type SalePaymentRow,
} from '@/actions/sale-payments-actions'

const KIND_LABEL: Record<string, string> = {
  booking: 'เงินจอง',
  contract: 'เงินทำสัญญา',
  down: 'เงินผ่อนดาวน์',
  transfer: 'เงินวันโอน',
  extra: 'เงินอื่นๆ',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

function isOverdue(payment: SalePaymentRow): boolean {
  if (payment.paidAt || !payment.dueDate) return false
  return new Date(payment.dueDate).getTime() < Date.now()
}

export default function PlotPaymentsSection({
  plotSaleId,
  payments,
  downTotal,
  contractAt,
  canEdit,
  onRefresh,
}: {
  plotSaleId: string
  payments: SalePaymentRow[]
  downTotal: number | null
  contractAt: string | null
  canEdit: boolean
  onRefresh: () => void
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [markPayingId, setMarkPayingId] = useState<string | null>(null)
  const [installmentCount, setInstallmentCount] = useState('12')

  const hasDownSchedule = payments.some((p) => p.kind === 'down')
  const canGenerateSchedule = canEdit && !hasDownSchedule && downTotal && downTotal > 0 && contractAt

  function handleGenerateSchedule() {
    const n = Number(installmentCount)
    if (!Number.isInteger(n) || n < 1) {
      toast.error('กรุณาใส่จำนวนงวดให้ถูกต้อง')
      return
    }
    startTransition(async () => {
      const res = await generateDownPaymentSchedule(plotSaleId, n)
      if (!res.success) {
        toast.error(res.error)
        return
      }
      toast.success(`สร้างตารางผ่อนดาวน์ ${res.count} งวดแล้ว`)
      onRefresh()
    })
  }

  function handleAddPayment(formData: FormData) {
    formData.set('plot_sale_id', plotSaleId)
    startTransition(async () => {
      const res = await createSalePayment(formData)
      if (!res.success) {
        toast.error(res.error)
        return
      }
      toast.success('บันทึกรายการแล้ว')
      setIsAddOpen(false)
      onRefresh()
    })
  }

  function handleMarkPaid(formData: FormData) {
    if (!markPayingId) return
    startTransition(async () => {
      const res = await markSalePaymentPaid(markPayingId, formData)
      if (!res.success) {
        toast.error(res.error)
        return
      }
      toast.success(`บันทึกการชำระแล้ว (${res.receiptNo})`)
      setMarkPayingId(null)
      onRefresh()
    })
  }

  function handleDelete(payment: SalePaymentRow) {
    if (!confirm(`ลบรายการ ${KIND_LABEL[payment.kind] || payment.kind}${payment.installmentNo ? ` งวดที่ ${payment.installmentNo}` : ''} ใช่ไหม?`)) return
    startTransition(async () => {
      const res = await deleteSalePayment(payment.id)
      if (!res.success) {
        toast.error(res.error)
        return
      }
      onRefresh()
    })
  }

  const markingPayment = markPayingId ? payments.find((p) => p.id === markPayingId) || null : null

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">การชำระเงิน</h3>
        {canEdit && (
          <div className="flex items-center gap-2">
            {canGenerateSchedule && (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={installmentCount}
                  onChange={(e) => setInstallmentCount(e.target.value)}
                  className="w-16 text-xs"
                />
                <Button type="button" size="sm" variant="secondary" onClick={handleGenerateSchedule} disabled={isPending}>
                  <CalendarClock className="h-3.5 w-3.5" /> สร้างตารางผ่อนดาวน์
                </Button>
              </div>
            )}
            <Button type="button" size="sm" onClick={() => setIsAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> เพิ่มรายการ
            </Button>
          </div>
        )}
      </div>

      {payments.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">ยังไม่มีรายการชำระเงิน</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-2 font-medium">รายการ</th>
                <th className="py-2 pr-2 font-medium">ครบกำหนด</th>
                <th className="py-2 pr-2 text-right font-medium">จำนวนเงิน</th>
                <th className="py-2 pr-2 font-medium">สถานะ</th>
                {canEdit && <th className="py-2 pr-2 font-medium">การดำเนินการ</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p) => {
                const overdue = isOverdue(p)
                return (
                  <tr key={p.id}>
                    <td className="py-2 pr-2">
                      {KIND_LABEL[p.kind] || p.kind}
                      {p.installmentNo != null && ` งวดที่ ${p.installmentNo}`}
                    </td>
                    <td className={`py-2 pr-2 ${overdue ? 'font-medium text-red-600' : 'text-slate-500'}`}>{formatDate(p.dueDate)}</td>
                    <td className="py-2 pr-2 text-right font-medium text-slate-700">
                      ฿{formatCurrency(p.amountPaid ?? p.amountDue)}
                    </td>
                    <td className="py-2 pr-2">
                      {p.paidAt ? (
                        <Badge tone="success">ชำระแล้ว</Badge>
                      ) : overdue ? (
                        <Badge tone="danger">เกินกำหนด</Badge>
                      ) : (
                        <Badge tone="neutral">รอชำระ</Badge>
                      )}
                    </td>
                    {canEdit && (
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2">
                          {p.paidAt && p.receiptNo ? (
                            <a
                              href={`/dashboard/sales/receipts/${p.id}/print`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                            >
                              <Printer className="h-3.5 w-3.5" /> {p.receiptNo}
                            </a>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setMarkPayingId(p.id)}
                              className="flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" /> บันทึกการชำระ
                            </button>
                          )}
                          {!p.paidAt && (
                            <button type="button" onClick={() => handleDelete(p)} className="text-slate-300 hover:text-red-500">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="เพิ่มรายการชำระเงิน">
        <form action={handleAddPayment} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ประเภท</label>
            <select name="kind" required defaultValue="booking" className="w-full">
              {Object.entries(KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">จำนวนเงิน</label>
              <input type="number" min="0" step="0.01" name="amount_due" required className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ครบกำหนด</label>
              <input type="date" name="due_date" className="w-full" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="mark_paid_now" className="h-4 w-4 rounded border-slate-300" />
            ชำระแล้ว (ออกใบเสร็จทันที)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">วิธีชำระ</label>
              <select name="method" defaultValue="">
                <option value="">— ไม่ระบุ —</option>
                <option value="โอน">โอน</option>
                <option value="เงินสด">เงินสด</option>
                <option value="เช็ค">เช็ค</option>
                <option value="บัตร">บัตร</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">หมายเหตุ</label>
              <input name="note" className="w-full" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setIsAddOpen(false)}>ยกเลิก</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              บันทึก
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(markingPayment)}
        onClose={() => setMarkPayingId(null)}
        title={markingPayment ? `บันทึกการชำระ - ${KIND_LABEL[markingPayment.kind] || markingPayment.kind}${markingPayment.installmentNo ? ` งวดที่ ${markingPayment.installmentNo}` : ''}` : ''}
      >
        {markingPayment && (
          <form action={handleMarkPaid} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">จำนวนที่ชำระ</label>
                <input type="number" min="0" step="0.01" name="amount_paid" defaultValue={markingPayment.amountDue} className="w-full" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">วันที่ชำระ</label>
                <input type="date" name="paid_at" defaultValue={new Date().toISOString().slice(0, 10)} className="w-full" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">วิธีชำระ</label>
              <select name="method" defaultValue="โอน" className="w-full">
                <option value="โอน">โอน</option>
                <option value="เงินสด">เงินสด</option>
                <option value="เช็ค">เช็ค</option>
                <option value="บัตร">บัตร</option>
              </select>
            </div>
            <p className="text-xs text-slate-400">การบันทึกจะออกเลขที่ใบเสร็จอัตโนมัติ และพิมพ์ได้ทันที</p>
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button type="button" variant="secondary" onClick={() => setMarkPayingId(null)}>ยกเลิก</Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                บันทึกและออกใบเสร็จ
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  )
}
