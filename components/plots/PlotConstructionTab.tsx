'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import type { PlotJobRow } from '@/lib/types/plotDetail'
import PlotProgressSummary from '@/components/plots/PlotProgressSummary'
import { earnedForJob, paidAheadForJob, type ProgressState, type ProgressSummary } from '@/lib/cost-control/progress'
import type { PlotExtraWorkRow } from '@/actions/_shared/plot-cost'

const STATUS_LABEL: Record<string, string> = {
  pending: 'รอเริ่ม',
  in_progress: 'กำลังทำ',
  completed: 'เสร็จสิ้น',
}
const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
}

type Contractor = { id: string; name: string }
type Filter = 'all' | 'ahead' | 'doing' | 'nocrew'

function Bar({ value, done }: { value: number | null; done?: boolean }) {
  return (
    <span className="relative block h-2 min-w-[60px] flex-1 rounded-full bg-slate-100" aria-hidden>
      {value != null && <span className={`absolute inset-y-0 left-0 rounded-full ${done ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min(100, value)}%` }} />}
    </span>
  )
}

export default function PlotConstructionTab({
  jobs,
  contractors,
  canEdit,
  isPending,
  priceDrafts,
  onPriceDraftChange,
  onSaveVariablePrice,
  onResetVariablePrice,
  onAssign,
  onStatusChange,
  progressSummary,
  expectedPercent,
  progressHealth,
  extraWork,
}: {
  jobs: PlotJobRow[]
  contractors: Contractor[]
  canEdit: boolean
  isPending: boolean
  priceDrafts: Record<string, string>
  onPriceDraftChange: (jobId: string, value: string) => void
  onSaveVariablePrice: (job: PlotJobRow) => void
  onResetVariablePrice: (job: PlotJobRow) => void
  onAssign: (jobId: string, contractorId: string) => void
  onStatusChange: (jobId: string, status: string) => void
  progressSummary?: ProgressSummary
  expectedPercent?: number | null
  progressHealth?: ProgressState
  extraWork?: PlotExtraWorkRow[]
}) {
  // Sales (canSeeCost=false, so every job.cost is null) sees job name and
  // status only - no contractor, price, budget or paid figures at all, per
  // SALES_MODULE_PLAN.md §8.3. Not blanked cells: those parts are never rendered.
  const showCost = jobs.length === 0 || jobs.some((j) => j.cost)

  const [filter, setFilter] = useState<Filter>('all')
  const [openTrades, setOpenTrades] = useState<Set<string>>(new Set())
  const [openJobs, setOpenJobs] = useState<Set<string>>(new Set())
  const [dcOpen, setDcOpen] = useState(false)

  const jobCost = (job: PlotJobRow) => (job.cost ? { value: job.cost.totalBoq, progressPercent: job.progressPercent, paid: job.cost.paid } : null)
  const aheadOf = (job: PlotJobRow) => {
    const c = jobCost(job)
    return c ? paidAheadForJob(c) : 0
  }

  const counts = {
    all: jobs.length,
    ahead: jobs.filter((j) => aheadOf(j) > 0).length,
    doing: jobs.filter((j) => j.status === 'in_progress').length,
    nocrew: jobs.filter((j) => !j.contractorId).length,
  }
  const visible = jobs.filter((j) => filter === 'all' || (filter === 'ahead' && aheadOf(j) > 0) || (filter === 'doing' && j.status === 'in_progress') || (filter === 'nocrew' && !j.contractorId))

  // Jobs by trade: the trades being worked first, finished ones next, untouched last.
  const trades = useMemo(() => {
    const by = new Map<string, PlotJobRow[]>()
    for (const j of visible) by.set(j.tradeName || 'งานอื่นๆ', [...(by.get(j.tradeName || 'งานอื่นๆ') || []), j])
    const rank = (list: PlotJobRow[]) => {
      const done = list.every((j) => j.status === 'completed')
      const started = list.some((j) => j.status !== 'pending')
      return started && !done ? 0 : done ? 1 : 2
    }
    return [...by.entries()].sort((a, b) => rank(a[1]) - rank(b[1]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, filter])

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setter(next)
  }

  const approvedExtra = (extraWork || []).filter((e) => e.status === 'approved')
  const pendingExtra = (extraWork || []).filter((e) => e.status !== 'approved')
  const approvedExtraTotal = approvedExtra.reduce((sum, e) => sum + e.value, 0)
  const pendingExtraTotal = pendingExtra.reduce((sum, e) => sum + e.value, 0)

  if (jobs.length === 0) return <div className="py-12 text-center text-slate-500">ยังไม่มีรายการงาน</div>

  // ---- Sales view: names and status only ------------------------------------
  if (!showCost) {
    return (
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {jobs.map((job) => (
          <div key={job.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <span>
              <span className="font-medium text-slate-800">{job.itemName}</span>
              <span className="ml-2 text-xs text-slate-500">
                {job.quantity} {job.unit}
              </span>
            </span>
            <span className={`rounded px-2 py-1 text-xs font-bold ${STATUS_CLASS[job.status] || STATUS_CLASS.pending}`}>{STATUS_LABEL[job.status] || job.status}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {progressSummary && <PlotProgressSummary summary={progressSummary} expectedPercent={expectedPercent ?? null} health={progressHealth ?? 'unknown'} />}

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['all', `ทั้งหมด ${counts.all}`],
            ['ahead', `จ่ายเกินงาน ${counts.ahead}`],
            ['doing', `กำลังทำ ${counts.doing}`],
            ['nocrew', `ยังไม่มีช่าง ${counts.nocrew}`],
          ] as const
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs ${filter === f ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        {trades.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">ไม่มีงานในตัวกรองนี้</p>}
        {trades.map(([trade, list]) => {
          const value = list.reduce((s, j) => s + (j.cost?.totalBoq ?? 0), 0)
          const earned = list.reduce((s, j) => s + (jobCost(j) ? earnedForJob(jobCost(j)!) : 0), 0)
          const pct = value > 0 ? Math.round((earned / value) * 100) : 0
          const allDone = list.every((j) => j.status === 'completed')
          const started = list.some((j) => j.status !== 'pending')
          const isOpen = filter !== 'all' || openTrades.has(trade)
          return (
            <div key={trade} className="border-b border-slate-100 last:border-0">
              <button type="button" onClick={() => toggle(openTrades, setOpenTrades, trade)} aria-expanded={isOpen} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                <span>
                  <b className="font-semibold text-slate-800">{trade}</b>
                  <span className="ml-2 text-xs text-slate-500">
                    {list.length} งาน · ฿{formatCurrency(value)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${allDone ? 'bg-emerald-50 text-emerald-700' : started ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                    {allDone ? 'เสร็จ' : started ? 'กำลังทำ' : 'ยังไม่เริ่ม'}
                  </span>
                  <span className="w-10 text-right text-sm font-semibold tabular-nums">{pct}%</span>
                  <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform duration-[150ms] ${isOpen ? 'rotate-90' : ''}`} aria-hidden />
                </span>
              </button>
              {isOpen && (
                <div className="pb-1">
                  {list.map((job) => {
                    const c = jobCost(job)
                    const ahead = aheadOf(job)
                    const open = openJobs.has(job.id)
                    const pctJob = job.progressPercent == null ? null : Math.round(job.progressPercent)
                    return (
                      <div key={job.id} className="border-t border-slate-100">
                        <button type="button" onClick={() => toggle(openJobs, setOpenJobs, job.id)} aria-expanded={open} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 pl-7 pr-4 text-left">
                          <span className="min-w-0 text-sm text-slate-800">
                            {job.itemName}
                            <span className="ml-2 text-xs text-slate-500">{job.cost?.contractorName || <span className="text-amber-700">ยังไม่มีช่าง</span>}</span>
                          </span>
                          <span className="flex items-center gap-2 text-xs">
                            {ahead > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">จ่ายเกินงาน ฿{formatCurrency(ahead)}</span>}
                            <span className="tabular-nums text-slate-500">฿{formatCurrency(job.cost?.totalBoq ?? 0)}</span>
                          </span>
                          <span className="col-span-2 flex items-center gap-3">
                            <Bar value={pctJob} done={pctJob != null && pctJob >= 100} />
                            <span className="w-12 text-right text-sm font-semibold tabular-nums text-slate-800">{pctJob == null ? '—' : `${pctJob}%`}</span>
                          </span>
                        </button>
                        {open && job.cost && c && (
                          <div className="mx-4 mb-3 ml-7 space-y-3 rounded-lg bg-slate-50 p-3 text-sm">
                            <div className="grid grid-cols-3 gap-2">
                              <div className="rounded-md bg-white px-3 py-2">
                                <span className="block text-xs text-slate-500">มูลค่างาน</span>
                                <strong className="tabular-nums">฿{formatCurrency(job.cost.totalBoq)}</strong>
                              </div>
                              <div className="rounded-md bg-white px-3 py-2">
                                <span className="block text-xs text-slate-500">ทำได้ ({pctJob ?? 0}%)</span>
                                <strong className="tabular-nums">฿{formatCurrency(earnedForJob(c))}</strong>
                              </div>
                              <div className="rounded-md bg-white px-3 py-2">
                                <span className="block text-xs text-slate-500">จ่ายแล้ว</span>
                                <strong className={`tabular-nums ${ahead > 0 ? 'text-red-600' : ''}`}>฿{formatCurrency(job.cost.paid)}</strong>
                              </div>
                            </div>
                            <p className="text-xs text-slate-500">
                              {job.quantity} {job.unit} × ฿{formatCurrency(job.cost.effectivePrice)} ({job.cost.agreedPricePerUnit != null ? 'ราคาตกลง' : 'ราคา BOQ'})
                            </p>
                            {canEdit && (
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="text-xs text-slate-600">
                                    ราคาตกลง / หน่วย{' '}
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      placeholder={String(job.cost.boqPricePerUnit || 0)}
                                      value={priceDrafts[job.id] ?? ''}
                                      onChange={(e) => onPriceDraftChange(job.id, e.target.value)}
                                      className="ml-1 w-28 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                                    />
                                  </label>
                                  <button type="button" onClick={() => onSaveVariablePrice(job)} disabled={isPending} className="rounded-lg bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                                    Save
                                  </button>
                                  <button type="button" onClick={() => onResetVariablePrice(job)} disabled={isPending} className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-60">
                                    Reset
                                  </button>
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                  <label className="text-xs text-slate-600">
                                    ช่าง{' '}
                                    <select
                                      value={job.contractorId || ''}
                                      onChange={(e) => onAssign(job.id, e.target.value)}
                                      className={`ml-1 rounded border px-2 py-1 text-xs ${job.contractorId ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white'}`}
                                    >
                                      <option value="">-- ว่าง --</option>
                                      {contractors.map((ct) => (
                                        <option key={ct.id} value={ct.id}>
                                          {ct.name}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="text-xs text-slate-600">
                                    สถานะ{' '}
                                    <select
                                      value={job.status}
                                      onChange={(e) => onStatusChange(job.id, e.target.value)}
                                      disabled={!job.contractorId}
                                      className={`ml-1 rounded border-0 px-2 py-1 text-xs font-bold ${STATUS_CLASS[job.status] || STATUS_CLASS.pending}`}
                                    >
                                      <option value="pending">รอเริ่ม</option>
                                      <option value="in_progress">กำลังทำ</option>
                                      <option value="completed">เสร็จสิ้น</option>
                                    </select>
                                  </label>
                                </div>
                              </div>
                            )}
                            {!canEdit && <p className="text-xs text-slate-600">สถานะ {STATUS_LABEL[job.status] || job.status}</p>}
                            <p className="text-xs text-slate-500">
                              {job.progressPercent == null
                                ? 'ยังไม่มีความคืบหน้า'
                                : `ความคืบหน้าล่าสุด ${pctJob}% ${job.progressSource === 'weekly' ? 'จากแผนงาน' : 'จากใบเบิกงวดล่าสุดที่อนุมัติ'}`}{' '}
                              ·{' '}
                              <Link href="/dashboard/weekly-plan" className="font-medium text-indigo-600 hover:underline">
                                อัปเดตในแผนงาน ›
                              </Link>
                            </p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {extraWork && extraWork.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <button type="button" onClick={() => setDcOpen((v) => !v)} aria-expanded={dcOpen} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
            <span>
              <b className="font-semibold text-slate-800">งานเพิ่ม (DC)</b>
              <span className="ml-2 text-xs text-slate-500">
                {extraWork.length} ใบ · อนุมัติแล้ว ฿{formatCurrency(approvedExtraTotal)}
                {pendingExtra.length > 0 && ` · รออนุมัติ ฿${formatCurrency(pendingExtraTotal)}`}
              </span>
            </span>
            <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform duration-[150ms] ${dcOpen ? 'rotate-90' : ''}`} aria-hidden />
          </button>
          {dcOpen && (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {extraWork.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span>
                    {e.reason || '—'}
                    <span className="ml-2 text-xs text-slate-500">
                      {e.docNo || ''} {e.contractorName ? `· ${e.contractorName}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">฿{formatCurrency(e.value)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${e.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{e.status === 'approved' ? 'อนุมัติแล้ว' : 'รออนุมัติ'}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
