'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Search, Undo2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import { voidPaymentVoucher } from '@/actions/procurement-actions'
import type { PaymentMethod, PaymentVoucher } from '@/lib/types/procurement'

const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'เงินสด',
  bank_transfer: 'เงินโอน',
  director_loan: 'เงินกู้ยืมกรรมการ',
}

export default function PaymentsPageClient({
  vouchers,
  initialError,
}: {
  vouchers: PaymentVoucher[]
  initialError?: string | null
}) {
  const router = useRouter()
  const toast = useToast()

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  const [search, setSearch] = useState('')
  const [voidingId, setVoidingId] = useState<string | null>(null)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return vouchers
    return vouchers.filter((v) => {
      const ris = (v.payment_voucher_receipts || []).map((r) => r.goods_receipts?.ri_no || '').join(' ')
      const haystack = `${v.pp_no} ${v.suppliers?.name || ''} ${v.companies?.name || ''} ${ris}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [vouchers, search])

  const grandTotal = useMemo(() => rows.reduce((sum, v) => sum + v.total_amount, 0), [rows])

  function handleVoid(v: PaymentVoucher) {
    if (!confirm(`ยกเลิกใบสำคัญจ่าย ${v.pp_no}? ใบรับสินค้าที่รวมอยู่จะกลับเป็นสถานะยังไม่จ่าย และ PO จะย้อนกลับเป็นรับของแล้ว`)) return
    setVoidingId(v.id)
    voidPaymentVoucher(v.id)
      .then(() => {
        router.refresh()
        toast.success('ยกเลิกใบสำคัญจ่ายแล้ว')
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'ยกเลิกใบสำคัญจ่ายไม่สำเร็จ'))
      .finally(() => setVoidingId(null))
  }

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6">
      <PageHeader
        title="ใบสำคัญจ่าย (Payment Vouchers)"
        subtitle="การจ่ายเงินให้ผู้จำหน่าย แต่ละใบอาจรวมหลายใบรับสินค้า (RI) ของผู้จำหน่ายเดียวกัน"
      />

      <Card className="border-slate-200 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9"
            placeholder="ค้นหาเลขที่ PP / RI / ผู้จำหน่าย / บริษัท"
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm">
          <span className="text-slate-500">
            ผลลัพธ์ <span className="font-semibold text-slate-700">{rows.length}</span> รายการ
          </span>
          <span className="text-slate-500">
            ยอดรวมทั้งหมด: <span className="font-semibold text-slate-800">฿{formatCurrency(grandTotal)}</span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">เลขที่ PP</th>
                <th className="px-4 py-3">วันที่</th>
                <th className="px-4 py-3">ผู้จำหน่าย</th>
                <th className="px-4 py-3">บริษัทผู้ซื้อ</th>
                <th className="px-4 py-3">รูปแบบ</th>
                <th className="px-4 py-3">ใบรับสินค้า</th>
                <th className="px-4 py-3 text-right">ยอดสุทธิ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center italic text-slate-400">
                    ยังไม่มีใบสำคัญจ่าย
                  </td>
                </tr>
              ) : (
                rows.map((v) => {
                  const ris = v.payment_voucher_receipts || []
                  return (
                    <tr key={v.id} className="transition-colors hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono font-medium text-slate-800">{v.pp_no}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{new Date(v.payment_date).toLocaleDateString('th-TH')}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{v.suppliers?.name || '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{v.companies?.name || '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{PAYMENT_METHOD_LABEL[v.payment_method]}</td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-slate-500">
                        {ris[0]?.goods_receipts?.ri_no || '-'}
                        {ris.length > 1 && <span className="ml-1 text-xs text-slate-400">+{ris.length - 1}</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">฿{formatCurrency(v.total_amount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Button type="button" variant="secondary" size="sm" onClick={() => handleVoid(v)} disabled={voidingId === v.id}>
                          {voidingId === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} ยกเลิก
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
