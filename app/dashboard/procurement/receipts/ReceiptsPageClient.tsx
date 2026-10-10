'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Loader2, Wallet } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { useDepartment } from '@/components/layout/DepartmentContext'
import { PageToolbar } from '@/components/ui/PageToolbar'
import { TableFrame } from '@/components/ui/TableFrame'
import { EmptyState } from '@/components/ui/EmptyState'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import { todayInBangkok } from '@/lib/utils'
import { createPaymentVoucher } from '@/actions/procurement-actions'
import BoqCheckPanel from '@/components/procurement/BoqCheckPanel'
import PayoutPoComparison from '@/components/procurement/PayoutPoComparison'
import ReceiptDetailModal from '@/components/procurement/ReceiptDetailModal'
import { getBoqCheckForReceipts, setPoBoqOverrides } from '@/actions/procurement/boq-control'
import { isBoqCheckLineOver } from '@/lib/procurement/boqControl'
import type { GoodsReceipt, PaymentMethod } from '@/lib/types/procurement'

const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'เงินสด',
  bank_transfer: 'เงินโอน',
  director_loan: 'เงินกู้ยืมกรรมการ',
}

function receiptAmount(r: GoodsReceipt): number {
  return (r.goods_receipt_items || []).reduce((sum, i) => sum + i.quantity_received * i.unit_price_at_receipt, 0)
}

function materialSummary(r: GoodsReceipt): { label: string; extra: number } {
  const items = r.goods_receipt_items || []
  if (items.length === 0) return { label: '-', extra: 0 }
  return { label: items[0].purchase_order_items?.material_types?.name || '-', extra: items.length - 1 }
}

function isPaid(r: GoodsReceipt): boolean {
  return (r.payment_voucher_receipts || []).length > 0
}

