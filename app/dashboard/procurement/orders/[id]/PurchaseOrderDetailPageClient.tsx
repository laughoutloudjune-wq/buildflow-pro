'use client'

import { useEffect, useState, useTransition, type Ref } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, XCircle, PackageCheck, ChevronDown, Undo2, PackageX, Receipt } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import ReasonDialog from '@/components/ui/ReasonDialog'
import { formatCurrency } from '@/lib/currency'
import PurchaseOrderForm, { type PurchaseOrderFormHandle, type PurchaseOrderFormOptions } from '@/components/procurement/PurchaseOrderForm'
import PurchaseOrderDocActions from '@/components/procurement/PurchaseOrderDocActions'
import GoodsReceiptModal from '@/components/procurement/GoodsReceiptModal'
import BoqCheckPanel from '@/components/procurement/BoqCheckPanel'
import {
  cancelPurchaseOrder,
  closePurchaseOrderShort,
  getGoodsReceiptsForOrder,
  setPurchaseOrderStatus,
  unmarkPurchaseOrderReceived,
} from '@/actions/procurement-actions'
import { getBoqCheckForPurchaseOrder, setPoBoqOverrides } from '@/actions/procurement/boq-control'
import { PO_STATUS_LABEL as STATUS_LABEL, PO_STATUS_TONE as STATUS_TONE } from '@/lib/status-labels'
import type { GoodsReceipt, PurchaseOrder } from '@/lib/types/procurement'

function formatDate(value: string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString('th-TH')
}

