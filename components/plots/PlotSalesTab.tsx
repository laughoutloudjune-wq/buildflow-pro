'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import PlotPaymentsSection from '@/components/plots/PlotPaymentsSection'
import {
  changeSaleStatus,
  createCustomerForSale,
  updateCustomer,
  updatePlotSaleDetails,
  type PlotSaleDetail,
  type SaleStatus,
} from '@/actions/sales-actions'
import type { SalePaymentRow } from '@/actions/sale-payments-actions'
import type { Promotion } from '@/actions/promotions-actions'

const PRICE_FIELDS: { key: string; label: string }[] = [
  { key: 'list_price', label: 'ราคาตั้ง' },
  { key: 'sale_price', label: 'ราคาขายจริง' },
]
const PAYMENT_FIELDS: { key: string; label: string }[] = [
  { key: 'booking_amount', label: 'เงินจอง' },
  { key: 'contract_amount', label: 'เงินทำสัญญา' },
  { key: 'down_total', label: 'ยอดผ่อนดาวน์รวม' },
]
const DATE_FIELDS: { key: string; label: string }[] = [
  { key: 'booked_at', label: 'วันจอง' },
  { key: 'contract_at', label: 'วันทำสัญญา' },
  { key: 'loan_submitted_at', label: 'วันยื่นกู้' },
  { key: 'loan_approved_at', label: 'วันอนุมัติสินเชื่อ' },
  { key: 'inspection_at', label: 'วันนัดตรวจบ้าน' },
  { key: 'transfer_at', label: 'วันโอนกรรมสิทธิ์' },
  { key: 'delivered_at', label: 'วันส่งมอบ' },
]

