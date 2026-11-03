'use client'

import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { DOC_TONE_CLASS, DOC_TYPE_LABEL, type DocTone, type DocType } from '@/lib/status-labels'
import { refNo, isReceiptPaid, type Chain, type DocRef, type WorkIndex } from '@/lib/procurement/workQueue'
import { GROUP_CLASS, type Now } from '@/lib/procurement/nowStatus'

/** The one status chip every list and window uses. */
export function StatusChip({ label, tone, className }: { label: string; tone: DocTone; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', DOC_TONE_CLASS[tone], className)}>
      {label}
    </span>
  )
}

/** Small warning tags next to a status ("เลยวัน", "เกิน BOQ"). They warn; they never block. */
export function WarnTag({ children, tone = 'bad' }: { children: ReactNode; tone?: 'bad' | 'late' }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', tone === 'bad' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700')}>
      {children}
    </span>
  )
}

const CHAIN_ORDER: DocType[] = ['PR', 'PO', 'RI', 'PP']

/** PR › PO › receipt › payment: every related document, one click each. */
export function DocChainBar({
  chain,
  current,
  ix,
  onGo,
}: {
  chain: Chain
  current: DocRef
  ix: WorkIndex
  onGo: (ref: DocRef) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-4">
      {CHAIN_ORDER.map((type) => {
        const refs = chain[type]
        return (
          <div key={type} className={cn('flex min-w-0 flex-col gap-0.5 bg-white px-3 py-2', current.type === type && 'bg-indigo-50/60')}>
            <span className="text-[11px] text-slate-500">{DOC_TYPE_LABEL[type]}</span>
            {refs.length === 0 ? (
              <span className="text-xs text-slate-400">ยังไม่มี</span>
            ) : (
              <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                {refs.map((ref) =>
                  ref.type === current.type && ref.id === current.id ? (
                    <b key={ref.id} className="font-mono text-xs font-semibold text-slate-900">
                      {refNo(ref, ix)}
                    </b>
                  ) : (
                    <button key={ref.id} type="button" onClick={() => onGo(ref)} className="font-mono text-xs font-medium text-indigo-600 hover:underline">
                      {refNo(ref, ix)}
                    </button>
                  )
                )}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Where this document is on its way: finished steps filled, the current one marked. */
export function DocTrack({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-1 overflow-x-auto text-xs" aria-label="ขั้นตอน">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-1">
          <span
            className={cn(
              'whitespace-nowrap rounded-full px-2.5 py-1',
              i < current && 'bg-emerald-50 text-emerald-700',
              i === current && 'bg-indigo-600 font-medium text-white',
              i > current && 'bg-slate-100 text-slate-500'
            )}
          >
            {i < current ? '✓ ' : ''}
            {label}
          </span>
          {i < steps.length - 1 && <span className="text-slate-300">›</span>}
        </li>
      ))}
    </ol>
  )
}

/** The "ตอนนี้" box at the top of every window: what is happening, in one
 * sentence, with the buttons that move it on. */
export function NowBox({ now, children }: { now: Now; children?: ReactNode }) {
  const g = GROUP_CLASS[now.group]
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border-l-[5px] px-4 py-3 sm:flex-row sm:items-center', g.soft, g.border)}>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-slate-500">ตอนนี้</div>
        <div className={cn('text-[19px] font-bold leading-tight', g.word)}>{now.word}</div>
        <p className="mt-1 text-sm text-slate-700">{now.text}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-stretch">{children}</div>}
    </div>
  )
}

const STEP_LABELS = ['คำขอซื้อ', 'ใบสั่งซื้อ', 'รับของ', 'จ่ายเงิน']
const STEP_TYPES: DocType[] = ['PR', 'PO', 'RI', 'PP']

/** One strip of four steps replaces the old chain bar and step track: each
 * box holds the document numbers, a small state line, and marks where this
 * document is stuck. */
export function DocSteps({ chain, current, ix, now, onGo }: { chain: Chain; current: DocRef; ix: WorkIndex; now: Now | null; onGo: (ref: DocRef) => void }) {
  const stuck = now ? now.step : 4

  const requests = chain.PR.map((r) => ix.requestById.get(r.id)).filter((r): r is NonNullable<typeof r> => Boolean(r))
  const orders = chain.PO.map((r) => ix.orderById.get(r.id)).filter((r): r is NonNullable<typeof r> => Boolean(r))
  const receipts = chain.RI.map((r) => ix.receiptById.get(r.id)).filter((r): r is NonNullable<typeof r> => Boolean(r))

  const lines: string[] = ['', '', '', '']
  if (requests[0]) {
    const st = requests[0].status
    lines[0] = st === 'pending_review' ? 'รออนุมัติ' : st === 'rejected' ? 'ไม่อนุมัติ' : st === 'cancelled' ? 'ยกเลิก' : 'อนุมัติแล้ว'
  }
  if (orders.length > 0) {
    if (orders.every((o) => o.status === 'draft')) lines[1] = 'ร่าง'
    else if (requests[0] && current.type === 'PR') {
      const items = (requests[0].purchase_request_items || []).filter((i) => i.line_status !== 'closed')
      const ordered = items.filter((i) => i.line_status !== 'open').length
      lines[1] = `สั่งแล้ว ${ordered} จาก ${items.length} รายการ`
    } else lines[1] = 'ส่งร้านแล้ว'
    const anyIn = orders.some((o) => (o.purchase_order_items || []).some((i) => Number(i.quantity_received) > 0))
    const allIn = orders.every((o) => o.status === 'received' || o.status === 'paid')
    lines[2] = allIn ? 'มาครบ' : anyIn ? 'มาบางส่วน' : ''
  }
  if (receipts.length > 0) {
    const paid = receipts.filter(isReceiptPaid).length
    lines[3] = paid === receipts.length ? 'จ่ายครบ' : paid > 0 ? `จ่ายแล้ว ${paid} จาก ${receipts.length} ใบ` : ''
  }

  return (
    <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-4" aria-label="ขั้นตอน">
      {STEP_TYPES.map((type, i) => {
        const refs = chain[type]
        const done = i < stuck
        const here = i === stuck
        return (
          <li key={type} className={cn('flex min-w-0 flex-col gap-0.5 bg-white px-3 py-2', here && 'bg-white outline outline-2 -outline-offset-2 outline-amber-400')}>
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[10px]', done ? 'bg-emerald-500 text-white' : here ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-600')}>
                {done ? '✓' : i + 1}
              </span>
              {STEP_LABELS[i]}
            </span>
            {refs.length === 0 ? (
              <span className="text-xs text-slate-400">ยังไม่มี</span>
            ) : (
              <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                {refs.map((ref) =>
                  ref.type === current.type && ref.id === current.id ? (
                    <b key={ref.id} className="font-mono text-xs font-semibold text-slate-900">
                      {refNo(ref, ix)}
                    </b>
                  ) : (
                    <button key={ref.id} type="button" onClick={() => onGo(ref)} className="font-mono text-xs font-medium text-indigo-600 hover:underline">
                      {refNo(ref, ix)}
                    </button>
                  )
                )}
              </span>
            )}
            <span className="text-[11px] text-slate-500">{lines[i] || (here && refs.length === 0 ? 'ค้างอยู่ตรงนี้' : '\u00a0')}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Four key facts, same strip on every document. */
export function DocFacts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[11px] text-slate-500">{it.label}</dt>
          <dd className="mt-0.5 text-sm font-semibold text-slate-800">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A yellow one-liner for something worth knowing. Never a stop. */
export function Hint({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <div className={cn('rounded-lg px-3 py-2 text-sm', tone === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700')}>{children}</div>
  )
}

/** The table every document uses: same look, columns differ by document. */
export function DocTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full table-fixed text-sm sm:table-auto [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-medium [&_th]:text-slate-500 [&_thead]:bg-slate-50 [&_tbody_tr]:border-t [&_tbody_tr]:border-slate-100 [&_tfoot_tr]:border-t [&_tfoot_tr]:border-slate-100 [&_.n]:text-right [&_.n]:tabular-nums">
        {children}
      </table>
    </div>
  )
}

export type MoreItem = { key: string; label: string; onClick?: () => void; href?: string; danger?: boolean }

/** "⋯ อื่นๆ": everything that is not the one main button. */
function MoreMenu({ items }: { items: MoreItem[] }) {
  if (items.length === 0) return null
  return (
    <details className="group relative">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-[10px] border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <MoreHorizontal className="h-4 w-4" /> อื่นๆ
      </summary>
      <div className="absolute bottom-full left-0 z-10 mb-2 flex min-w-[220px] flex-col rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
        {items.map((it) =>
          it.href ? (
            <a
              key={it.key}
              href={it.href}
              target={it.href.startsWith('/api/') ? '_blank' : undefined}
              rel="noreferrer"
              className={cn('px-3 py-2 text-left text-sm hover:bg-slate-50', it.danger ? 'text-red-600' : 'text-slate-700')}
            >
              {it.label}
            </a>
          ) : (
            <button
              key={it.key}
              type="button"
              onClick={(e) => {
                ;(e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open')
                it.onClick?.()
              }}
              className={cn('px-3 py-2 text-left text-sm hover:bg-slate-50', it.danger ? 'text-red-600' : 'text-slate-700')}
            >
              {it.label}
            </button>
          )
        )}
      </div>
    </details>
  )
}

export type DocPosition = { index: number; total: number; onPrev?: () => void; onNext?: () => void }

/**
 * The window around every document: back link, title, status chip, a body,
 * and a footer with previous/next, "⋯ อื่นๆ", at most one secondary button
 * and ONE main button.
 */
export function DocModal({
  title,
  status,
  now,
  onClose,
  backLabel,
  onBack,
  position,
  more,
  secondary,
  primary,
  children,
}: {
  title: string
  status?: ReactNode
  /** When given, the "ตอนนี้" box at the top carries the status and the main buttons. */
  now?: Now | null
  onClose: () => void
  backLabel?: string | null
  onBack?: () => void
  position?: DocPosition | null
  more?: MoreItem[]
  secondary?: ReactNode
  primary?: ReactNode
  children: ReactNode
}) {
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={title}
      panelClassName="max-w-4xl h-[90dvh]"
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {position && position.total > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={position.onPrev}
                disabled={!position.onPrev}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                aria-label="ใบก่อน"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-1 text-xs tabular-nums text-slate-500">
                {position.index + 1} / {position.total}
              </span>
              <button
                type="button"
                onClick={position.onNext}
                disabled={!position.onNext}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                aria-label="ใบถัดไป"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          <MoreMenu items={more || []} />
          <span className="flex-1" />
          {!now && secondary}
          {!now && primary}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {onBack && backLabel && (
            <button type="button" onClick={onBack} className="inline-flex items-center gap-0.5 text-sm font-medium text-indigo-600 hover:underline">
              <ChevronLeft className="h-4 w-4" /> กลับไป {backLabel}
            </button>
          )}
          {!now && status}
        </div>
        {now && (
          <NowBox now={now}>
            {primary}
            {secondary}
          </NowBox>
        )}
        {children}
      </div>
    </Modal>
  )
}

export const qtyText = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 4 })

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

/** "2 พ.ย. 08:10": when a document was made. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const day = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })
  const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' })
  return `${day} ${time}`
}
