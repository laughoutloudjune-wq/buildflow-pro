'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ListChecks, Loader2, PackageCheck, Pencil, ShoppingCart, Undo2, XCircle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import {
  approvePurchaseRequest,
  rejectPurchaseRequest,
  undoPurchaseRequestItemSettlement,
} from '@/actions/procurement-actions'
import PurchaseRequestDocActions from '@/components/procurement/PurchaseRequestDocActions'
import PurchaseRequestForm from '@/components/procurement/PurchaseRequestForm'
import PurchaseRequestSettleModal from '@/components/procurement/PurchaseRequestSettleModal'
import type { PurchaseRequest, PurchaseRequestItem, PurchaseRequestStatus } from '@/lib/types/procurement'

const DAY_MS = 24 * 60 * 60 * 1000

export const PR_STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  pending_review: 'รอตรวจสอบ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ปฏิเสธ',
  ordered: 'สั่งซื้อแล้ว',
  received: 'รับของครบ',
  cancelled: 'ยกเลิก',
}

export const PR_STATUS_TONE: Record<PurchaseRequestStatus, string> = {
  pending_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-indigo-50 text-indigo-700',
  rejected: 'bg-red-50 text-red-700',
  ordered: 'bg-violet-50 text-violet-700',
  received: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
}

/** The whole request can't be ordered faster than its slowest-lead-time
 * line, since procurement places one order per request - so the request
 * level "when must we order" is the max across its still-outstanding items
 * (a line already fully covered by an earlier PO doesn't need ordering
 * again, so it shouldn't hold the "order by" date hostage). Null when
 * nothing outstanding has a lead time set yet. */
function maxLeadTimeDays(request: PurchaseRequest): number | null {
  const values = (request.purchase_request_items || [])
    .filter((item) => item.quantity_requested > 0)
    .map((item) => item.material_types?.lead_time_days)
    .filter((v): v is number => v != null)
  return values.length > 0 ? Math.max(...values) : null
}

function orderByDate(request: PurchaseRequest): Date | null {
  const leadTime = maxLeadTimeDays(request)
  if (leadTime == null || !request.needed_by_date) return null
  return new Date(new Date(request.needed_by_date).getTime() - leadTime * DAY_MS)
}

/** True once part of this request has been handled but it hasn't reached
 * 'ordered' yet - i.e. some material is settled, some is still outstanding.
 * Both routes count: a PO raised from the request (po_create/po_update settle
 * a fully-covered line at 0 remaining rather than removing it, and only flip
 * status to 'ordered' once every line hits 0), and a manual settlement for
 * material bought outside that flow. A request nothing has touched has
 * neither, so this stays false for the common "nothing ordered yet" case. */
export function isPartiallyOrdered(request: PurchaseRequest): boolean {
  const touched =
    (request.purchase_orders?.length ?? 0) > 0 ||
    (request.purchase_request_items || []).some((item) => (item.purchase_request_item_settlements?.length ?? 0) > 0)
  return request.status === 'approved' && touched
}

/** Tooltip for the "partially ordered" badge, naming both the POs raised from
 * the request and any quantity closed out by hand - otherwise a request
 * settled purely by hand shows the badge with nothing to explain it. */
export function partiallyOrderedHint(request: PurchaseRequest): string {
  const parts: string[] = []
  const poNos = (request.purchase_orders || []).map((po) => po.po_no)
  if (poNos.length > 0) parts.push(`สั่งซื้อแล้วจาก: ${poNos.join(', ')}`)

  const settlements = (request.purchase_request_items || []).flatMap(
    (item) => item.purchase_request_item_settlements || []
  )
  const ordered = settlements.filter((s) => s.reason === 'ordered').length
  const cancelled = settlements.filter((s) => s.reason === 'cancelled').length
  if (ordered > 0) parts.push(`บันทึกว่าสั่งซื้อนอกคำขอ ${ordered} รายการ`)
  if (cancelled > 0) parts.push(`ตัดออก ${cancelled} รายการ`)

  return parts.join(' • ')
}

/** How a line with nothing outstanding left got that way, so the row can say
 * "ordered" or "dropped" rather than guessing. A line closed purely by
 * 'cancelled' settlements was never bought - calling that สั่งซื้อครบแล้ว
 * would be a lie the PM can't correct. */
function closedState(request: PurchaseRequest, item: PurchaseRequestItem): 'open' | 'ordered' | 'cancelled' {
  if (item.quantity_requested > 0) return 'open'
  const settlements = item.purchase_request_item_settlements || []
  const fromPo = (request.purchase_orders?.length ?? 0) > 0
  if (settlements.length === 0) return fromPo ? 'ordered' : 'open'
  const anyOrdered = fromPo || settlements.some((s) => s.reason === 'ordered')
  return anyOrdered ? 'ordered' : 'cancelled'
}

