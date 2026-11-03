'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Wallet } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { PageToolbar } from '@/components/ui/PageToolbar'
import { TableFrame } from '@/components/ui/TableFrame'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import PaymentVoucherModal from '@/components/procurement/PaymentVoucherModal'
import ReceiptDetailModal from '@/components/procurement/ReceiptDetailModal'
import type { GoodsReceipt } from '@/lib/types/procurement'

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
  const [paidFilter, setPaidFilter] = useState<'all' | 'unpaid' | 'paid'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailReceipt, setDetailReceipt] = useState<GoodsReceipt | null>(null)
  const [isPayModalOpen, setIsPayModalOpen] = useState(false)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const byPaid = receipts.filter((r) => (paidFilter === 'all' ? true : paidFilter === 'paid' ? isPaid(r) : !isPaid(r)))
    if (!q) return byPaid
    return byPaid.filter((r) => {
      const materials = (r.goods_receipt_items || []).map((i) => i.purchase_order_items?.material_types?.name || '').join(' ')
      const haystack = `${r.ri_no} ${r.purchase_orders?.po_no || ''} ${r.purchase_orders?.suppliers?.name || ''} ${materials}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [receipts, search, paidFilter])

  const selectedReceipts = useMemo(() => receipts.filter((r) => selected.has(r.id)), [receipts, selected])
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

  return (
    <PageContainer width="wide">
      <PageHeader
        title="ใบรับสินค้า (RI)"
        subtitle="ทุกครั้งที่รับของจาก PO จะสร้างใบรับสินค้า (RI) - เลือกใบที่ยังไม่จ่ายเพื่อสร้างใบสำคัญจ่าย"
      />

      <div className="flex gap-2 text-sm" role="group" aria-label="สถานะการจ่าย">
        {([['all', 'ทั้งหมด'], ['unpaid', 'รอจ่าย'], ['paid', 'จ่ายแล้ว']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPaidFilter(key)}
            className={`rounded-full px-3 py-1.5 ${paidFilter === key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

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
                <th className="px-4 py-3">เลขที่ RI / PO</th>
                <th className="px-4 py-3">วันที่</th>
                <th className="px-4 py-3">ผู้จำหน่าย</th>
                <th className="hidden px-4 py-3 md:table-cell">วัสดุ</th>
                <th className="px-4 py-3 text-right">ยอดสุทธิ</th>
                <th className="px-4 py-3">ใบสำคัญจ่าย</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-0">
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
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/procurement/work?open=RI:${r.id}`} className="break-all font-mono font-medium text-indigo-600 hover:underline">
                          {r.ri_no}
                        </Link>
                        <Link href={`/dashboard/procurement/work?open=PO:${r.purchase_order_id}`} className="block break-all font-mono text-xs text-slate-500 hover:underline">
                          {r.purchase_orders?.po_no || '-'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{new Date(r.received_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                      <td className="px-4 py-3 text-slate-700">{r.purchase_orders?.suppliers?.name || '-'}</td>
                      <td className="hidden px-4 py-3 text-slate-500 md:table-cell">
                        <span className="line-clamp-2">{label}</span>
                        {extra > 0 && <span className="text-xs text-slate-500">+{extra} รายการ</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">฿{formatCurrency(receiptAmount(r))}</td>
                      <td className="px-4 py-3">
                        {paid ? (
                          <Link href={`/dashboard/procurement/work?open=PP:${r.payment_voucher_receipts?.[0]?.payment_voucher_id ?? ''}`} className="font-mono text-emerald-600 hover:underline">
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

      {isPayModalOpen && (
        <PaymentVoucherModal
          receipts={selectedReceipts}
          onClose={() => setIsPayModalOpen(false)}
          onCreated={() => {
            setSelected(new Set())
            setIsPayModalOpen(false)
            router.refresh()
          }}
        />
      )}

      {detailReceipt && <ReceiptDetailModal receipt={detailReceipt} onClose={() => setDetailReceipt(null)} />}
    </PageContainer>
  )
}
