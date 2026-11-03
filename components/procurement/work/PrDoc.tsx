'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import ReasonDialog from '@/components/ui/ReasonDialog'
import { useToast } from '@/components/ui/Toast'
import { approvePurchaseRequest, rejectPurchaseRequest, getEligibleRequestLinesForOrder } from '@/actions/procurement-actions'
import { getBoqCheckForPurchaseRequest } from '@/actions/procurement/boq-control'
import { isBoqCheckLineOver } from '@/lib/procurement/boqControl'
import { buildCombineDraft } from '@/lib/procurement/combineDraft'
import { requestLineUnit } from '@/lib/procurement/requestQuantities'
import { docNo } from '@/lib/status-labels'
import {
  buildChain,
  openLines,
  requestIsLate,
  requestLineWord,
  requestPlotText,
  requesterName,
} from '@/lib/procurement/workQueue'
import PurchaseRequestForm from '@/components/procurement/PurchaseRequestForm'
import PurchaseRequestSettleModal from '@/components/procurement/PurchaseRequestSettleModal'
import RequestPoLinkSheet from '@/components/procurement/RequestPoLinkSheet'
import DocumentHistoryPanel from '@/components/procurement/DocumentHistoryPanel'
import { DocFacts, DocModal, DocSteps, DocTable, Hint, StatusChip, WarnTag, fmtDate, fmtDateTime, qtyText, type MoreItem } from './docUi'
import { daysBetween, nowOf } from '@/lib/procurement/nowStatus'
import type { DocCtx } from './types'

/** A request, in the one window layout. Approve, order, link or close lines
 * without leaving it. */
