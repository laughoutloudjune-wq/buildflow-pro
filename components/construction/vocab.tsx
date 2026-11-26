import Link from 'next/link'
import { formatCurrency } from '@/lib/currency'
import type { ScopeBill } from '@/actions/construction-hubs'

/**
 * One vocabulary for the whole construction side (plot, batch, contractor,
 * board and bills inbox). The same five money words and three status words
 * everywhere, so a number never changes name between screens.
 */
export const MONEY = {
  contract: 'ค่าแรงตามสัญญา',
  paid: 'จ่ายแล้ว',
  left: 'เหลือจ่าย',
  dc: 'งานเพิ่ม (DC)',
  material: 'วัสดุ',
} as const

export type HubStatus = 'ok' | 'watch' | 'over'

export const HUB_STATUS: Record<HubStatus, { label: string; cls: string }> = {
  ok: { label: 'ปกติ', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  watch: { label: 'ต้องดู', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  over: { label: 'เกิน', cls: 'bg-red-50 text-red-700 ring-red-200' },
}

export const baht = (n: number | null | undefined) => (n == null ? '—' : `฿${formatCurrency(n)}`)
export const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n)}%`)

export function StatusPill({ status, label }: { status: HubStatus; label?: string }) {
  const s = HUB_STATUS[status]
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>{label ?? s.label}</span>
}

export type BillStage = 'review' | 'pay' | 'paid' | 'returned' | 'other'

export const BILL_STAGE_LABEL: Record<BillStage, string> = {
  review: 'รอตรวจ',
  pay: 'รอจ่าย',
  paid: 'จ่ายแล้ว',
  returned: 'ส่งกลับ',
  other: '-',
}

const STAGE_CLS: Record<BillStage, string> = {
  review: 'bg-amber-50 text-amber-800 ring-amber-200',
  pay: 'bg-sky-50 text-sky-700 ring-sky-200',
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  returned: 'bg-red-50 text-red-700 ring-red-200',
  other: 'bg-slate-100 text-slate-600 ring-slate-200',
}

export function billStage(b: Pick<ScopeBill, 'status' | 'paidOutAt'>): BillStage {
  if (b.status === 'pending_review') return 'review'
  if (b.status === 'rejected') return 'returned'
  if (b.status === 'approved') return b.paidOutAt ? 'paid' : 'pay'
  return 'other'
}

export function StagePill({ stage }: { stage: BillStage }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STAGE_CLS[stage]}`}>{BILL_STAGE_LABEL[stage]}</span>
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('th-TH', { year: '2-digit', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
}

export function Tile({ label, value, sub, tone, href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'red' | 'amber' | 'default'; href?: string }) {
  const toneCls = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900'
  const body = (
    <>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </>
  )
  const cls = 'rounded-xl border border-slate-200 bg-white p-3'
  return href ? (
    <Link href={href} className={`${cls} block hover:border-slate-300`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