export default function ReceiptsPageClient({
  receipts,
  initialError,
}: {
  receipts: GoodsReceipt[]
  initialError?: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const { theme } = useDepartment()

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailReceipt, setDetailReceipt] = useState<GoodsReceipt | null>(null)
  const [isPayModalOpen, setIsPayModalOpen] = useState(false)
  const [paymentDate, setPaymentDate] = useState(() => todayInBangkok())
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const [boqCheck, setBoqCheck] = useState<Awaited<ReturnType<typeof getBoqCheckForReceipts>>>({ perPo: [], overCount: 0 })
  const [isBoqCheckLoading, setIsBoqCheckLoading] = useState(false)
  // Keyed `${poId}:${materialTypeId}` - a payment can span several POs, and
  // material ids aren't unique across them.
  const [boqReasons, setBoqReasons] = useState<Record<string, string>>({})

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return receipts
    return receipts.filter((r) => {
      const materials = (r.goods_receipt_items || []).map((i) => i.purchase_order_items?.material_types?.name || '').join(' ')
      const haystack = `${r.ri_no} ${r.purchase_orders?.po_no || ''} ${r.purchase_orders?.suppliers?.name || ''} ${materials}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [receipts, search])

  const selectedReceipts = useMemo(() => receipts.filter((r) => selected.has(r.id)), [receipts, selected])
  const selectedSupplierId = selectedReceipts[0]?.purchase_orders?.supplier_id || null
  const selectedTotal = useMemo(() => selectedReceipts.reduce((sum, r) => sum + receiptAmount(r), 0), [selectedReceipts])

  useEffect(() => {
    if (!isPayModalOpen || selected.size === 0) return
    setIsBoqCheckLoading(true)
    setBoqReasons({})
    getBoqCheckForReceipts(Array.from(selected))
      .then(setBoqCheck)
      .catch(() => setBoqCheck({ perPo: [], overCount: 0 }))
      .finally(() => setIsBoqCheckLoading(false))
  }, [isPayModalOpen, selected])

  function toggleOne(r: GoodsReceipt) {
    if (isPaid(r)) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(r.id)) {
        next.delete(r.id)
        return next
      }
      // Only one supplier's receipts can be bundled into a single payment voucher.
      const supplierId = r.purchase_orders?.supplier_id
      const currentSupplierId = [...prev].map((id) => receipts.find((x) => x.id === id)).find(Boolean)?.purchase_orders?.supplier_id
      if (currentSupplierId && supplierId !== currentSupplierId) {
        return new Set([r.id])
      }
      next.add(r.id)
      return next
    })
  }

  async function handleCreatePayment() {
    if (selectedReceipts.length === 0 || !selectedSupplierId) return
    const companyId = selectedReceipts[0].purchase_orders?.company_id
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
      supplier_id: selectedSupplierId,
      company_id: companyId,
      payment_date: paymentDate,
      payment_method: paymentMethod,
      note: note.trim() || undefined,
      receipt_ids: Array.from(selected),
    })
      .then((result) => {
        if ('error' in result) {
          toast.error(result.error)
          return
        }
        toast.success(`สร้างใบสำคัญจ่าย ${result.pp_no} แล้ว`)
        setSelected(new Set())
        setIsPayModalOpen(false)
        setNote('')
        router.refresh()
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'สร้างใบสำคัญจ่ายไม่สำเร็จ'))
      .finally(() => setIsSaving(false))
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="ใบรับสินค้า (RI)"
        subtitle="ทุกครั้งที่รับของจาก PO จะสร้างใบรับสินค้า (RI) - เลือกใบที่ยังไม่จ่ายเพื่อสร้างใบสำคัญจ่าย"
      />

      <PageToolbar
        search={{ value: search, onChange: setSearch, placeholder: 'ค้นหาเลขที่ RI / PO / ผู้จำหน่าย / วัสดุ' }}
        activeFilters={search.trim() ? [{ label: `ค้นหา "${search.trim()}"`, onRemove: () => setSearch('') }] : []}
        onReset={() => setSearch('')}
      />

      {selected.size > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-indigo-100 bg-indigo-50/60 px-4 py-3">
          <span className="text-sm text-indigo-800">
            เลือกแล้ว <span className="font-semibold">{selected.size}</span> รายการ · ยอดรวม{' '}
            <span className="font-semibold">฿{formatCurrency(selectedTotal)}</span>
          </span>
          <Button type="button" size="sm" onClick={() => setIsPayModalOpen(true)}>
            <Wallet className="h-3.5 w-3.5" /> สร้างใบสำคัญจ่าย
          </Button>
        </Card>
      )}

      <TableFrame>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm">
          <span className="text-slate-500">
            ผลลัพธ์ <span className="font-semibold text-slate-700">{rows.length}</span> รายการ
          </span>
        </div>
          <table>
            <thead>
              <tr>
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3">เลขที่ RI</th>
                <th className="px-4 py-3">วันที่</th>
                <th className="px-4 py-3">PO</th>
                <th className="px-4 py-3">ผู้จำหน่าย</th>
                <th className="px-4 py-3">วัสดุ</th>
                <th className="px-4 py-3 text-right">ยอดสุทธิ</th>
                <th className="px-4 py-3">ใบสำคัญจ่าย</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState
                      variant={search.trim() ? 'no-results' : 'empty'}
                      title={search.trim() ? 'ไม่พบใบรับสินค้าตามคำค้นหา' : 'ยังไม่มีใบรับสินค้า'}
                      description={search.trim() ? 'ลองเปลี่ยนคำค้นหา' : 'ใบรับสินค้าจะถูกสร้างเมื่อรับของจาก PO'}
                    />
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const { label, extra } = materialSummary(r)
                  const paid = isPaid(r)
                  const voucher = r.payment_voucher_receipts?.[0]?.payment_vouchers
                  return (
                    <tr key={r.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleOne(r)}
                          disabled={paid}
                          title={paid ? 'จ่ายแล้ว' : undefined}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setDetailReceipt(r)}
                          className="font-mono font-medium text-indigo-600 hover:underline"
                        >
                          {r.ri_no}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{new Date(r.received_at).toLocaleDateString('th-TH')}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link href={`/dashboard/procurement/orders/${r.purchase_order_id}`} className="font-mono text-indigo-600 hover:underline">
                          {r.purchase_orders?.po_no || '-'}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{r.purchase_orders?.suppliers?.name || '-'}</td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-slate-500">
                        {label}
                        {extra > 0 && <span className="ml-1 text-xs text-slate-500">+{extra}</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">฿{formatCurrency(receiptAmount(r))}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {paid ? (
                          <Link href="/dashboard/procurement/payments" className="font-mono text-emerald-600 hover:underline">
                            {voucher?.pp_no || 'จ่ายแล้ว'}
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-500">ยังไม่จ่าย</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
      </TableFrame>

      <Modal isOpen={isPayModalOpen} onClose={() => setIsPayModalOpen(false)} title="สร้างใบสำคัญจ่าย" panelClassName="max-w-3xl">
        <div className="space-y-5">
          <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">1. ใบรับสินค้าที่จะจ่าย</h3>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-800">{selectedReceipts[0]?.purchase_orders?.suppliers?.name}</p>
            <ul className="mt-1 space-y-0.5 text-slate-500">
              {selectedReceipts.map((r) => (
                <li key={r.id} className="flex justify-between">
                  <span>
                    {r.ri_no}
                    {r.purchase_orders?.po_no ? <span className="ml-2 text-xs">PO {r.purchase_orders.po_no}</span> : null}
                  </span>
                  <span className="tabular-nums">฿{formatCurrency(receiptAmount(r))}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-800">
              <span>ยอดรวมใบรับสินค้า</span>
              <span className="tabular-nums">฿{formatCurrency(selectedTotal)}</span>
            </div>
          </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">2. เทียบกับใบสั่งซื้อ (PO)</h3>
            {isPayModalOpen && <PayoutPoComparison receiptIds={Array.from(selected)} />}
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
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">หมายเหตุ</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full" />
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="text-sm">
              <p className="text-slate-500">
                ยอดที่จะจ่าย <span className="text-lg font-bold tabular-nums text-slate-900">฿{formatCurrency(selectedTotal)}</span>
              </p>
              {boqCheck.overCount > 0 && (
                <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> เกิน BOQ {boqCheck.overCount} รายการ — ระบุเหตุผลในหัวข้อ 3 ก่อนบันทึก
                </p>
              )}
            </div>
            <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setIsPayModalOpen(false)}>
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

      {detailReceipt && <ReceiptDetailModal receipt={detailReceipt} onClose={() => setDetailReceipt(null)} />}
    </PageContainer>
  )
}
