'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Search, Wallet } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import { createPaymentVoucher } from '@/actions/procurement-actions'
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

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isPayModalOpen, setIsPayModalOpen] = useState(false)
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [isSaving, setIsSaving] = useState(false)

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

  function handleCreatePayment() {
    if (selectedReceipts.length === 0 || !selectedSupplierId) return
    const companyId = selectedReceipts[0].purchase_orders?.company_id
    if (!companyId) {
      toast.error('ไม่พบบริษัทผู้ซื้อของใบรับสินค้าที่เลือก')
      return
    }
    setIsSaving(true)
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
    <div className="mx-auto max-w-screen-2xl space-y-6">
      <PageHeader
        title="ใบรับสินค้า (Goods Receipts)"
        subtitle="ทุกครั้งที่รับของจาก PO จะสร้างใบรับสินค้า (RI) - เลือกใบที่ยังไม่จ่ายเพื่อสร้างใบสำคัญจ่าย"
      />

      <Card className="border-slate-200 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9"
            placeholder="ค้นหาเลขที่ RI / PO / ผู้จำหน่าย / วัสดุ"
          />
        </div>
      </Card>

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

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm">
          <span className="text-slate-500">
            ผลลัพธ์ <span className="font-semibold text-slate-700">{rows.length}</span> รายการ
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
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
                  <td colSpan={8} className="px-4 py-8 text-center italic text-slate-400">
                    ยังไม่มีใบรับสินค้า
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
                      <td className="whitespace-nowrap px-4 py-3 font-mono font-medium text-slate-800">{r.ri_no}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{new Date(r.received_at).toLocaleDateString('th-TH')}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link href={`/dashboard/procurement/orders/${r.purchase_order_id}`} className="font-mono text-indigo-600 hover:underline">
                          {r.purchase_orders?.po_no || '-'}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{r.purchase_orders?.suppliers?.name || '-'}</td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-slate-500">
                        {label}
                        {extra > 0 && <span className="ml-1 text-xs text-slate-400">+{extra}</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">฿{formatCurrency(receiptAmount(r))}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {paid ? (
                          <Link href="/dashboard/procurement/payments" className="font-mono text-emerald-600 hover:underline">
                            {voucher?.pp_no || 'จ่ายแล้ว'}
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400">ยังไม่จ่าย</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal isOpen={isPayModalOpen} onClose={() => setIsPayModalOpen(false)} title="สร้างใบสำคัญจ่าย" panelClassName="max-w-lg">
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-700">{selectedReceipts[0]?.purchase_orders?.suppliers?.name}</p>
            <ul className="mt-1 space-y-0.5 text-slate-500">
              {selectedReceipts.map((r) => (
                <li key={r.id} className="flex justify-between">
                  <span>{r.ri_no}</span>
                  <span>฿{formatCurrency(receiptAmount(r))}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-800">
              <span>ยอดรวม</span>
              <span>฿{formatCurrency(selectedTotal)}</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">วันที่จ่าย</label>
            <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">รูปแบบการชำระเงิน</label>
            <div className="space-y-1.5">
              {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="radio" name="payment_method" checked={paymentMethod === m} onChange={() => setPaymentMethod(m)} />
                  {PAYMENT_METHOD_LABEL[m]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">หมายเหตุ</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setIsPayModalOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="button" size="sm" onClick={handleCreatePayment} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'บันทึกการจ่ายเงิน'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
