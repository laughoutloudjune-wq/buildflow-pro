'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { docNo } from '@/lib/status-labels'
import { requestLineUnit } from '@/lib/procurement/requestQuantities'
import { GROUP_CLASS, GROUP_LABEL, daysBetween, nowOf, type NowGroup } from '@/lib/procurement/nowStatus'
import {
  openLines,
  orderIsLate,
  receiptAmount,
  requestIsLate,
  requestPlotText,
  requesterName,
  type DocRef,
  type WorkIndex,
  type WorkStage,
} from '@/lib/procurement/workQueue'
import type { PurchaseOrder, PurchaseRequest } from '@/lib/types/procurement'
import { WarnTag, fmtDate, fmtDateTime, qtyText } from './docUi'

/** One grid for every section so the columns line up from section to section. */
const GRID = 'xl:grid-cols-[96px_140px_minmax(0,1fr)_88px_92px_200px_118px]'

type Section = { key: string; title: string; type: DocRef['type']; refs: DocRef[] }

/** Inside each step the rows sit in titled sections, one kind of document per section. */
export function sectionsOf(stage: WorkStage, rows: DocRef[]): Section[] {
  const of = (type: DocRef['type']) => rows.filter((r) => r.type === type)
  switch (stage) {
    case 'appr':
      return [{ key: 'pr', title: 'คำขอรออนุมัติ', type: 'PR', refs: of('PR') }]
    case 'order':
      return [
        { key: 'po', title: 'ใบสั่งซื้อร่าง ยังไม่ส่ง', type: 'PO', refs: of('PO') },
        { key: 'pr', title: 'คำขอที่ยังสั่งไม่ครบ', type: 'PR', refs: of('PR') },
      ]
    case 'recv':
      return [{ key: 'po', title: 'ใบสั่งซื้อที่รอของ', type: 'PO', refs: of('PO') }]
    case 'pay':
      return [{ key: 'ri', title: 'ใบรับของที่ยังไม่จ่าย', type: 'RI', refs: of('RI') }]
    default:
      return [
        { key: 'pp', title: 'จ่ายเงินแล้ว', type: 'PP', refs: of('PP') },
        { key: 'pr', title: 'คำขอที่จบแล้ว', type: 'PR', refs: of('PR') },
      ]
  }
}

const HEADERS: Record<DocRef['type'], string[]> = {
  PR: ['เลขที่', 'แปลง', 'ของที่ขอ', 'ผู้ขอ', 'ต้องการ', 'ตอนนี้', ''],
  PO: ['เลขที่', 'ร้าน', 'ของที่สั่ง', 'นัดส่ง', 'ยอด', 'ตอนนี้', ''],
  RI: ['เลขที่', 'ร้าน', 'ของที่รับ', 'วันที่รับ', 'ยอด', 'ตอนนี้', ''],
  PP: ['เลขที่', 'ร้าน', 'ใบรับของที่จ่าย', 'วันที่จ่าย', 'ยอด', 'ตอนนี้', ''],
}

/** The legend: what the colour bar on the left of each row means. */
export function GroupLegend() {
  const groups: NowGroup[] = ['you', 'shop', 'late', 'done']
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500" aria-label="สีแถบด้านซ้าย">
      {groups.map((g) => (
        <span key={g} className="inline-flex items-center gap-1.5">
          <span className={cn('h-2.5 w-2.5 rounded-sm', GROUP_CLASS[g].dot)} />
          {GROUP_LABEL[g]}
        </span>
      ))}
    </div>
  )
}

type Handlers = {
  onOpen: (ref: DocRef) => void
  onOrder: (ref: DocRef) => void
  onApprove: (r: PurchaseRequest) => void
  onSend: (o: PurchaseOrder) => void
  onReceive: (poId: string) => void
  onPay: (riId: string) => void
}

type PrintProps = {
  selectMode: boolean
  checked: Set<string>
  toggle: (id: string) => void
}