/** Plot scope is one of three mutually exclusive shapes (single plot, saved
 * group, or an ad-hoc multi-select) - same convention as purchase orders. */
function plotLabel(request: PurchaseRequest): string | null {
  if (request.plots?.name) return `แปลง ${request.plots.name}`
  if (request.plot_groups?.name) return `กลุ่มแปลง ${request.plot_groups.name}`
  const names = (request.purchase_request_plots || []).map((p) => p.plots?.name).filter(Boolean)
  if (names.length > 0) return `แปลง ${names.join(', ')}`
  return null
}

/** The full "view + approve/reject + edit" body for one purchase request -
 * shared by the standalone detail page (which fetches its own data on a
 * direct/deep link, e.g. from a notification) and the requests list, which
 * already has every request's full relations loaded and can show this
 * instantly in a modal with no fetch or route change at all. `onChanged`
 * is how the caller finds out something happened - the page refetches this
 * one request, the list just calls router.refresh() and lets the already-
 * fresh `requests` prop flow back down. */
export default function PurchaseRequestDetail({
  request,
  onChanged,
}: {
  request: PurchaseRequest
  onChanged: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [rejectNote, setRejectNote] = useState('')
  const [showRejectBox, setShowRejectBox] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false)

  function handleApprove() {
    startTransition(async () => {
      try {
        await approvePurchaseRequest(request.id)
        onChanged()
        toast.success('อนุมัติคำขอซื้อเรียบร้อยแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'อนุมัติไม่สำเร็จ')
      }
    })
  }

  function handleReject() {
    startTransition(async () => {
      try {
        await rejectPurchaseRequest(request.id, rejectNote)
        setShowRejectBox(false)
        onChanged()
        toast.success('ปฏิเสธคำขอซื้อแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ปฏิเสธไม่สำเร็จ')
      }
    })
  }

  function handleUndoSettlement(settlementId: string) {
    startTransition(async () => {
      const result = await undoPurchaseRequestItemSettlement(settlementId, request.id)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      onChanged()
      toast.success('คืนจำนวนกลับเข้าคำขอแล้ว')
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {request.projects?.name || '-'}
          {plotLabel(request) ? ` • ${plotLabel(request)}` : ''}
        </p>
        <div className="flex items-center gap-2">
          {request.status === 'pending_review' && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setIsEditModalOpen(true)}>
              <Pencil className="h-3.5 w-3.5" /> แก้ไข
            </Button>
          )}
          <PurchaseRequestDocActions requestId={request.id} prNo={request.pr_no} />
          {isPartiallyOrdered(request) && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700"
              title={partiallyOrderedHint(request)}
            >
              <PackageCheck className="h-3.5 w-3.5" /> สั่งซื้อบางส่วนแล้ว
            </span>
          )}
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${PR_STATUS_TONE[request.status]}`}>
            {PR_STATUS_LABEL[request.status]}
          </span>
        </div>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-slate-400">ผู้ขอซื้อ</div>
            <div className="font-medium text-slate-800">{request.requester?.full_name || request.requester?.email || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">ต้องการภายในวันที่</div>
            <div className="font-medium text-slate-800">
              {request.needed_by_date ? new Date(request.needed_by_date).toLocaleDateString('th-TH') : '-'}
            </div>
          </div>
          {(() => {
            const leadTime = maxLeadTimeDays(request)
            if (leadTime == null) return null
            const byDate = orderByDate(request)
            const isUrgent = byDate ? byDate.getTime() <= Date.now() : false
            return (
              <div className="col-span-2">
                <div className="text-xs text-slate-400">ระยะเวลาสั่งของ (นานสุดในรายการ {leadTime} วัน)</div>
                {byDate ? (
                  <div className={`font-medium ${isUrgent ? 'text-red-600' : 'text-slate-800'}`}>
                    ควรสั่งภายในวันที่ {byDate.toLocaleDateString('th-TH')}
                    {isUrgent && ' — เลยกำหนดที่ควรสั่งแล้ว'}
                  </div>
                ) : (
                  <div className="font-medium text-slate-800">ระบุ &ldquo;ต้องการภายในวันที่&rdquo; เพื่อคำนวณวันที่ควรสั่ง</div>
                )}
              </div>
            )
          })()}
          {request.note && (
            <div className="col-span-2">
              <div className="text-xs text-slate-400">หมายเหตุ</div>
              <div className="text-slate-700">{request.note}</div>
            </div>
          )}
          {request.review_note && (
            <div className="col-span-2">
              <div className="text-xs text-slate-400">เหตุผลที่ปฏิเสธ</div>
              <div className="text-slate-700">{request.review_note}</div>
            </div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">รายการวัสดุ</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">วัสดุ</th>
                <th className="px-4 py-2 text-right font-medium">จำนวน</th>
                <th className="px-4 py-2 font-medium">หน่วย</th>
                <th className="px-4 py-2 font-medium">เวลาที่ต้องสั่ง</th>
                <th className="px-4 py-2 font-medium">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(request.purchase_request_items || []).map((item) => {
                const closed = closedState(request, item)
                const settlements = item.purchase_request_item_settlements || []
                return (
                  <tr key={item.id}>
                    <td className="px-4 py-2.5 text-slate-800">
                      {item.material_types?.name || '-'}
                      {closed === 'ordered' && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                          <CheckCircle2 className="h-3.5 w-3.5" /> สั่งซื้อครบแล้ว
                        </span>
                      )}
                      {closed === 'cancelled' && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                          <XCircle className="h-3.5 w-3.5" /> ตัดออกแล้ว
                        </span>
                      )}
                      {/* Manual settlements are a human judgement call, so each
                        * one shows what was closed, why, and a way back out -
                        * unlike a PO-driven settle, nothing else records it. */}
                      {settlements.map((settlement) => (
                        <div key={settlement.id} className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                          <span>
                            {settlement.reason === 'ordered' ? 'สั่งซื้อนอกคำขอ' : 'ตัดออก'} {settlement.quantity}{' '}
                            {item.material_types?.unit || ''}
                            {settlement.po_ref ? ` • ${settlement.po_ref}` : ''}
                          </span>
                          {settlement.note && <span className="text-slate-400">({settlement.note})</span>}
                          <span className="text-slate-400">
                            โดย {settlement.settler?.full_name || settlement.settler?.email || '-'}
                          </span>
                          {request.status === 'approved' && (
                            <button
                              type="button"
                              onClick={() => handleUndoSettlement(settlement.id)}
                              disabled={isPending}
                              className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                            >
                              <Undo2 className="h-3 w-3" /> ยกเลิก
                            </button>
                          )}
                        </div>
                      ))}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-700">
                      {closed === 'open' ? item.quantity_requested : <span className="text-slate-400">-</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{item.material_types?.unit || '-'}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {item.material_types?.lead_time_days != null ? `${item.material_types.lead_time_days} วัน` : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{item.note || '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {request.status === 'pending_review' && (
        <Card className="p-5">
          {showRejectBox ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-700">เหตุผลที่ปฏิเสธ</label>
              <textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} className="w-full" rows={2} />
              <div className="flex justify-end gap-3">
                <Button type="button" variant="secondary" onClick={() => setShowRejectBox(false)}>
                  ยกเลิก
                </Button>
                <Button type="button" variant="danger" onClick={handleReject} disabled={isPending}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยันปฏิเสธ'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-3">
              <Button type="button" variant="danger" onClick={() => setShowRejectBox(true)} disabled={isPending}>
                ปฏิเสธ
              </Button>
              <Button type="button" onClick={handleApprove} disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'อนุมัติ'}
              </Button>
            </div>
          )}
        </Card>
      )}

      {request.status === 'approved' && (
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => setIsSettleModalOpen(true)}>
            <ListChecks className="h-4 w-4" /> เลือกรายการที่จัดการแล้ว
          </Button>
          <Button type="button" onClick={() => router.push(`/dashboard/procurement/orders/create?fromRequest=${request.id}`)}>
            <ShoppingCart className="h-4 w-4" /> สร้างใบสั่งซื้อจากคำขอนี้
          </Button>
        </div>
      )}

      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="แก้ไขคำขอซื้อ" panelClassName="max-w-2xl">
        <PurchaseRequestForm
          mode="edit"
          requestId={request.id}
          initialRequest={request}
          onCancel={() => setIsEditModalOpen(false)}
          onSaved={() => {
            setIsEditModalOpen(false)
            onChanged()
          }}
        />
      </Modal>

      {/* Mounted only while open so it always opens against the request's
        * current outstanding quantities rather than whatever they were the
        * first time this detail view rendered. */}
      {isSettleModalOpen && (
        <PurchaseRequestSettleModal
          request={request}
          onClose={() => setIsSettleModalOpen(false)}
          onSaved={() => {
            setIsSettleModalOpen(false)
            onChanged()
          }}
        />
      )}
    </div>
  )
}
