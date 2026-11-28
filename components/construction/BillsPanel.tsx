'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react'
import { getScopeBills, type ScopeBill } from '@/actions/construction-hubs'
import BillingModal from '@/components/billings/BillingModal'
import EmbeddedFrameModal from '@/components/construction/EmbeddedFrameModal'
import { BILL_STAGE_LABEL, StagePill, baht, billStage, fmtDateTime, type BillStage } from '@/components/construction/vocab'

type SortKey = 'created' | 'doc' | 'net' | 'stage'

/**
 * Bills for one scope (a plot, a batch, a contractor or a whole project),
 * main-work and DC bills always shown apart (`kind`). Same columns and words
 * everywhere. A bill that waits for review opens the review in a wide popup;
 * every other bill opens the read-only bill popup. Closing either stays here.
 */
export default function BillsPanel({
  projectId,
  plotIds,
  contractorId,
  kind,
  showContractor = true,
  showPlots = true,
  refreshKey = 0,
  fixedStage,
  month,
  initialSort,
  canReview = false,
}: {
  projectId?: string
  plotIds?: string[]
  contractorId?: string
  /** 'all' shows both, with a ประเภท column; the hubs always pass one kind so main and DC stay apart. */
  kind: 'main' | 'dc' | 'all'
  showContractor?: boolean
  showPlots?: boolean
  refreshKey?: number
  /** The bills inbox's tabs fix the stage; the hubs let the user filter by it. */
  fixedStage?: BillStage
  /** 'YYYY-MM' of the bill date. */
  month?: string
  initialSort?: { key: SortKey; dir: 1 | -1 }
  /** Only roles that may approve (billing) open a waiting bill in the review popup; everyone else gets the read-only bill. */
  canReview?: boolean
}) {
  const router = useRouter()
  const plotKey = (plotIds || []).join(',')
  const [state, setState] = useState<{ key: string; bills: ScopeBill[]; error: string | null } | null>(null)
  const [stage, setStage] = useState<BillStage | 'all'>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>(initialSort ?? { key: 'created', dir: -1 })
  const [viewId, setViewId] = useState<string | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const requestKey = `${projectId || ''}|${plotKey}|${contractorId || ''}|${refreshKey}|${reload}`
  useEffect(() => {
    let cancelled = false
    getScopeBills({ projectId, plotIds: plotKey ? plotKey.split(',') : undefined, contractorId })
      .then((bills) => !cancelled && setState({ key: requestKey, bills, error: null }))
      .catch((e) => !cancelled && setState({ key: requestKey, bills: [], error: e instanceof Error ? e.message : 'โหลดใบเบิกไม่สำเร็จ' }))
    return () => {
      cancelled = true
    }
  }, [projectId, plotKey, contractorId, requestKey])

  const bills = useMemo(
    () => (state?.bills || []).filter((b) => (kind === 'all' || b.kind === kind) && (!fixedStage || billStage(b) === fixedStage) && (!month || (b.billingDate || '').slice(0, 7) === month)),
    [state, kind, fixedStage, month]
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: bills.length }
    for (const b of bills) c[billStage(b)] = (c[billStage(b)] || 0) + 1
    return c
  }, [bills])

  const visible = useMemo(() => {
    const list = bills.filter((b) => stage === 'all' || billStage(b) === stage)
    const order: Record<BillStage, number> = { review: 0, pay: 1, returned: 2, paid: 3, other: 4 }
    return [...list].sort((a, b) => {
      let d = 0
      if (sort.key === 'created') d = String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      else if (sort.key === 'doc') d = a.docNo.localeCompare(b.docNo, undefined, { numeric: true })
      else if (sort.key === 'net') d = a.netAmount - b.netAmount
      else d = order[billStage(a)] - order[billStage(b)]
      return d * sort.dir
    })
  }, [bills, stage, sort])

  const total = visible.reduce((s, b) => s + b.netAmount, 0)
  const head = (key: SortKey, label: string, right?: boolean) => (
    <th className={right ? 'text-right' : ''}>
      <button type="button" onClick={() => setSort((p) => (p.key === key ? { key, dir: p.dir === 1 ? -1 : 1 } : { key, dir: -1 }))} className="inline-flex items-center gap-0.5 font-semibold hover:text-slate-900">
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
      </button>
    </th>
  )

  const done = useCallback(() => {
    setReviewId(null)
    setReload((n) => n + 1)
    router.refresh()
  }, [router])

  if (!state || state.key !== requestKey) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดใบเบิก...
      </p>
    )
  }
  if (state.error) return <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{state.error}</p>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(fixedStage ? [] : (['all', 'review', 'pay', 'paid', 'returned'] as const)).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={stage === s}
              onClick={() => setStage(s)}
              className={`rounded-full border px-3 py-1 text-xs ${stage === s ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              {s === 'all' ? 'ทั้งหมด' : BILL_STAGE_LABEL[s]} {counts[s] || 0}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">
          {visible.length} ใบ · รวม <b className="tabular-nums text-slate-800">{baht(total)}</b>
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">{fixedStage ? `ไม่มีใบเบิกที่${BILL_STAGE_LABEL[fixedStage]}` : kind === 'dc' ? 'ยังไม่มีใบเบิกงานเพิ่ม (DC)' : 'ยังไม่มีใบเบิกงานหลัก'}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full table-fixed text-sm [&_td]:px-3 [&_td]:py-1.5 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-slate-500">
            <thead className="bg-slate-50">
              <tr>
                {head('created', 'สร้างเมื่อ')}
                {head('doc', 'เลขที่')}
                {showContractor && <th>ผู้รับเหมา</th>}
                {kind === 'all' && <th className="w-[8%]">ประเภท</th>}
                {showPlots && <th>แปลง</th>}
                <th className="w-[26%]">รายการ</th>
                {head('net', 'ยอดสุทธิ', true)}
                {head('stage', 'สถานะ')}
              </tr>
            </thead>
            <tbody>
              {visible.map((b) => {
                const st = billStage(b)
                return (
                  <tr key={b.id} onClick={() => (st === 'review' && canReview ? setReviewId(b.id) : setViewId(b.id))} className="cursor-pointer border-t border-slate-100 align-top hover:bg-slate-50">
                    <td className="whitespace-nowrap text-xs text-slate-600">{fmtDateTime(b.createdAt)}</td>
                    <td className="font-medium text-indigo-700">#{b.docNo}</td>
                    {showContractor && <td className="truncate" title={b.contractorName}>{b.contractorName || '-'}</td>}
                    {kind === 'all' && <td className="text-xs">{b.kind === 'dc' ? 'DC' : 'งานหลัก'}</td>}
                    {showPlots && <td className="truncate text-xs text-slate-600" title={b.plotNames.join(', ')}>{b.plotNames.length ? b.plotNames.join(', ') : '-'}</td>}
                    <td className="truncate text-xs text-slate-600" title={b.lines.join(' · ')}>{b.lines.join(' · ') || '-'}</td>
                    <td className="text-right font-semibold tabular-nums text-slate-900">{baht(b.netAmount)}</td>
                    <td><StagePill stage={st} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <BillingModal billingId={viewId} onClose={() => setViewId(null)} onDeleted={() => { setViewId(null); setReload((n) => n + 1) }} />
      <EmbeddedFrameModal
        isOpen={reviewId != null}
        title="ตรวจสอบใบเบิก"
        src={reviewId ? `/dashboard/billing/${reviewId}/review` : ''}
        stayWhile={(p) => /^\/dashboard\/billing\/[^/]+\/review/.test(p)}
        onClose={done}
        onDone={done}
      />
    </div>
  )
}