export default function PurchaseOrderDetailPageClient({
  fetchedAt,
  id,
  order,
  formOptions,
  initialError,
  onClose,
  onRefresh,
  formRef,
  onFormStateChange,
}: {
  /** From getPurchaseOrderDetailBundle - changes on every real fetch, used
   * to remount PurchaseOrderForm with fresh data after a save instead of it
   * quietly keeping pre-save field values (same pattern as the plot detail
   * modal - see PlotDetailPageClient's fetchedAt). */
  fetchedAt: number
  id: string
  order: PurchaseOrder | null
  formOptions?: PurchaseOrderFormOptions
  initialError?: string | null
  /** Set when rendered inside PurchaseOrderModal instead of as its own page
   * - swaps the "back to list" navigation for just closing the modal. */
  onClose?: () => void
  /** How this page gets fresh data after a save/status change. The
   * standalone page has no server-refetch of its own to call, so it falls
   * back to router.refresh(); PurchaseOrderModal passes its own bundle
   * refetch instead, since router.refresh() only re-runs the page behind
   * the modal, not the modal's independently-fetched data. */
  onRefresh?: () => void
  /** Modal case only: PurchaseOrderModal owns the ref and state (it renders
   * the actual footer via Modal's `footer` slot), threaded down through
   * here to the actual PurchaseOrderForm instance. Both undefined on the
   * standalone page, where the form renders its own fixed bottom bar. */
  formRef?: Ref<PurchaseOrderFormHandle>
  onFormStateChange?: (state: { total: number; isPending: boolean }) => void
}) {
  const router = useRouter()
  const refresh = onRefresh ?? (() => router.refresh())
  const [isPending, startTransition] = useTransition()
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false)
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false)
  const [isCloseShortDialogOpen, setIsCloseShortDialogOpen] = useState(false)
  const [isUnmarkReceivedConfirmOpen, setIsUnmarkReceivedConfirmOpen] = useState(false)
  const toast = useToast()

  const [boqCheck, setBoqCheck] = useState<Awaited<ReturnType<typeof getBoqCheckForPurchaseOrder>> | null>(null)
  const [isBoqCheckSaving, setIsBoqCheckSaving] = useState(false)
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([])

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  // M-13: the PO page never showed which receipts it already has - re-fetch
  // whenever `order` changes (a fresh receive/undo/close-short all push a
  // new `order` reference the same way boqCheck's effect below reacts to).
  useEffect(() => {
    let cancelled = false
    getGoodsReceiptsForOrder(id)
      .then((rows) => {
        if (!cancelled) setReceipts(rows)
      })
      .catch(() => {
        // Non-fatal: the PO still opens and works without the receipts list.
      })
    return () => {
      cancelled = true
    }
  }, [id, order])

  useEffect(() => {
    let cancelled = false
    getBoqCheckForPurchaseOrder(id)
      .then((result) => {
        if (!cancelled) setBoqCheck(result)
      })
      .catch(() => {
        // Non-fatal: the PO still opens and works without the check panel.
      })
    return () => {
      cancelled = true
    }
    // `order` is a fresh object every time the embedded PurchaseOrderForm
    // saves and pushes back to this same route - re-running on its
    // reference change is what keeps this panel from showing stale numbers
    // after an edit, since `id` alone never changes across that navigation.
  }, [id, order])

  async function handleAcknowledgeBoq(overrides: { materialTypeId: number; reason: string }[]) {
    if (!boqCheck) return
    setIsBoqCheckSaving(true)
    try {
      const payload = overrides.map((o) => {
        const line = boqCheck.lines.find((l) => l.materialTypeId === o.materialTypeId)
        return {
          materialTypeId: o.materialTypeId,
          reason: o.reason,
          plannedQuantity: line?.plannedQty ?? 0,
          totalAfterThisPo: line?.totalAfter ?? 0,
        }
      })
      await setPoBoqOverrides(id, payload)
      const refreshed = await getBoqCheckForPurchaseOrder(id)
      setBoqCheck(refreshed)
      toast.success('บันทึกการอนุมัติเกิน BOQ แล้ว')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setIsBoqCheckSaving(false)
    }
  }

  function handleCancel(reason: string) {
    setIsCancelDialogOpen(false)
    startTransition(async () => {
      const result = await cancelPurchaseOrder(id, reason)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      refresh()
      toast.success('ยกเลิกใบสั่งซื้อแล้ว')
    })
  }

  function handleStatusChange(status: 'draft' | 'sent') {
    if (!order || order.status === status) return
    startTransition(async () => {
      const result = await setPurchaseOrderStatus(id, status)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      refresh()
    })
  }

  function handleConfirmUnmarkReceived() {
    setIsUnmarkReceivedConfirmOpen(false)
    startTransition(async () => {
      const result = await unmarkPurchaseOrderReceived(id)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      refresh()
    })
  }

  function handleCloseShort(reason: string) {
    if (!reason.trim()) {
      toast.error('กรุณาระบุเหตุผล')
      return
    }
    setIsCloseShortDialogOpen(false)
    startTransition(async () => {
      const result = await closePurchaseOrderShort(id, reason)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      refresh()
      toast.success('ปิดใบสั่งซื้อแล้ว')
    })
  }

  if (!order) {
    return <div className="py-16 text-center text-slate-400">ไม่พบใบสั่งซื้อนี้</div>
  }

  const canEditStatus = order.status === 'draft' || order.status === 'sent'
  const canCancel = order.status === 'draft' || order.status === 'sent'
  const canReceive = order.status === 'sent' || order.status === 'partially_received'
  const canUnmarkReceived = order.status === 'received' || order.status === 'partially_received'
  const canCloseShort = order.status === 'partially_received'
  const isFormReadOnly = order.status === 'paid' || order.status === 'cancelled'

  const milestones = [
    { label: 'สร้างเมื่อ', value: formatDate(order.created_at) },
    { label: 'ยืนยันเมื่อ', value: formatDate(order.confirmed_at) },
    { label: 'รับของเมื่อ', value: formatDate(order.received_at), by: order.receiver?.full_name },
    { label: 'ชำระเมื่อ', value: formatDate(order.paid_at), by: order.payer?.full_name },
  ].filter((m) => m.value)

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="mb-2 flex w-fit items-center gap-1 text-sm text-slate-500 transition hover:text-indigo-600"
          >
            <ArrowLeft className="h-4 w-4" /> ปิด
          </button>
        ) : (
          <Link
            href="/dashboard/procurement/orders"
            className="mb-2 flex w-fit items-center gap-1 text-sm text-slate-500 transition hover:text-indigo-600"
          >
            <ArrowLeft className="h-4 w-4" /> กลับไปใบสั่งซื้อ
          </Link>
        )}
        <PageHeader
          title={`ใบสั่งซื้อ ${order.po_no}`}
          subtitle={order.projects?.name || '-'}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {canEditStatus ? (
                <div className={`relative inline-flex items-center rounded-full ${STATUS_TONE[order.status]}`}>
                  <select
                    value={order.status}
                    onChange={(e) => handleStatusChange(e.target.value as 'draft' | 'sent')}
                    disabled={isPending}
                    className="appearance-none rounded-full bg-transparent px-3 py-1 pr-7 text-sm font-medium outline-none"
                  >
                    <option value="draft">{STATUS_LABEL.draft}</option>
                    <option value="sent">{STATUS_LABEL.sent}</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5" />
                </div>
              ) : (
                <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_TONE[order.status]}`}>{STATUS_LABEL[order.status]}</span>
              )}

              <PurchaseOrderDocActions orderId={order.id} poNo={order.po_no} />

              {canReceive && (
                <Button type="button" size="sm" onClick={() => setIsReceiveModalOpen(true)}>
                  <PackageCheck className="h-3.5 w-3.5" /> รับของ
                </Button>
              )}
              {canUnmarkReceived && (
                <Button type="button" variant="secondary" size="sm" onClick={() => setIsUnmarkReceivedConfirmOpen(true)} disabled={isPending}>
                  <Undo2 className="h-3.5 w-3.5" /> ยกเลิกการรับของ
                </Button>
              )}
              {canCloseShort && (
                <Button type="button" variant="secondary" size="sm" onClick={() => setIsCloseShortDialogOpen(true)} disabled={isPending}>
                  <PackageX className="h-3.5 w-3.5" /> ปิดใบสั่งซื้อ (ส่งไม่ครบ)
                </Button>
              )}
              {order.status === 'paid' && (
                <Link
                  href="/dashboard/procurement/payments"
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-indigo-600 hover:underline"
                >
                  ดูใบสำคัญจ่าย →
                </Link>
              )}
              {canCancel && (
                <Button type="button" variant="danger" size="sm" onClick={() => setIsCancelDialogOpen(true)} disabled={isPending}>
                  <XCircle className="h-3.5 w-3.5" /> ยกเลิก
                </Button>
              )}
            </div>
          }
        />

        {milestones.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {milestones.map((m) => (
              <span key={m.label} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
                <span className="font-medium text-slate-500">{m.label}</span> {m.value}
                {m.by ? ` โดย ${m.by}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {boqCheck && !boqCheck.isOutsideBoq && boqCheck.lines.length > 0 && (
        <BoqCheckPanel
          lines={boqCheck.lines}
          scopeLabel={boqCheck.scopeLabel}
          existingOverrides={boqCheck.existingOverrides}
          isSaving={isBoqCheckSaving}
          onAcknowledge={isFormReadOnly ? undefined : handleAcknowledgeBoq}
        />
      )}
      {boqCheck?.isOutsideBoq && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          ใบสั่งซื้อนี้ทำเครื่องหมายว่า &quot;ซื้อนอก BOQ&quot; - ไม่นำมาเทียบกับ BOQ
        </div>
      )}

      {receipts.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <Receipt className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-800">ใบรับสินค้า</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">เลขที่</th>
                  <th className="px-4 py-2">วันที่รับ</th>
                  <th className="px-4 py-2">เลขที่ใบส่งของ</th>
                  <th className="px-4 py-2 text-right">มูลค่า</th>
                  <th className="px-4 py-2">สถานะจ่าย</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {receipts.map((r) => {
                  const amount = (r.goods_receipt_items || []).reduce(
                    (sum, item) => sum + item.quantity_received * item.unit_price_at_receipt,
                    0
                  )
                  const paidAmount = (r.payment_voucher_receipts || []).reduce((sum, pv) => sum + pv.amount, 0)
                  const isPaid = (r.payment_voucher_receipts || []).length > 0
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2 font-medium text-slate-700">{r.ri_no}</td>
                      <td className="px-4 py-2 text-slate-500">{formatDate(r.received_at)}</td>
                      <td className="px-4 py-2 text-slate-500">{r.delivery_note_no || '-'}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700">
                        ฿{formatCurrency(isPaid ? paidAmount : amount)}
                      </td>
                      <td className="px-4 py-2">
                        {isPaid ? <Badge tone="success">จ่ายแล้ว</Badge> : <Badge tone="neutral">ยังไม่จ่าย</Badge>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <PurchaseOrderForm
        key={fetchedAt}
        ref={formRef}
        mode="edit"
        orderId={id}
        initialOrder={order}
        initialOptions={formOptions}
        readOnly={isFormReadOnly}
        onSaved={onClose ? refresh : undefined}
        onClose={onClose}
        onStateChange={onFormStateChange}
      />

      <GoodsReceiptModal
        isOpen={isReceiveModalOpen}
        onClose={() => setIsReceiveModalOpen(false)}
        order={order}
        onSuccess={async () => {
          refresh()
          toast.success('บันทึกการรับของแล้ว')
        }}
      />

      <ReasonDialog
        isOpen={isCancelDialogOpen}
        title="ยกเลิกใบสั่งซื้อ"
        label="เหตุผลที่ยกเลิก"
        confirmLabel="ยกเลิกใบสั่งซื้อ"
        busy={isPending}
        onCancel={() => setIsCancelDialogOpen(false)}
        onConfirm={handleCancel}
      />

      <ReasonDialog
        isOpen={isCloseShortDialogOpen}
        title="ปิดใบสั่งซื้อ (ส่งไม่ครบ)"
        label="เหตุผลที่ปิดใบสั่งซื้อทั้งที่ส่งไม่ครบ"
        required
        confirmLabel="ปิดใบสั่งซื้อ"
        busy={isPending}
        onCancel={() => setIsCloseShortDialogOpen(false)}
        onConfirm={handleCloseShort}
      />

      <ConfirmDialog
        isOpen={isUnmarkReceivedConfirmOpen}
        title="ยกเลิกการรับของ"
        message="ยกเลิกการรับของทั้งหมดของใบสั่งซื้อนี้? จำนวนที่รับจะกลับเป็น 0 ทุกรายการ ใบรับสินค้าที่บันทึกไว้จะถูกลบ และสต็อกที่เพิ่มไปจะถูกดึงกลับ - ใช้เมื่อบันทึกวันที่หรือจำนวนผิด แล้วต้องการรับของใหม่ให้ถูกต้อง"
        confirmLabel={isPending ? 'กำลังยกเลิก...' : 'ยกเลิกการรับของ'}
        cancelLabel="ยกเลิก"
        tone="danger"
        busy={isPending}
        onCancel={() => setIsUnmarkReceivedConfirmOpen(false)}
        onConfirm={handleConfirmUnmarkReceived}
      />
    </div>
  )
}