export function WorkSections({
  stage,
  rows,
  ix,
  today,
  overIds,
  print,
  ...handlers
}: {
  stage: WorkStage
  rows: DocRef[]
  ix: WorkIndex
  today: string
  overIds: Set<string>
  print: PrintProps
} & Handlers) {
  const sections = sectionsOf(stage, rows).filter((s) => s.refs.length > 0)
  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <section key={s.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <h3 className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
            {s.title}
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">{s.refs.length}</span>
          </h3>
          <div className={cn('hidden gap-x-3 border-b border-slate-100 px-4 py-1.5 text-[11px] font-medium text-slate-500 xl:grid', GRID)}>
            {HEADERS[s.type].map((h, i) => (
              <span key={i} className={cn(s.type !== 'PR' && i === 4 && 'text-right')}>
                {h}
              </span>
            ))}
          </div>
          <div className="divide-y divide-slate-100">
            {s.refs.map((ref) => (
              <WorkRow key={`${ref.type}:${ref.id}`} docRef={ref} ix={ix} today={today} over={ref.type === 'PR' && overIds.has(ref.id)} print={print} {...handlers} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** A labelled cell: the label shows only on a phone, where the row is a card. */
function Cell({ label, className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('order-3 col-span-2 min-w-0 text-sm text-slate-700 xl:order-none xl:col-span-1', className)}>
      {label && <span className="mr-1.5 text-[11px] text-slate-400 xl:hidden">{label}</span>}
      {children}
    </div>
  )
}

/** Up to three item lines: name on the left, quantity right-aligned so numbers line up. */
function ItemLines({ lines }: { lines: { name: string; qty: string; tone?: 'ok' | 'wait' }[] }) {
  return (
    <ul className="space-y-0.5 text-sm">
      {lines.slice(0, 3).map((l, i) => (
        <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <span className="truncate" title={l.name}>
            {l.name}
          </span>
          <span className={cn('whitespace-nowrap text-right tabular-nums', l.tone === 'ok' ? 'text-emerald-700' : 'text-slate-600')}>{l.qty}</span>
        </li>
      ))}
      {lines.length > 3 && <li className="text-xs text-slate-400">อีก {lines.length - 3} รายการ</li>}
    </ul>
  )
}

function WorkRow({
  docRef,
  ix,
  today,
  over,
  print,
  onOpen,
  onOrder,
  onApprove,
  onSend,
  onReceive,
  onPay,
}: {
  docRef: DocRef
  ix: WorkIndex
  today: string
  over: boolean
  print: PrintProps
} & Handlers) {
  const now = nowOf(docRef, ix, today)
  if (!now) return null
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  let no = ''
  let noSub = ''
  let c2 = ''
  let c2Label = ''
  let lines: { name: string; qty: string; tone?: 'ok' | 'wait' }[] = []
  let c4: ReactNode = null
  let c4Label = ''
  let c5: ReactNode = null
  let c5Label = ''
  let action: ReactNode = null

  if (docRef.type === 'PR') {
    const r = ix.requestById.get(docRef.id)!
    no = docNo('PR', r.pr_no)
    noSub = `ส่ง ${fmtDateTime(r.created_at)}`
    c2 = requestPlotText(r)
    c2Label = 'แปลง'
    lines = (r.purchase_request_items || []).map((i) => ({ name: i.material_types?.name || '-', qty: `${qtyText(Number(i.quantity_requested))} ${requestLineUnit(i)}` }))
    c4 = requesterName(r)
    c4Label = 'ผู้ขอ'
    const late = requestIsLate(r, today)
    c5 = (
      <>
        {fmtDate(r.needed_by_date)}
        {late && <span className="block text-[11px] font-medium text-red-600">เลย {daysBetween(r.needed_by_date, today)} วัน</span>}
      </>
    )
    c5Label = 'ต้องการ'
    if (r.status === 'pending_review') {
      action = (
        <Button type="button" size="sm" variant="secondary" onClick={stop(() => onApprove(r))}>
          อนุมัติ
        </Button>
      )
    } else if (r.status === 'approved' && openLines(r).length > 0) {
      action = (
        <Button type="button" size="sm" onClick={stop(() => onOrder(docRef))}>
          ออกใบสั่งซื้อ
        </Button>
      )
    }
  } else if (docRef.type === 'PO') {
    const o = ix.orderById.get(docRef.id)!
    no = docNo('PO', o.po_no)
    noSub = `สั่ง ${fmtDate(o.order_date)}`
    c2 = o.suppliers?.name || '-'
    c2Label = 'ร้าน'
    lines = (o.purchase_order_items || []).map((i) => {
      const ordered = Number(i.quantity_ordered)
      const received = Number(i.quantity_received)
      const unit = i.unit || i.material_types?.unit || ''
      return {
        name: i.material_types?.name || '-',
        qty: o.status === 'draft' ? `${qtyText(ordered)} ${unit}` : `มา ${qtyText(received)}/${qtyText(ordered)} ${unit}`,
        tone: received >= ordered && ordered > 0 ? 'ok' : 'wait',
      }
    })
    const late = orderIsLate(o, today)
    c4 = (
      <>
        {fmtDate(o.expected_delivery_date)}
        {late && <span className="block text-[11px] font-medium text-red-600">เลย {daysBetween(o.expected_delivery_date, today)} วัน</span>}
      </>
    )
    c4Label = 'นัดส่ง'
    c5 = <span className="font-semibold tabular-nums">฿{formatCurrency(Number(o.total_amount))}</span>
    c5Label = 'ยอด'
    if (o.status === 'draft') {
      action = (
        <Button type="button" size="sm" onClick={stop(() => onSend(o))}>
          ส่งใบสั่งซื้อ
        </Button>
      )
    } else if (o.status === 'sent' || o.status === 'partially_received') {
      action = (
        <Button type="button" size="sm" onClick={stop(() => onReceive(o.id))}>
          รับของ
        </Button>
      )
    }
  } else if (docRef.type === 'RI') {
    const r = ix.receiptById.get(docRef.id)!
    no = docNo('RI', r.ri_no)
    noSub = r.purchase_orders?.po_no ? docNo('PO', r.purchase_orders.po_no) : ''
    c2 = r.purchase_orders?.suppliers?.name || '-'
    c2Label = 'ร้าน'
    lines = (r.goods_receipt_items || []).map((i) => ({
      name: i.purchase_order_items?.material_types?.name || '-',
      qty: `${qtyText(Number(i.quantity_received))} ${i.purchase_order_items?.material_types?.unit || ''}`,
    }))
    c4 = fmtDate(r.received_at)
    c4Label = 'วันที่รับ'
    c5 = <span className="font-semibold tabular-nums">฿{formatCurrency(receiptAmount(r))}</span>
    c5Label = 'ยอด'
    if (now.word === 'รอจ่าย') {
      action = (
        <Button type="button" size="sm" onClick={stop(() => onPay(r.id))}>
          จ่ายเงิน
        </Button>
      )
    }
  } else {
    const v = ix.voucherById.get(docRef.id)!
    no = docNo('PP', v.pp_no)
    const n = (v.payment_voucher_receipts || []).length
    noSub = `${n} ใบรับของ`
    c2 = v.suppliers?.name || '-'
    c2Label = 'ร้าน'
    lines = (v.payment_voucher_receipts || []).map((x) => ({
      name: `${x.goods_receipts?.ri_no ? docNo('RI', x.goods_receipts.ri_no) : '-'}${x.goods_receipts?.purchase_orders?.po_no ? ` · ${docNo('PO', x.goods_receipts.purchase_orders.po_no)}` : ''}`,
      qty: `฿${formatCurrency(Number(x.amount))}`,
    }))
    c4 = fmtDate(v.payment_date)
    c4Label = 'วันที่จ่าย'
    c5 = <span className="font-semibold tabular-nums">฿{formatCurrency(Number(v.total_amount))}</span>
    c5Label = 'ยอด'
  }

  const g = GROUP_CLASS[now.group]
  const showCheck = print.selectMode && docRef.type === 'PR'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(docRef)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(docRef)
      }}
      className={cn(
        'grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-l-4 px-4 py-2.5 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/50',
        g.bar,
        GRID
      )}
    >
      <div className="order-1 min-w-0 xl:order-none">
        <div className="flex items-center gap-1.5">
          {showCheck && (
            <input
              type="checkbox"
              checked={print.checked.has(docRef.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => print.toggle(docRef.id)}
              aria-label={`เลือก ${no} เพื่อพิมพ์`}
            />
          )}
          <span className="font-mono text-sm font-semibold text-indigo-600">{no}</span>
        </div>
        {noSub && <div className="text-[11px] text-slate-500">{noSub}</div>}
        {over && <WarnTag tone="late">เกิน BOQ</WarnTag>}
      </div>
      <div className="order-2 justify-self-end xl:order-none xl:col-start-7 xl:row-start-1">{action}</div>
      <Cell label={c2Label} className="truncate xl:col-start-2 xl:row-start-1">
        <span title={c2}>{c2}</span>
      </Cell>
      <Cell className="xl:col-start-3 xl:row-start-1">
        <ItemLines lines={lines} />
      </Cell>
      <Cell label={c4Label} className="xl:col-start-4 xl:row-start-1">
        {c4}
      </Cell>
      <Cell label={c5Label} className={cn('xl:col-start-5 xl:row-start-1', docRef.type !== 'PR' && 'xl:text-right')}>
        {c5}
      </Cell>
      <Cell label="ตอนนี้" className="xl:col-start-6 xl:row-start-1">
        <div className={cn('text-sm font-bold', g.word)}>{now.word}</div>
        <div className="text-[11px] leading-snug text-slate-500">{now.sub}</div>
      </Cell>
    </div>
  )
}
