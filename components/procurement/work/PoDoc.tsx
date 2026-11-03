'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import ReasonDialog from '@/components/ui/ReasonDialog'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import {
  setPurchaseOrderStatus,
  cancelPurchaseOrder,
  closePurchaseOrderShort,
  deletePurchaseOrder,
  duplicatePurchaseOrder,
} from '@/actions/procurement-actions'
import { docNo } from '@/lib/status-labels'
import { buildChain, orderIsLate, orderStatusWord, isReceiptPaid } from '@/lib/procurement/workQueue'
import RequestPoLinkSheet from '@/components/procurement/RequestPoLinkSheet'
import DocumentHistoryPanel from '@/components/procurement/DocumentHistoryPanel'
import { DocChainBar, DocFacts, DocModal, DocTable, DocTrack, Hint, StatusChip, WarnTag, fmtDate, qtyText, type MoreItem } from './docUi'
import type { DocCtx } from './types'

type Ask = 'cancel' | 'short' | 'delete' | null

/** A purchase order, in the one window layout. Send, receive and pay from here. */
export default function PoDoc({ id, ctx }: { id: string; ctx: DocCtx }) {
  const order = ctx.ix.orderById.get(id)
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [ask, setAsk] = useState<Ask>(null)
  const [linking, setLinking] = useState(false)

  if (!order) return null
  const status = orderStatusWord(order)
  const late = orderIsLate(order, ctx.today)
  const chain = buildChain({ type: 'PO', id }, ctx.ix)
  const items = order.purchase_order_items || []
  const unpaidReceipts = (ctx.ix.receiptsOfPo.get(id) || []).filter((r) => !isReceiptPaid(r))

  const current =
    order.status === 'draft' ? 0 : order.status === 'sent' || order.status === 'partially_received' ? 2 : order.status === 'received' ? 3 : 4

  function run(action: () => Promise<{ ok: true } | { error: string } | { id: string; po_no: string }>, done: string, then?: (r: unknown) => void) {
    startTransition(async () => {
      const result = await action()
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success(done)
      ctx.refresh()
      then?.(result)
    })
  }

  function confirmAsk(reason: string) {
    const kind = ask
    setAsk(null)
    if (kind === 'cancel') run(() => cancelPurchaseOrder(id, reason), `${order!.po_no} ยกเลิกแล้ว`)
    if (kind === 'short') run(() => closePurchaseOrderShort(id, reason), `${order!.po_no} ปิดแล้ว (ร้านส่งไม่ครบ)`)
    if (kind === 'delete') run(() => deletePurchaseOrder(id, reason), `ลบร่าง ${order!.po_no} แล้ว`, () => ctx.close())
  }

  const subtotal = Number(order.subtotal) || 0
  const vat = Number(order.vat_amount) || 0
  const total = Number(order.total_amount) || 0
  const live = order.status !== 'cancelled' && order.status !== 'paid'

  const more: MoreItem[] = []
  if (order.status === 'sent' || order.status === 'partially_received') more.push({ key: 'edit', label: 'แก้ไข', onClick: () => ctx.editPo(id) })
  more.push({ key: 'print', label: 'พิมพ์ / PDF', href: `/api/procurement/orders/${id}/pdf` })
  more.push({
    key: 'copy',
    label: 'ทำสำเนา',
    onClick: () =>
      run(
        () => duplicatePurchaseOrder(id),
        'ทำสำเนาเป็นร่างแล้ว',
        (r) => {
          const created = r as { id: string }
          if (created.id) ctx.go({ type: 'PO', id: created.id })
        }
      ),
  })
  if (order.status !== 'cancelled' && order.project_id) more.push({ key: 'link', label: 'ผูกกับคำขอซื้อ', onClick: () => setLinking(true) })
  if (order.status === 'sent' || order.status === 'partially_received') {
    more.push({ key: 'short', label: 'ปิด PO (ร้านส่งไม่ครบ)', onClick: () => setAsk('short') })
  }
  if (order.status === 'sent' || order.status === 'partially_received' || order.status === 'draft') {
    more.push({ key: 'cancel', label: 'ยกเลิกใบสั่งซื้อ', onClick: () => setAsk('cancel'), danger: true })
  }
  if (order.status === 'draft') more.push({ key: 'delete', label: 'ลบร่าง', onClick: () => setAsk('delete'), danger: true })
  more.push({ key: 'full', label: 'เปิดหน้าเต็ม', href: `/dashboard/procurement/orders/${id}` })

  const primary =
    order.status === 'draft' ? (
      <Button type="button" onClick={() => run(() => setPurchaseOrderStatus(id, 'sent'), `${order.po_no} ส่งร้านแล้ว · คำขอเปลี่ยนเป็น “สั่งแล้ว” เอง`)} disabled={isPending}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ส่งใบสั่งซื้อ'}
      </Button>
    ) : order.status === 'sent' || order.status === 'partially_received' ? (
      <Button type="button" onClick={() => ctx.receive(id)}>
        รับของ
      </Button>
    ) : order.status === 'received' && unpaidReceipts.length > 0 ? (
      <Button type="button" onClick={() => ctx.pay(unpaidReceipts.map((r) => r.id))}>
        จ่ายเงิน
      </Button>
    ) : null

  const secondary =
    order.status === 'draft' ? (
      <Button type="button" variant="secondary" onClick={() => ctx.editPo(id)}>
        แก้ไข
      </Button>
    ) : null

  return (
    <>
      <DocModal
        title={`ใบสั่งซื้อ ${docNo('PO', order.po_no)}`}
        status={<StatusChip label={status.label} tone={status.tone} />}
        onClose={ctx.close}
        onBack={ctx.back ?? undefined}
        backLabel={ctx.backLabel}
        position={ctx.position}
        more={more}
        primary={primary}
        secondary={secondary}
      >
        <DocChainBar chain={chain} current={{ type: 'PO', id }} ix={ctx.ix} onGo={ctx.go} />
        {order.status === 'cancelled' ? <Hint tone="bad">ใบสั่งซื้อนี้ยกเลิกแล้ว</Hint> : <DocTrack steps={['ร่าง', 'ส่งร้านแล้ว', 'รับของ', 'จ่ายเงิน']} current={current} />}
        <DocFacts
          items={[
            { label: 'ร้าน', value: order.suppliers?.name || '-' },
            { label: 'บริษัทผู้ซื้อ', value: order.companies?.name || '-' },
            {
              label: 'สั่ง / ส่งของ',
              value: (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {fmtDate(order.order_date)} / {fmtDate(order.expected_delivery_date)}
                  {late && <WarnTag>เลยวัน</WarnTag>}
                </span>
              ),
            },
            { label: 'ยอดรวม VAT', value: `฿${formatCurrency(total)}` },
          ]}
        />

        <DocTable>
          <thead>
            <tr>
              <th>วัสดุ</th>
              <th className="n">สั่ง</th>
              <th className="n">รับแล้ว</th>
              <th className="n hidden sm:table-cell">ราคา/หน่วย</th>
              <th className="n">รวม</th>
              <th className="hidden sm:table-cell">จากคำขอ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const unit = item.unit || item.material_types?.unit || ''
              const ordered = Number(item.quantity_ordered)
              const received = Number(item.quantity_received)
              const lineTotal = ordered * Number(item.unit_price) - Number(item.discount_amount || 0)
              const prs = new Map<string, { no: number; plot: string }>()
              for (const a of item.purchase_order_item_allocations || []) {
                const r = a.purchase_request_items
                const prId = r?.purchase_request_id
                if (prId && r?.purchase_requests) {
                  prs.set(prId, { no: r.purchase_requests.pr_no, plot: r.purchase_requests.plots?.name || r.purchase_requests.plot_groups?.name || '' })
                }
              }
              return (
                <tr key={item.id}>
                  <td>
                    {item.material_types?.name || '-'}
                    {item.description && <div className="text-xs text-slate-500">{item.description}</div>}
                  </td>
                  <td className="n whitespace-nowrap">
                    {qtyText(ordered)} {unit}
                  </td>
                  <td className={`n ${ordered > 0 && received >= ordered ? 'font-semibold text-emerald-700' : ''}`}>{received > 0 ? qtyText(received) : '–'}</td>
                  <td className="n hidden sm:table-cell">{formatCurrency(Number(item.unit_price))}</td>
                  <td className="n">{formatCurrency(lineTotal)}</td>
                  <td className="hidden sm:table-cell">
                    {prs.size === 0 ? (
                      <span className="text-slate-400">–</span>
                    ) : (
                      <span className="flex flex-wrap gap-x-2">
                        {Array.from(prs.entries()).map(([prId, p]) => (
                          <button key={prId} type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => ctx.go({ type: 'PR', id: prId })}>
                            <span className="font-mono">{docNo('PR', p.no)}</span>
                            {p.plot ? <span className="ml-1 text-slate-500">{p.plot}</span> : null}
                          </button>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="hidden sm:table-cell" />
              <td className="n text-slate-500">รวม</td>
              <td className="n">{formatCurrency(subtotal)}</td>
              <td className="hidden sm:table-cell" />
            </tr>
            <tr>
              <td colSpan={3} className="hidden sm:table-cell" />
              <td className="n text-slate-500">VAT {Number(order.vat_percent)}%</td>
              <td className="n">{formatCurrency(vat)}</td>
              <td className="hidden sm:table-cell" />
            </tr>
            <tr>
              <td colSpan={3} className="hidden sm:table-cell" />
              <td className="n font-semibold">สุทธิ</td>
              <td className="n font-semibold">{formatCurrency(total)}</td>
              <td className="hidden sm:table-cell" />
            </tr>
          </tfoot>
        </DocTable>

        <details className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-slate-600">เงื่อนไข · ประวัติ</summary>
          <div className="space-y-2 pt-2">
            <p className="text-slate-600">เครดิต: {order.payment_terms || '-'}</p>
            {order.delivery_address && <p className="text-slate-600">ส่งที่: {order.delivery_address}</p>}
            {order.note && <p className="text-slate-600">หมายเหตุ: {order.note}</p>}
            <DocumentHistoryPanel key={id} target={{ kind: 'po', id }} />
          </div>
        </details>
        {live && order.status === 'draft' && <p className="text-xs text-slate-500">ร่างยังไม่ถูกส่งร้าน และคำขอซื้อยังไม่เปลี่ยนเป็น “สั่งแล้ว” จนกว่าจะส่ง</p>}
      </DocModal>

      <ReasonDialog
        isOpen={ask !== null}
        title={ask === 'cancel' ? 'ยกเลิกใบสั่งซื้อ' : ask === 'short' ? 'ปิดใบสั่งซื้อ (ร้านส่งไม่ครบ)' : 'ลบร่างใบสั่งซื้อ'}
        label="เหตุผล"
        required
        busy={isPending}
        onConfirm={confirmAsk}
        onCancel={() => setAsk(null)}
      />
      {linking && (
        <RequestPoLinkSheet
          mode="order"
          orderId={id}
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
