'use client'

import { useEffect, useState, useTransition, type Ref } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, XCircle, PackageCheck, ChevronDown, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import PurchaseOrderForm, { type PurchaseOrderFormHandle, type PurchaseOrderFormOptions } from '@/components/procurement/PurchaseOrderForm'
import PurchaseOrderDocActions from '@/components/procurement/PurchaseOrderDocActions'
import GoodsReceiptModal from '@/components/procurement/GoodsReceiptModal'
import BoqCheckPanel from '@/components/procurement/BoqCheckPanel'
import { cancelPurchaseOrder, setPurchaseOrderStatus, unmarkPurchaseOrderReceived } from '@/actions/procurement-actions'
import { getBoqCheckForPurchaseOrder, setPoBoqOverrides } from '@/actions/procurement/boq-control'
import type { PurchaseOrder, PurchaseOrderStatus } from '@/lib/types/procurement'

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'ร่าง',
  sent: 'ยืนยันสั่งซื้อ',
  partially_received: 'รับของบางส่วน',
  received: 'รับของแล้ว',
  paid: 'ชำระแล้ว',
  cancelled: 'ยกเลิก',
}

const STATUS_TONE: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-slate-100 text-slate-500',
  sent: 'bg-indigo-50 text-indigo-700',
  partially_received: 'bg-amber-50 text-amber-700',
  received: 'bg-emerald-50 text-emerald-700',
  paid: 'bg-violet-50 text-violet-700',
  cancelled: 'bg-red-50 text-red-700',
}

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
  const toast = useToast()

  const [boqCheck, setBoqCheck] = useState<Awaited<ReturnType<typeof getBoqCheckForPurchaseOrder>> | null>(null)
  const [isBoqCheckSaving, setIsBoqCheckSaving] = useState(false)

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

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

  function handleCancel() {
    const reason = prompt('เหตุผลที่ยกเลิก:')
    if (reason === null) return
    startTransition(async () => {
      try {
        await cancelPurchaseOrder(id, reason)
        refresh()
        toast.success('ยกเลิกใบสั่งซื้อแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ยกเลิกไม่สำเร็จ')
      }
    })
  }

  function handleStatusChange(status: 'draft' | 'sent') {
    if (!order || order.status === status) return
    startTransition(async () => {
      try {
        await setPurchaseOrderStatus(id, status)
        refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'เปลี่ยนสถานะไม่สำเร็จ')
      }
    })
  }

  function handleUnmarkReceived() {
    if (!confirm('ยกเลิกการรับของ และย้อนกลับไปสถานะยืนยันสั่งซื้อ?')) return
    startTransition(async () => {
      try {
        await unmarkPurchaseOrderReceived(id)
        refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ยกเลิกการรับของไม่สำเร็จ')
      }
    })
  }

  if (!order) {
    return <div className="py-16 text-center text-slate-400">ไม่พบใบสั่งซื้อนี้</div>
  }

  const canEditStatus = order.status === 'draft' || order.status === 'sent'
  const canCancel = order.status === 'draft' || order.status === 'sent'
  const canReceive = order.status === 'sent' || order.status === 'partially_received'
  const canUnmarkReceived = order.status === 'received'
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
                <Button type="button" variant="secondary" size="sm" onClick={handleUnmarkReceived} disabled={isPending}>
                  <Undo2 className="h-3.5 w-3.5" /> ยกเลิกการรับของ
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
                <Button type="button" variant="danger" size="sm" onClick={handleCancel} disabled={isPending}>
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
    </div>
  )
}
