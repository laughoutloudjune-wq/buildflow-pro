'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Link2, Loader2, PackageCheck, Pencil, ShoppingCart, Undo2, XCircle } from 'lucide-react'
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
import RequestPoLinkSheet from '@/components/procurement/RequestPoLinkSheet'
import { unlinkRequestFromOrder } from '@/actions/procurement/request-links'
import RequestOrderComparison from '@/components/procurement/RequestOrderComparison'
import { compareRequestLine, lineHasFlag, type RequestLineFlag } from '@/lib/procurement/requestFlags'
import BoqCheckPanel from '@/components/procurement/BoqCheckPanel'
import { getBoqCheckForPurchaseRequest } from '@/actions/procurement/boq-control'
import { getUnitConversions } from '@/actions/procurement/unit-conversions'
import UnitConversionNote from '@/components/procurement/UnitConversionNote'
import { UNKNOWN_CONVERSION_LABEL, type UnitConversions } from '@/lib/procurement/units'
import { isBoqCheckLineOver } from '@/lib/procurement/boqControl'
import { PR_STATUS_LABEL, PR_STATUS_TONE } from '@/lib/status-labels'
import type { PurchaseRequest, PurchaseRequestItem } from '@/lib/types/procurement'
import DocumentHistoryPanel from '@/components/procurement/DocumentHistoryPanel'
import {
  orderLineUnit,
  orderedQuantity,
  originalQuantityRequested,
  purchasesInOtherUnits,
  requestLineUnit,
} from '@/lib/procurement/requestQuantities'

const DAY_MS = 24 * 60 * 60 * 1000

/** The whole request can't be ordered faster than its slowest-lead-time
 * line, since procurement places one order per request - so the request
 * level "when must we order" is the max across its still-outstanding items
 * (a line already fully covered by an earlier PO doesn't need ordering
 * again, so it shouldn't hold the "order by" date hostage). Null when
 * nothing outstanding has a lead time set yet. */
function maxLeadTimeDays(request: PurchaseRequest): number | null {
  const values = (request.purchase_request_items || [])
    .filter((item) => item.line_status === 'open')
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
  // The database keeps the line state (open / ordered / arrived / closed);
  // a hand-closed line reads as bought elsewhere or dropped by its reason.
  if (item.line_status === 'ordered' || item.line_status === 'arrived') return 'ordered'
  if (item.line_status === 'closed') {
    const settlements = item.purchase_request_item_settlements || []
    return settlements.some((s) => s.reason === 'ordered') ? 'ordered' : 'cancelled'
  }
  void request
  return 'open'
}

/** The orders this line was answered by, with how much each one takes from
 * THIS line (its allocation - on a consolidated order that is only this
 * request's slice of the PO line). Deduplicated per order and unit. */
function poRefs(item: PurchaseRequestItem): string[] {
  const byPo = new Map<string, string>()
  const totals = new Map<string, { poNo: string; unit: string; qty: number }>()
  for (const line of item.purchase_order_items || []) {
    const poNo = line.purchase_orders?.po_no
    if (!poNo) continue
    const unit = orderLineUnit(item, line)
    const key = `${poNo}|${unit}`
    const existing = totals.get(key)
    if (existing) existing.qty += Number(line.quantity_ordered || 0)
    else totals.set(key, { poNo, unit, qty: Number(line.quantity_ordered || 0) })
  }
  for (const { poNo, unit, qty } of totals.values()) {
    byPo.set(`${poNo}|${unit}`, `${poNo} (${qty.toLocaleString('th-TH')} ${unit})`.trim())
  }
  return Array.from(byPo.values())
}

/** Where the line stands, and the order that put it there. Replaces the old
 * "คงเหลือ" number, which could only ever be stated in the unit the line was
 * asked in - meaningless once it was bought in a different one. */
function statusCell(item: PurchaseRequestItem, closed: 'open' | 'ordered' | 'cancelled') {
  const refs = poRefs(item)
  const refSuffix = refs.length > 0 ? <span className="font-normal text-slate-500"> · {refs.join(', ')}</span> : null

  if (closed === 'ordered') {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> ครบ{refSuffix}
      </span>
    )
  }
  if (closed === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-slate-500">
        <XCircle className="h-3.5 w-3.5 shrink-0" /> ตัดออก
      </span>
    )
  }
  const touched = orderedQuantity(item) > 0 || purchasesInOtherUnits(item).length > 0
  if (touched) {
    return (
      <span className="whitespace-nowrap text-xs font-medium text-amber-700">
        สั่งบางส่วน · ขอ {item.quantity_requested.toLocaleString('th-TH')} {requestLineUnit(item)}
        {refSuffix}
      </span>
    )
  }
  return <span className="text-xs text-slate-500">รอสั่งซื้อ</span>
}