export default function PrDoc({ id, ctx }: { id: string; ctx: DocCtx }) {
  const request = ctx.ix.requestById.get(id)
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  const [rejecting, setRejecting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [settleFor, setSettleFor] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const [overNames, setOverNames] = useState<string[]>([])
  const [lastBought, setLastBought] = useState<Map<string, { shop: string; price: number; unit: string }>>(new Map())

  useEffect(() => {
    let cancelled = false
    getBoqCheckForPurchaseRequest(id)
      .then((r) => {
        if (!cancelled) setOverNames(r.lines.filter(isBoqCheckLineOver).map((l) => l.materialName))
      })
      .catch(() => {
        // The window works without the BOQ note.
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const projectId = request?.project_id
  const isApproved = request?.status === 'approved'
  useEffect(() => {
    if (!projectId || !isApproved) return
    let cancelled = false
    getEligibleRequestLinesForOrder(projectId)
      .then((lines) => {
        if (cancelled) return
        const map = new Map<string, { shop: string; price: number; unit: string }>()
        for (const l of lines) if (l.purchase_request_id === id && l.last_supplier_name) map.set(l.purchase_request_item_id, { shop: l.last_supplier_name, price: l.unit_price, unit: l.unit })
        setLastBought(map)
      })
      .catch(() => {
        // The hint is optional.
      })
    return () => {
      cancelled = true
    }
  }, [id, projectId, isApproved])

  const open = useMemo(() => (request ? openLines(request) : []), [request])
  const wantsOrder = ctx.autoOrderId === id
  useEffect(() => {
    // Opened from the list's "ออกใบสั่งซื้อ" button: go straight to the order.
    if (!wantsOrder || !request || request.status !== 'approved') return
    ctx.clearAutoOrder()
    void startOrder(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsOrder])
  const picked = open.filter((i) => !unchecked.has(i.id))

  if (!request) return null
  const late = requestIsLate(request, ctx.today)
  const now = nowOf({ type: 'PR', id }, ctx.ix, ctx.today)
  const chain = buildChain({ type: 'PR', id }, ctx.ix)
  const items = request.purchase_request_items || []
  const isPendingReview = request.status === 'pending_review'
  // Fully ordered and waiting: the main button receives goods on the order that is still open.
  const waitingOrder = request.status !== 'pending_review' && open.length === 0
    ? Array.from(ctx.ix.posOfRequest.get(id) || []).map((p) => ctx.ix.orderById.get(p)).find((o) => o && (o.status === 'sent' || o.status === 'partially_received'))
    : undefined

  function approve(thenOrder: boolean) {
    startTransition(async () => {
      const result = await approvePurchaseRequest(id)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success(`${docNo('PR', request!.pr_no)} อนุมัติแล้ว`)
      ctx.refresh()
      if (thenOrder) {
        await startOrder(true)
        return
      }
      ctx.advance()
    })
  }

  async function startOrder(all = false) {
    const wanted = new Set((all ? items.filter((i) => i.line_status === 'open') : picked).map((i) => i.id))
    try {
      const lines = (await getEligibleRequestLinesForOrder(request!.project_id)).filter(
        (l) => l.purchase_request_id === id && (all ? true : wanted.has(l.purchase_request_item_id))
      )
      if (lines.length === 0) {
        toast.error('ไม่พบรายการที่รอสั่ง ลองรีเฟรชหน้านี้อีกครั้ง')
        return
      }
      // The shop most of these lines were last bought from; blank if never bought.
      const tally = new Map<string, number>()
      for (const l of lines) if (l.last_supplier_id) tally.set(l.last_supplier_id, (tally.get(l.last_supplier_id) || 0) + 1)
      const supplierId = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
      ctx.startPo(
        buildCombineDraft(
          lines.map((line) => ({ line, qty: line.unit_mismatch ? 0 : line.remaining })),
          request!.project_id,
          supplierId
        )
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'เปิดใบสั่งซื้อไม่สำเร็จ')
    }
  }

  function reject(reason: string) {
    startTransition(async () => {
      const result = await rejectPurchaseRequest(id, reason)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      setRejecting(false)
      toast.success(`${docNo('PR', request!.pr_no)} ไม่อนุมัติ · ผู้ขอจะเห็นเหตุผล`)
      ctx.refresh()
      ctx.advance()
    })
  }

  const more: MoreItem[] = []
  if (isPendingReview) more.push({ key: 'approve-order', label: 'อนุมัติ + ออกใบสั่งซื้อ', onClick: () => approve(true) })
  if (open.length > 0 && !isPendingReview) {
    more.push({ key: 'skip', label: 'ไม่ซื้อรายการ (ปิดรายการ)', onClick: () => setSettleFor('all') })
  }
  if (request.status === 'pending_review' || request.status === 'approved') more.push({ key: 'edit', label: 'แก้ไขคำขอ', onClick: () => setEditing(true) })
  more.push({ key: 'print', label: 'พิมพ์ / PDF', href: `/api/procurement/requests/${id}/pdf` })
  more.push({ key: 'full', label: 'เปิดหน้าเต็ม (แก้การปิดรายการ)', href: `/dashboard/procurement/requests/${id}` })

  const primary = isPendingReview ? (
    <Button type="button" onClick={() => approve(false)} disabled={isPending}>
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'อนุมัติ'}
    </Button>
  ) : request.status === 'approved' && open.length > 0 ? (
    <Button type="button" onClick={() => startOrder()} disabled={isPending || picked.length === 0}>
      ออกใบสั่งซื้อ ({picked.length})
    </Button>
  ) : waitingOrder ? (
    <Button type="button" onClick={() => ctx.receive(waitingOrder.id)}>
      รับของ
    </Button>
  ) : null

  const secondary = isPendingReview ? (
    <Button type="button" variant="secondary" onClick={() => setRejecting(true)} disabled={isPending}>
      ไม่อนุมัติ
    </Button>
  ) : request.status === 'approved' && open.length > 0 ? (
    <Button type="button" variant="secondary" onClick={() => setLinking(true)}>
      ผูกกับ PO เดิม
    </Button>
  ) : waitingOrder ? (
    <Button type="button" variant="secondary" onClick={() => ctx.go({ type: 'PO', id: waitingOrder.id })}>
      เปิด {docNo('PO', waitingOrder.po_no)}
    </Button>
  ) : null

  return (
    <>
      <DocModal
        title={`คำขอซื้อ ${docNo('PR', request.pr_no)}`}
        now={now}
        onClose={ctx.close}
        onBack={ctx.back ?? undefined}
        backLabel={ctx.backLabel}
        position={ctx.position}
        more={more}
        primary={primary}
        secondary={secondary}
      >
        <DocSteps chain={chain} current={{ type: 'PR', id }} ix={ctx.ix} now={now} onGo={ctx.go} />
        <DocFacts
          items={[
            { label: 'แปลง', value: requestPlotText(request) },
            { label: 'ผู้ขอ', value: requesterName(request) },
            { label: 'ส่งคำขอ', value: fmtDateTime(request.created_at) },
            {
              label: 'ต้องการภายใน',
              value: (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {fmtDate(request.needed_by_date)}
                  {late && <WarnTag>เลย {daysBetween(request.needed_by_date, ctx.today)} วัน</WarnTag>}
                </span>
              ),
            },
          ]}
        />
        {overNames.length > 0 && (
          <Hint>
            {overNames.slice(0, 3).join(', ')}
            {overNames.length > 3 ? ` และอีก ${overNames.length - 3} รายการ` : ''} เกิน BOQ ของแปลง · เตือนเฉยๆ อนุมัติได้ PM จะเห็นในรายงาน
          </Hint>
        )}
        {request.note && <p className="text-sm text-slate-600">หมายเหตุ: {request.note}</p>}

        <DocTable>
          <thead>
            <tr>
              {open.length > 0 && !isPendingReview && <th className="w-8" />}
              <th>วัสดุ</th>
              <th className="n">ขอ</th>
              <th className="n hidden sm:table-cell">สั่งแล้ว</th>
              <th className="n hidden sm:table-cell">รับแล้ว</th>
              <th className="hidden sm:table-cell">ใบสั่งซื้อ</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const word = requestLineWord(request, item)
              const f = item.fulfillment
              const poLinks = new Map<string, string>()
              for (const l of f?.links || []) if (!l.cancelled) poLinks.set(l.poId, l.poNo)
              for (const l of item.purchase_request_po_links || []) {
                const po = l.purchase_order_items?.purchase_orders
                if (po?.id && po.status !== 'cancelled') poLinks.set(po.id, po.po_no)
              }
              const isOpen = item.line_status === 'open' && !isPendingReview
              const unit = requestLineUnit(item)
              return (
                <tr key={item.id} className={isOpen ? 'bg-amber-50/50' : undefined}>
                  {open.length > 0 && !isPendingReview && (
                    <td>
                      {isOpen && (
                        <input
                          type="checkbox"
                          checked={!unchecked.has(item.id)}
                          onChange={(e) =>
                            setUnchecked((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.delete(item.id)
                              else next.add(item.id)
                              return next
                            })
                          }
                          aria-label={`เลือก ${item.material_types?.name || ''}`}
                        />
                      )}
                    </td>
                  )}
                  <td>
                    <div>{item.material_types?.name || '-'}</div>
                    {item.original_material?.name && item.original_material.name !== item.material_types?.name && (
                      <div className="text-xs text-slate-500">ขอไว้: {item.original_material.name}</div>
                    )}
                    {item.note && <div className="text-xs text-slate-500">{item.note}</div>}
                    {isOpen && lastBought.get(item.id) && (
                      <div className="text-xs text-slate-500">
                        ซื้อล่าสุด {lastBought.get(item.id)!.shop}
                        {lastBought.get(item.id)!.price > 0 ? ` ฿${qtyText(lastBought.get(item.id)!.price)}/${lastBought.get(item.id)!.unit}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="n whitespace-nowrap">
                    {qtyText(Number(item.quantity_requested))} {unit}
                  </td>
                  <td className="n hidden sm:table-cell">{f && f.allocated > 0 ? qtyText(f.allocated) : '–'}</td>
                  <td className={`n hidden sm:table-cell ${f && f.allocated > 0 && f.received >= f.allocated ? 'font-semibold text-emerald-700' : ''}`}>
                    {f && f.received > 0 ? qtyText(f.received) : '–'}
                  </td>
                  <td className="hidden sm:table-cell">
                    {poLinks.size === 0 ? (
                      <span className="text-slate-400">–</span>
                    ) : (
                      <span className="flex flex-wrap gap-x-2">
                        {Array.from(poLinks.entries()).map(([poId, poNo]) => (
                          <button key={poId} type="button" className="font-mono text-xs text-indigo-600 hover:underline" onClick={() => ctx.go({ type: 'PO', id: poId })}>
                            {poNo}
                          </button>
                        ))}
                      </span>
                    )}
                  </td>
                  <td>
                    {word.word ? (
                      <StatusChip label={word.word} tone={word.tone === 'ok' ? 'ok' : word.tone === 'go' ? 'late' : 'wait'} />
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </DocTable>

        <details className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-slate-600">ประวัติ</summary>
          <div className="pt-2">
            <DocumentHistoryPanel key={id} target={{ kind: 'pr', id }} />
          </div>
        </details>
      </DocModal>

      <ReasonDialog
        isOpen={rejecting}
        title="ไม่อนุมัติคำขอซื้อ"
        label="เหตุผล (ผู้ขอจะเห็น)"
        confirmLabel="ไม่อนุมัติ"
        busy={isPending}
        onConfirm={reject}
        onCancel={() => setRejecting(false)}
      />
      <Modal isOpen={editing} onClose={() => setEditing(false)} title="แก้ไขคำขอซื้อ" panelClassName="max-w-2xl">
        <PurchaseRequestForm
          mode="edit"
          requestId={id}
          initialRequest={request}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            ctx.refresh()
          }}
        />
      </Modal>
      {settleFor && (
        <PurchaseRequestSettleModal
          request={request}
          onlyItemId={settleFor === 'all' ? undefined : settleFor}
          onClose={() => setSettleFor(null)}
          onSaved={() => {
            setSettleFor(null)
            ctx.refresh()
          }}
        />
      )}
      {linking && (
        <RequestPoLinkSheet
          mode="request"
          requestId={id}
          onClose={() => setLinking(false)}
          onLinked={() => {
            setLinking(false)
            ctx.refresh()
          }}
        />
      )}
    </>
  )
}