export default function PlotSalesTab({
  plotId,
  saleDetail,
  saleStatuses,
  promotions,
  payments,
  canEdit,
  onRefresh,
}: {
  plotId: string
  projectId: string
  saleDetail: PlotSaleDetail
  saleStatuses: SaleStatus[]
  promotions: Promotion[]
  payments: SalePaymentRow[]
  canEdit: boolean
  onRefresh: () => void
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [statusNote, setStatusNote] = useState('')
  // The parent remounts this component (via `key`) whenever onRefresh runs,
  // so this only needs to read the prop once - no need to sync it against
  // prop changes here.
  const [pendingStatus, setPendingStatus] = useState(saleDetail.sale?.statusCode || '')

  function handleChangeStatus() {
    if (!statusNote.trim()) {
      toast.error('กรุณาระบุหมายเหตุการเปลี่ยนสถานะ')
      return
    }
    startTransition(async () => {
      const res = await changeSaleStatus({ plotId, statusCode: pendingStatus, note: statusNote })
      if (!res.success) {
        toast.error(res.error || 'เปลี่ยนสถานะไม่สำเร็จ')
        return
      }
      toast.success('เปลี่ยนสถานะแล้ว')
      setStatusNote('')
      onRefresh()
    })
  }

  function handleStartSale(formData: FormData) {
    startTransition(async () => {
      const res = await changeSaleStatus({
        plotId,
        statusCode: String(formData.get('status_code') || 'reserved'),
        customerName: String(formData.get('customer_name') || ''),
        customerPhone: String(formData.get('customer_phone') || ''),
        note: String(formData.get('note') || 'เริ่มบันทึกการขาย'),
      })
      if (!res.success) {
        toast.error(res.error || 'บันทึกไม่สำเร็จ')
        return
      }
      toast.success('เริ่มบันทึกการขายแล้ว')
      onRefresh()
    })
  }

  function handleSaveDetails(formData: FormData) {
    if (!saleDetail.sale) return
    startTransition(async () => {
      const res = await updatePlotSaleDetails(saleDetail.sale!.id, formData)
      if (!res.success) {
        toast.error(res.error || 'บันทึกไม่สำเร็จ')
        return
      }
      toast.success('บันทึกข้อมูลการขายแล้ว')
      onRefresh()
    })
  }

  function handleSaveCustomer(formData: FormData) {
    if (!saleDetail.customer) return
    startTransition(async () => {
      const res = await updateCustomer(saleDetail.customer!.id, formData)
      if (!res.success) {
        toast.error(res.error || 'บันทึกไม่สำเร็จ')
        return
      }
      toast.success('บันทึกข้อมูลลูกค้าแล้ว')
      onRefresh()
    })
  }

  // Only reachable when a deal already exists but has no customer attached
  // yet (e.g. its status was set directly rather than through the "start
  // sale" flow, which is otherwise the only place a customer gets created).
  function handleAddCustomer(formData: FormData) {
    if (!saleDetail.sale) return
    startTransition(async () => {
      const res = await createCustomerForSale(saleDetail.sale!.id, formData)
      if (!res.success) {
        toast.error(res.error || 'บันทึกไม่สำเร็จ')
        return
      }
      toast.success('เพิ่มข้อมูลลูกค้าแล้ว')
      onRefresh()
    })
  }

  if (!saleDetail.sale) {
    if (!canEdit) {
      return <Card className="p-8 text-center text-slate-400">ยังไม่มีข้อมูลการขายสำหรับแปลงนี้</Card>
    }
    return (
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700">เริ่มบันทึกการขาย</h3>
        <form action={handleStartSale} className="mt-3 space-y-3">
          <select name="status_code" required defaultValue="reserved" className="w-full">
            {saleStatuses.map((s) => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input name="customer_name" placeholder="ชื่อลูกค้า" className="w-full" />
            <input name="customer_phone" placeholder="เบอร์โทร" className="w-full" />
          </div>
          <textarea name="note" rows={2} className="w-full" placeholder="บันทึก เช่น ลูกค้าจองผ่านหน้างาน" />
          <Button type="submit" disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            บันทึก
          </Button>
        </form>
      </Card>
    )
  }

  const sale = saleDetail.sale
  const customer = saleDetail.customer

  // The deal's own promotion may since have been deactivated (removed from
  // `promotions`, the active-only list) - inject it as a synthetic option so
  // the picker still shows its name instead of falling back to a blank box,
  // same fix as the deactivated-material picker in PurchaseOrderForm.
  const promotionOptions =
    sale.promotionId && !promotions.some((p) => p.id === sale.promotionId)
      ? [
          {
            id: sale.promotionId,
            name: `${sale.promotionName || 'โปรโมชั่น'} - ปิดใช้งานแล้ว`,
            description: null,
            discountType: sale.promotionDiscountType || 'amount',
            discountValue: sale.promotionDiscountValue || 0,
            isActive: false,
          },
          ...promotions,
        ]
      : promotions

  function promotionLabel(p: Promotion) {
    const discount = p.discountType === 'percent' ? `ลด ${p.discountValue}%` : `ลด ${formatCurrency(p.discountValue)} บาท`
    return `${p.name} (${discount})`
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700">เปลี่ยนสถานะ</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <label className="mb-1 block text-xs font-medium text-slate-500">สถานะ</label>
            <select
              value={pendingStatus}
              onChange={(e) => setPendingStatus(e.target.value)}
              disabled={!canEdit}
              className="w-full"
            >
              {saleStatuses.map((s) => (
                <option key={s.code} value={s.code}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[260px] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">หมายเหตุ (บังคับ)</label>
            <input value={statusNote} onChange={(e) => setStatusNote(e.target.value)} disabled={!canEdit} className="w-full" />
          </div>
          {canEdit && (
            <Button type="button" onClick={handleChangeStatus} disabled={isPending || pendingStatus === sale.statusCode && !statusNote}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              บันทึกสถานะ
            </Button>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700">ข้อมูลลูกค้า</h3>
        {customer ? (
          <form action={handleSaveCustomer} className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">ชื่อ-สกุล</label>
              <input name="full_name" required defaultValue={customer.fullName} disabled={!canEdit} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">เบอร์โทร</label>
              <input name="phone" defaultValue={customer.phone ?? ''} disabled={!canEdit} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">อีเมล</label>
              <input name="email" defaultValue={customer.email ?? ''} disabled={!canEdit} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">เลขบัตรประชาชน</label>
              <input name="id_card" defaultValue={customer.idCard ?? ''} disabled={!canEdit} className="w-full" />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-500">ที่อยู่</label>
              <input name="address" defaultValue={customer.address ?? ''} disabled={!canEdit} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">ช่องทางที่รู้จัก</label>
              <input name="lead_source" defaultValue={customer.leadSource ?? ''} disabled={!canEdit} placeholder="เช่น ป้าย, Facebook, นายหน้า" className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">หมายเหตุลูกค้า</label>
              <input name="note" defaultValue={customer.note ?? ''} disabled={!canEdit} className="w-full" />
            </div>
            {canEdit && (
              <div className="col-span-2 flex justify-end pt-2">
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  บันทึกข้อมูลลูกค้า
                </Button>
              </div>
            )}
          </form>
        ) : canEdit ? (
          <form action={handleAddCustomer} className="mt-3 grid grid-cols-2 gap-3">
            <p className="col-span-2 -mt-1 mb-1 text-xs text-slate-400">ดีลนี้ยังไม่มีข้อมูลลูกค้า - กรอกเพื่อเพิ่ม</p>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">ชื่อ-สกุล</label>
              <input name="full_name" required className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">เบอร์โทร</label>
              <input name="phone" className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">อีเมล</label>
              <input name="email" className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">เลขบัตรประชาชน</label>
              <input name="id_card" className="w-full" />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-500">ที่อยู่</label>
              <input name="address" className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">ช่องทางที่รู้จัก</label>
              <input name="lead_source" placeholder="เช่น ป้าย, Facebook, นายหน้า" className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">หมายเหตุลูกค้า</label>
              <input name="note" className="w-full" />
            </div>
            <div className="col-span-2 flex justify-end pt-2">
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                เพิ่มข้อมูลลูกค้า
              </Button>
            </div>
          </form>
        ) : (
          <p className="mt-2 text-sm text-slate-400">ยังไม่มีข้อมูลลูกค้าผูกกับดีลนี้</p>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700">ราคาและวันที่สำคัญ</h3>
        <form action={handleSaveDetails} className="mt-4 space-y-6">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">ราคา</p>
            <div className="grid grid-cols-2 gap-3">
              {PRICE_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-xs font-medium text-slate-500">{f.label}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    name={f.key}
                    defaultValue={(sale as unknown as Record<string, number | null>)[toCamel(f.key)] ?? ''}
                    disabled={!canEdit}
                    className="w-full"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">เงินที่ต้องชำระ</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {PAYMENT_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-xs font-medium text-slate-500">{f.label}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    name={f.key}
                    defaultValue={(sale as unknown as Record<string, number | null>)[toCamel(f.key)] ?? ''}
                    disabled={!canEdit}
                    className="w-full"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">สินเชื่อ</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">วงเงินกู้</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  name="loan_amount"
                  defaultValue={sale.loanAmount ?? ''}
                  disabled={!canEdit}
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">ธนาคารที่ยื่นกู้</label>
                <input name="loan_bank" defaultValue={sale.loanBank ?? ''} disabled={!canEdit} className="w-full" />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">โปรโมชั่นและส่วนลด</p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">โปรโมชั่น</label>
                <select name="promotion_id" defaultValue={sale.promotionId ?? ''} disabled={!canEdit} className="w-full">
                  <option value="">ไม่มีโปรโมชั่น</option>
                  {promotionOptions.map((p) => (
                    <option key={p.id} value={p.id}>{promotionLabel(p)}</option>
                  ))}
                </select>
                {sale.promotionName && (
                  <p className="mt-1 text-xs text-slate-400">
                    เงื่อนไข: {promotions.find((p) => p.id === sale.promotionId)?.description || 'ไม่มีรายละเอียดเพิ่มเติม'}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">ส่วนลด / ของแถม (เพิ่มเติม)</label>
                <input name="discount_note" defaultValue={sale.discountNote ?? ''} disabled={!canEdit} className="w-full" />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">ไทม์ไลน์สำคัญ</p>
            <div className="space-y-3">
              {DATE_FIELDS.map((f) => {
                const value = (sale as unknown as Record<string, string | null>)[toCamel(f.key)] ?? ''
                const reached = Boolean(value)
                return (
                  <div key={f.key} className={`relative flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 py-0.5 pl-4 ${reached ? 'border-indigo-200' : 'border-slate-100'}`}>
                    <span className={`absolute -left-[7px] h-3 w-3 rounded-full ring-4 ring-white ${reached ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                    <label className="w-36 shrink-0 text-sm text-slate-600">{f.label}</label>
                    <input
                      type="date"
                      name={f.key}
                      defaultValue={value}
                      disabled={!canEdit}
                      className="w-full sm:w-auto"
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">หมายเหตุดีล</label>
            <textarea name="note" rows={2} defaultValue={sale.note ?? ''} disabled={!canEdit} className="w-full" />
          </div>
          {canEdit && (
            <div className="flex justify-end border-t border-slate-100 pt-3">
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                บันทึก
              </Button>
            </div>
          )}
        </form>
      </Card>

      <PlotPaymentsSection
        plotSaleId={sale.id}
        payments={payments}
        downTotal={sale.downTotal}
        contractAt={sale.contractAt}
        canEdit={canEdit}
        onRefresh={onRefresh}
      />
    </div>
  )
}

function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}