/** Small tags saying how what was bought compares with what was asked. They
 * are information for the PM and purchasing; none of them blocks anything. */
function lineTags(request: PurchaseRequest, item: PurchaseRequestItem): { label: string; tone: string }[] {
  const tags: { label: string; tone: string }[] = []
  const links = (item.fulfillment?.links || []).filter((l) => !l.cancelled)
  const unit = requestLineUnit(item)
  const asked = originalQuantityRequested(item)
  const seen = new Set<string>()
  for (const l of links) {
    if (l.isSubstitute) {
      const label = `ซื้อ ${l.actualMaterialName} แทน`
      if (!seen.has(label)) {
        seen.add(label)
        tags.push({ label, tone: 'bg-indigo-50 text-indigo-700' })
      }
    }
    if (l.unit !== unit || Math.abs(l.allocated - asked) > 1e-9) {
      const label = `ซื้อ ${l.allocated.toLocaleString('th-TH')} ${l.unit} (ขอ ${asked.toLocaleString('th-TH')} ${unit})`
      if (!seen.has(label)) {
        seen.add(label)
        tags.push({ label, tone: 'bg-amber-50 text-amber-700' })
      }
    }
  }
  if (item.line_status === 'open' && request.needed_by_date && new Date(request.needed_by_date).getTime() < Date.now()) {
    tags.push({ label: 'เลยวันที่ต้องการ ยังไม่ได้สั่ง', tone: 'bg-rose-50 text-rose-700' })
  }
  return tags
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
  // Settle modal: null = closed, 'all' = every open line, else one line (its own "ตัดออก").
  const [settleFor, setSettleFor] = useState<string | null>(null)
  // Link sheet: null = closed; lineId narrows it to one line; poNo jumps to the PO typed when the line was closed the old way.
  const [linkSheet, setLinkSheet] = useState<{ lineId?: string; poNo?: string | null } | null>(null)
  // The clock is read once here rather than during render: the compiler
  // caches render output against the inputs it can see, and the clock isn't
  // one of them, so a Date.now() read while rendering can leave the "overdue"
  // highlight below frozen at whatever it was on the first render. A lazy
  // initializer runs exactly once per mount, which is an input it can track.
  const [now] = useState(() => Date.now())
  const [flagFilter, setFlagFilter] = useState<RequestLineFlag | null>(null)
  const [boqCheck, setBoqCheck] = useState<Awaited<ReturnType<typeof getBoqCheckForPurchaseRequest>> | null>(null)

  const [conversions, setConversions] = useState<UnitConversions>({})
  const [conversionsRev, setConversionsRev] = useState(0)
  const reloadConversions = useCallback(() => setConversionsRev((n) => n + 1), [])
  const canSetConversion = true

  const materialIdsKey = (request.purchase_request_items || []).map((i) => i.material_type_id).join(',')
  useEffect(() => {
    let cancelled = false
    const ids = materialIdsKey ? materialIdsKey.split(',').map(Number) : []
    getUnitConversions(ids)
      .then((c) => {
        if (!cancelled) setConversions(c)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [materialIdsKey, conversionsRev])

  useEffect(() => {
    let cancelled = false
    getBoqCheckForPurchaseRequest(request.id)
      .then((result) => {
        if (!cancelled) setBoqCheck(result)
      })
      .catch(() => {
        // Non-fatal: the request still opens and works without the check.
      })
    return () => {
      cancelled = true
    }
  }, [request.id])

  function handleApprove() {
    startTransition(async () => {
      const result = await approvePurchaseRequest(request.id)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      onChanged()
      toast.success('อนุมัติคำขอซื้อเรียบร้อยแล้ว')
    })
  }

  function handleReject() {
    startTransition(async () => {
      const result = await rejectPurchaseRequest(request.id, rejectNote)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      setShowRejectBox(false)
      onChanged()
      toast.success('ปฏิเสธคำขอซื้อแล้ว')
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

  function handleUnlink(linkId: string) {
    startTransition(async () => {
      const result = await unlinkRequestFromOrder(linkId, { requestId: request.id })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      onChanged()
      toast.success('ยกเลิกการผูกกับ PO แล้ว')
    })
  }

  const canChangeLines = request.status === 'approved' || request.status === 'ordered'

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
        <div className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
          <div>
            <div className="text-xs text-slate-500">ผู้ขอซื้อ</div>
            <div className="font-medium text-slate-800">{request.requester?.full_name || request.requester?.email || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">ต้องการภายในวันที่</div>
            <div className="font-medium text-slate-800">
              {request.needed_by_date ? new Date(request.needed_by_date).toLocaleDateString('th-TH') : '-'}
            </div>
          </div>
          {(() => {
            const leadTime = maxLeadTimeDays(request)
            if (leadTime == null) return null
            const byDate = orderByDate(request)
            const isUrgent = byDate != null && now != null && byDate.getTime() <= now
            return (
              <div className="col-span-2">
                <div className="text-xs text-slate-500">ระยะเวลาสั่งของ (นานสุดในรายการ {leadTime} วัน)</div>
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
              <div className="text-xs text-slate-500">หมายเหตุ</div>
              <div className="text-slate-700">{request.note}</div>
            </div>
          )}
          {request.review_note && (
            <div className="col-span-2">
              <div className="text-xs text-slate-500">เหตุผลที่ปฏิเสธ</div>
              <div className="text-slate-700">{request.review_note}</div>
            </div>
          )}
        </div>
      </Card>

      {(request.status === 'approved' || request.status === 'ordered' || request.status === 'received') && (
        <RequestOrderComparison request={request} canReview={false} onChanged={onChanged} activeFlag={flagFilter} onFlagChange={setFlagFilter} />
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">รายการวัสดุ</h3>
        {(request.purchase_request_items || [])
          .filter((item) => !flagFilter || lineHasFlag(compareRequestLine(request, item, now), flagFilter))
          .map((item) => {
            const closed = closedState(request, item)
            const settlements = item.purchase_request_item_settlements || []
            const links = item.fulfillment?.links || []
            const boqLine = boqCheck?.lines.find((l) => l.materialTypeId === item.material_type_id)
            const masterUnit = item.material_types?.unit || ''
            const poLinks = item.purchase_request_po_links || []
            const linkByPoItem = new Map(poLinks.map((l) => [l.purchase_order_item_id, l]))
            // Links whose order line has no allocation row to show them (the
            // order was edited after linking) still get listed.
            const shownPoItems = new Set(links.map((l) => l.poItemId))
            const extraLinks = poLinks.filter((l) => !shownPoItems.has(l.purchase_order_item_id) && l.purchase_order_items?.purchase_orders)
            const typedClosure = settlements.find((st) => st.reason === 'ordered' && st.po_ref)
            const canLinkLine = canChangeLines && (item.line_status === 'open' || (item.line_status === 'closed' && settlements.some((st) => st.reason === 'ordered') && poLinks.length === 0))
            return (
              <Card key={item.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">
                      {item.material_types?.name || '-'}
                      {item.original_material?.name && item.original_material_type_id !== item.material_type_id && (
                        <span className="ml-2 text-xs font-normal text-slate-500">ขอไว้เดิม: {item.original_material.name}</span>
                      )}
                      {item.boq_master?.item_name && (
                        <span className="ml-2 text-xs font-normal text-slate-500">สำหรับงาน: {item.boq_master.item_name}</span>
                      )}
                    </p>
                    {item.note && <p className="text-xs text-slate-500">หมายเหตุ: {item.note}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {statusCell(item, closed)}
                    {lineTags(request, item).map((t) => (
                      <span key={t.label} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${t.tone}`}>
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-3">
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="text-xs font-medium text-slate-500">ขอ</p>
                    <p className="font-medium text-slate-800">
                      {originalQuantityRequested(item).toLocaleString('th-TH')} {requestLineUnit(item)}
                    </p>
                    <UnitConversionNote
                      materialTypeId={item.material_type_id}
                      masterUnit={masterUnit}
                      unit={requestLineUnit(item)}
                      quantity={originalQuantityRequested(item)}
                      conversions={conversions}
                      onSaved={reloadConversions}
                      canSet={canSetConversion}
                      compact
                    />
                  </div>

                  <div className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="text-xs font-medium text-slate-500">ซื้อ</p>
                    {links.length === 0 && extraLinks.length === 0 ? (
                      <p className="text-slate-500">{closed === 'cancelled' ? 'ตัดออก ไม่ได้ซื้อ' : 'ยังไม่มีใบสั่งซื้อ'}</p>
                    ) : (
                      <ul className="space-y-1">
                        {links.map((l) => (
                          <li key={l.allocationId ?? `${l.poId}-${l.poItemId}`} className={l.cancelled ? 'text-slate-400 line-through' : 'text-slate-700'}>
                            <Link href={`/dashboard/procurement/orders/${l.poId}`} className="font-mono text-indigo-600 hover:underline">
                              {l.poNo}
                            </Link>{' '}
                            {l.allocated.toLocaleString('th-TH')} {l.unit}
                            {l.isSubstitute && <span className="text-indigo-700"> · {l.actualMaterialName} แทน</span>}
                            <span className="block text-xs text-slate-500">
                              {l.supplierName || '-'} · {l.outstanding > 0 ? `ค้างรับ ${l.outstanding.toLocaleString('th-TH')}` : 'ของมาครบ'}
                              {l.received > 0 ? ` · รับแล้ว ${l.receivedIsEstimate ? '≈' : ''}${l.received.toLocaleString('th-TH')}` : ''}
                              {canChangeLines && l.poItemId && linkByPoItem.get(l.poItemId) && (
                                <button
                                  type="button"
                                  onClick={() => handleUnlink(linkByPoItem.get(l.poItemId as string)!.id)}
                                  disabled={isPending}
                                  className="ml-2 font-medium text-slate-500 hover:text-rose-600 disabled:opacity-50"
                                >
                                  ยกเลิกการผูก
                                </button>
                              )}
                            </span>
                          </li>
                        ))}
                        {extraLinks.map((l) => {
                          const poi = l.purchase_order_items
                          const po = poi?.purchase_orders
                          if (!poi || !po) return null
                          return (
                            <li key={l.id} className="text-slate-700">
                              <Link href={`/dashboard/procurement/orders/${po.id}`} className="font-mono text-indigo-600 hover:underline">
                                {po.po_no}
                              </Link>{' '}
                              {Number(poi.quantity_ordered).toLocaleString('th-TH')} {poi.unit || poi.material_types?.unit || ''}
                              <span className="block text-xs text-slate-500">
                                {po.suppliers?.name || '-'} · {po.status === 'received' || po.status === 'paid' ? 'ของมาแล้ว' : 'ผูกกับ PO แล้ว'}
                                {canChangeLines && (
                                  <button
                                    type="button"
                                    onClick={() => handleUnlink(l.id)}
                                    disabled={isPending}
                                    className="ml-2 font-medium text-slate-500 hover:text-rose-600 disabled:opacity-50"
                                  >
                                    ยกเลิกการผูก
                                  </button>
                                )}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="text-xs font-medium text-slate-500">BOQ ของแปลงในคำขอนี้</p>
                    {!boqLine ? (
                      <p className="text-slate-500">{boqCheck ? (closed === 'open' ? 'ไม่มีข้อมูล BOQ' : 'ใบสั่งซื้อนับอยู่ในยอดสั่งแล้ว') : 'กำลังโหลด...'}</p>
                    ) : (
                      <div className="space-y-0.5 text-slate-700">
                        <p>ใช้ได้ {boqLine.plannedQty.toLocaleString('th-TH')} {boqLine.unit}</p>
                        <p>สั่ง/เบิกไปแล้ว {boqLine.alreadyQty.toLocaleString('th-TH')}</p>
                        <p>คำขอนี้ {boqLine.unconverted ? <span className="text-amber-700">{UNKNOWN_CONVERSION_LABEL}</span> : boqLine.thisDocQty.toLocaleString('th-TH')}</p>
                        <p className="font-medium">
                          รวม {boqLine.totalAfter.toLocaleString('th-TH')}
                          {isBoqCheckLineOver(boqLine) && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">เกิน BOQ · แค่เตือน</span>}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {canLinkLine && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    {typedClosure?.po_ref && (
                      <span className="text-xs text-amber-700">
                        ปิดไว้ด้วยเลขที่พิมพ์ {typedClosure.po_ref} ยังไม่ได้ผูกกับ PO จริง
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setLinkSheet({ lineId: item.id, poNo: typedClosure?.po_ref ?? null })}
                      disabled={isPending}
                      className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                    >
                      <Link2 className="h-3.5 w-3.5" /> {typedClosure?.po_ref ? `ผูกกับ ${typedClosure.po_ref}` : 'ผูก PO'}
                    </button>
                    {item.line_status === 'open' && (
                      <button
                        type="button"
                        onClick={() => setSettleFor(item.id)}
                        disabled={isPending}
                        className="font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
                      >
                        ตัดออก
                      </button>
                    )}
                  </div>
                )}

                {/* Manual settlements are a human judgement call, so each one
                  * shows what was closed, why, and a way back out - unlike a
                  * PO-driven settle, nothing else records it. */}
                {settlements.map((settlement) => (
                  <div key={settlement.id} className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                    <span>
                      {settlement.reason === 'ordered' ? (poLinks.length > 0 ? 'เดิมปิดด้วยเลข PO ที่พิมพ์' : 'ซื้อโดยไม่มี PO') : 'ตัดออก'} {settlement.quantity} {item.material_types?.unit || ''}
                      {settlement.po_ref ? ` • ${settlement.po_ref}` : ''}
                    </span>
                    {settlement.note && <span>({settlement.note})</span>}
                    <span>โดย {settlement.settler?.full_name || settlement.settler?.email || '-'}</span>
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
                {links.some((l) => l.receivedIsEstimate) && (
                  <p className="text-[11px] text-slate-500">≈ ประมาณตามสัดส่วนของที่สั่ง ใบรับสินค้าไม่ได้ระบุว่าของที่รับเป็นของคำขอใบไหน</p>
                )}
              </Card>
            )
          })}
      </div>

      {boqCheck && boqCheck.lines.length > 0 && <BoqCheckPanel lines={boqCheck.lines} scopeLabel={boqCheck.scopeLabel} />}

      {/* Decision / next-step bar: stays in view so the decision never sits below a long scroll. */}
      {(request.status === 'pending_review' || request.status === 'approved') && (
        <div className="sticky bottom-0 z-10 -mx-1 pb-1">
          <Card className="elev-floating space-y-3 px-5 py-3">
            {request.status === 'pending_review' && showRejectBox && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">เหตุผลที่ปฏิเสธ (แจ้งกลับให้ผู้ขอซื้อ)</label>
                <textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} className="w-full" rows={2} autoFocus />
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-slate-900">
                  {request.status === 'pending_review' ? 'รอการตัดสินใจ' : 'อนุมัติแล้ว พร้อมออกใบสั่งซื้อ'}
                </p>
                <p className="text-xs text-slate-500">
                  {(request.purchase_request_items || []).length} รายการวัสดุ
                  {request.requester?.full_name || request.requester?.email ? ` · ผู้ขอซื้อ ${request.requester?.full_name || request.requester?.email}` : ''}
                  {request.needed_by_date ? ` · ต้องการภายใน ${new Date(request.needed_by_date).toLocaleDateString('th-TH')}` : ''}
                </p>
              </div>
              {request.status === 'pending_review' ? (
                <div className="flex items-center gap-3">
                  {showRejectBox ? (
                    <>
                      <Button type="button" variant="secondary" onClick={() => setShowRejectBox(false)}>
                        ยกเลิก
                      </Button>
                      <Button type="button" variant="danger" onClick={handleReject} disabled={isPending}>
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยันปฏิเสธ'}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button type="button" variant="danger" onClick={() => setShowRejectBox(true)} disabled={isPending}>
                        ไม่อนุมัติ
                      </Button>
                      <Button type="button" onClick={handleApprove} disabled={isPending}>
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'อนุมัติ'}
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" variant="secondary" onClick={() => setLinkSheet({})}>
                    <Link2 className="h-4 w-4" /> ผูกกับ PO ที่มีอยู่
                  </Button>
                  <Button type="button" onClick={() => router.push(`/dashboard/procurement/orders/create?fromRequest=${request.id}`)}>
                    <ShoppingCart className="h-4 w-4" /> ออกใบสั่งซื้อใหม่
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      <DocumentHistoryPanel key={request.id} target={{ kind: 'pr', id: request.id }} />

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
      {settleFor && (
        <PurchaseRequestSettleModal
          request={request}
          onlyItemId={settleFor === 'all' ? undefined : settleFor}
          onClose={() => setSettleFor(null)}
          onSaved={() => {
            setSettleFor(null)
            onChanged()
          }}
        />
      )}

      {linkSheet && (
        <RequestPoLinkSheet
          mode="request"
          requestId={request.id}
          onlyLineId={linkSheet.lineId}
          initialPoNo={linkSheet.poNo}
          onClose={() => setLinkSheet(null)}
          onLinked={() => {
            setLinkSheet(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}
