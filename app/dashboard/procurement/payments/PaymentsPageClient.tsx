'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { PageToolbar } from '@/components/ui/PageToolbar'
import { TableFrame } from '@/components/ui/TableFrame'
import { EmptyState } from '@/components/ui/EmptyState'
import ReasonDialog from '@/components/ui/ReasonDialog'
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
  const [voidTarget, setVoidTarget] = useState<PaymentVoucher | null>(null)

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

  function handleConfirmVoid(reason: string) {
    if (!voidTarget) return
    const v = voidTarget
    setVoidingId(v.id)
    voidPaymentVoucher(v.id, reason)
      .then((result) => {
        if ('error' in result) {
          toast.error(result.error)
          return
        }
        setVoidTarget(null)
        router.refresh()
        toast.success('ยกเลิกใบสำคัญจ่ายแล้ว')
      })
      .finally(() => setVoidingId(null))
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="ใบสำคัญจ่าย (PP)"
        subtitle="การจ่ายเงินให้ผู้จำหน่าย แต่ละใบอาจรวมหลายใบรับสินค้า (RI) ของผู้จำหน่ายเดียวกัน"
      />

      <PageToolbar
        search={{ value: search, onChange: setSearch, placeholder: 'ค้นหาเลขที่ PP / RI / ผู้จำหน่าย / บริษัท' }}
        activeFilters={search.trim() ? [{ label: `ค้นหา "${search.trim()}"`, onRemove: () => setSearch('') }] : []}
        onReset={() => setSearch('')}
      />

      <TableFrame>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm">
          <span className="text-slate-500">
            ผลลัพธ์ <span className="font-semibold text-slate-700">{rows.length}</span> รายการ
          </span>
          <span className="text-slate-500">
            ยอดรวมทั้งหมด: <span className="font-semibold text-slate-800">฿{formatCurrency(grandTotal)}</span>
          </span>
        </div>
          <table>
            <thead>
              <tr>
                <th className="px-4 py-3">เลขที่ PP</th>
                <th className="px-4 py-3">วันที่</th>
                <th className="px-4 py-3">ผู้จำหน่าย</th>
                <th className="hidden px-4 py-3 xl:table-cell">บริษัทผู้ซื้อ</th>
                <th className="hidden px-4 py-3 lg:table-cell">วิธีจ่าย</th>
                <th className="hidden px-4 py-3 md:table-cell">ใบรับสินค้า</th>
                <th className="px-4 py-3 text-right">ยอดสุทธิ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState
                      variant={search.trim() ? 'no-results' : 'empty'}
                      title={search.trim() ? 'ไม่พบใบสำคัญจ่ายตามคำค้นหา' : 'ยังไม่มีใบสำคัญจ่าย'}
                      description={search.trim() ? 'ลองเปลี่ยนคำค้นหา' : 'สร้างใบสำคัญจ่ายจากหน้าใบรับสินค้า (RI)'}
                    />
                  </td>
                </tr>
              ) : (
                rows.map((v) => {
                  const ris = v.payment_voucher_receipts || []
                  return (
                    <tr key={v.id} className="transition-colors hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono font-medium">
                        {v.pp_no}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{new Date(v.payment_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                      <td className="max-w-[12rem] truncate px-4 py-3 text-slate-700" title={v.suppliers?.name || ''}>{v.suppliers?.name || '-'}</td>
                      <td className="hidden max-w-[10rem] truncate px-4 py-3 text-slate-500 xl:table-cell" title={v.companies?.name || ''}>{v.companies?.name || '-'}</td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-slate-500 lg:table-cell">{PAYMENT_METHOD_LABEL[v.payment_method] || '-'}</td>
                      <td className="hidden px-4 py-3 text-slate-500 md:table-cell">
                        {ris.slice(0, 2).map((x) => x.goods_receipts?.ri_no).filter(Boolean).join(', ') || '-'}
                        {ris.length > 2 && <span className="ml-1 text-xs text-slate-500">+{ris.length - 2}</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">฿{formatCurrency(v.total_amount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Button type="button" variant="secondary" size="sm" onClick={() => setVoidTarget(v)} disabled={voidingId === v.id}>
                          {voidingId === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} ยกเลิก
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
      </TableFrame>

      <ReasonDialog
        isOpen={voidTarget !== null}
        title="ยกเลิกใบสำคัญจ่าย"
        message={voidTarget ? `ยกเลิกใบสำคัญจ่าย ${voidTarget.pp_no}? ใบรับสินค้าที่รวมอยู่จะกลับเป็นสถานะยังไม่จ่าย และ PO จะย้อนกลับเป็นรับของแล้ว ระบบเก็บสำเนาใบสำคัญจ่ายไว้ในประวัติเอกสาร` : ''}
        label="เหตุผลที่ยกเลิก"
        required
        confirmLabel={voidingId ? 'กำลังยกเลิก...' : 'ยกเลิกใบสำคัญจ่าย'}
        cancelLabel="ปิด"
        busy={voidingId !== null}
        onCancel={() => setVoidTarget(null)}
        onConfirm={handleConfirmVoid}
      />
    </PageContainer>
  )
}
