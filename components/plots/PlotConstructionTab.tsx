'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Pencil, Plus } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import type { PlotJobRow } from '@/lib/types/plotDetail'
import PlotProgressSummary from '@/components/plots/PlotProgressSummary'
import { useToast } from '@/components/ui/Toast'
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
/** The next step a tap on the status pill moves to. A finished job steps back to กำลังทำ. */
const NEXT_STATUS: Record<string, string> = { pending: 'in_progress', in_progress: 'completed', completed: 'in_progress' }

type Contractor = { id: string; name: string }
type Filter = 'all' | 'ahead' | 'doing' | 'nocrew'
type Scope = 'empty' | 'all'
type Picker = { kind: 'job'; jobId: string; thenStart: boolean } | { kind: 'trade'; trade: string } | { kind: 'bulk' }

function Bar({ value, done }: { value: number | null; done?: boolean }) {
  return (
    <span className="relative block h-1.5 min-w-[60px] flex-1 rounded-full bg-slate-100" aria-hidden>
      {value != null && <span className={`absolute inset-y-0 left-0 rounded-full ${done ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min(100, value)}%` }} />}
    </span>
  )
}

/** Pick a crew from a searchable list. Trade pickers also ask which jobs to apply it to. */
function CrewPicker({
  title,
  contractors,
  currentId,
  note,
  scope,
  onPick,
  onClose,
}: {
  title: string
  contractors: Contractor[]
  currentId?: string | null
  note?: string
  scope?: { emptyCount: number; totalCount: number }
  onPick: (contractorId: string, scope: Scope) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [chosenScope, setChosenScope] = useState<Scope>('empty')
  const list = contractors.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/20" onClick={onClose} aria-hidden />
      <div role="dialog" aria-label={title} className="fixed left-1/2 top-24 z-50 w-[min(24rem,92vw)] -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <b className="text-sm text-slate-800">{title}</b>
          <button type="button" onClick={onClose} className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100">
            ปิด
          </button>
        </div>
        {scope && (
          <div className="mb-2 space-y-1 rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" name="scope" checked={chosenScope === 'empty'} onChange={() => setChosenScope('empty')} />
              เฉพาะงานที่ยังไม่มีช่าง ({scope.emptyCount} งาน)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" name="scope" checked={chosenScope === 'all'} onChange={() => setChosenScope('all')} />
              ทุกงานในหมวด ({scope.totalCount} งาน)
            </label>
          </div>
        )}
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาชื่อช่าง..."
          className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {list.length === 0 && <p className="px-2 py-3 text-center text-xs text-slate-500">ไม่พบช่าง</p>}
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c.id, chosenScope)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-indigo-50 ${c.id === currentId ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-800'}`}
            >
              {c.name}
              {c.id === currentId && <span className="text-xs">ช่างปัจจุบัน</span>}
            </button>
          ))}
        </div>
        {currentId != null && (
          <button type="button" onClick={() => onPick('', chosenScope)} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
            เอาช่างออก
          </button>
        )}
        {note && <p className="mt-2 text-[11px] text-amber-700">{note}</p>}
      </div>
    </>
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
  const toast = useToast()
  // Sales (canSeeCost=false, so every job.cost is null) sees job name and
  // status only - no contractor, price, budget or paid figures at all, per
  // SALES_MODULE_PLAN.md §8.3. Not blanked cells: those parts are never rendered.
  const showCost = jobs.length === 0 || jobs.some((j) => j.cost)

  const [filter, setFilter] = useState<Filter>('all')
  const [doneOpen, setDoneOpen] = useState(false)
  const [dcOpen, setDcOpen] = useState(false)
  const [editPriceId, setEditPriceId] = useState<string | null>(null)
  const [picker, setPicker] = useState<Picker | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [undo, setUndo] = useState<{ jobId: string; from: string; name: string; to: string } | null>(null)

  // The undo bar goes away by itself.
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 7000)
    return () => clearTimeout(t)
  }, [undo])

  const jobCost = (job: PlotJobRow) => (job.cost ? { value: job.cost.totalBoq, progressPercent: job.progressPercent, paid: job.cost.paid } : null)
  const aheadOf = (job: PlotJobRow) => {
    const c = jobCost(job)
    return c ? paidAheadForJob(c) : 0
  }
  const crewName = (job: PlotJobRow) => contractors.find((c) => c.id === job.contractorId)?.name ?? job.cost?.contractorName ?? null

  const counts = {
    all: jobs.length,
    ahead: jobs.filter((j) => aheadOf(j) > 0).length,
    doing: jobs.filter((j) => j.status === 'in_progress').length,
    nocrew: jobs.filter((j) => !j.contractorId).length,
  }
  const visible = jobs.filter((j) => filter === 'all' || (filter === 'ahead' && aheadOf(j) > 0) || (filter === 'doing' && j.status === 'in_progress') || (filter === 'nocrew' && !j.contractorId))

  // Jobs by trade. Trades being worked come first, untouched ones next; finished trades fold away.
  const { openTrades, doneTrades } = useMemo(() => {
    const by = new Map<string, PlotJobRow[]>()
    for (const j of visible) by.set(j.tradeName || 'งานอื่นๆ', [...(by.get(j.tradeName || 'งานอื่นๆ') || []), j])
    const all = [...by.entries()]
    const isDone = (list: PlotJobRow[]) => list.every((j) => j.status === 'completed')
    const rank = (list: PlotJobRow[]) => (list.some((j) => j.status !== 'pending') ? 0 : 1)
    return {
      openTrades: all.filter(([, l]) => !isDone(l)).sort((a, b) => rank(a[1]) - rank(b[1])),
      doneTrades: all.filter(([, l]) => isDone(l)),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, filter])

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

  // ---- Actions ---------------------------------------------------------------
  // Changing the crew sends the job back to รอเริ่ม (the server does this), so a
  // job is only re-assigned when the crew really changes.
  const assignJob = (job: PlotJobRow, contractorId: string) => {
    if (contractorId === (job.contractorId || '')) return false
    onAssign(job.id, contractorId)
    return true
  }
  const stepStatus = (job: PlotJobRow) => {
    const to = NEXT_STATUS[job.status] || 'in_progress'
    onStatusChange(job.id, to)
    setUndo({ jobId: job.id, from: job.status, to, name: job.itemName })
  }
  const jobById = (id: string) => jobs.find((j) => j.id === id)

  const handlePick = (contractorId: string, scope: Scope) => {
    if (!picker) return
    if (picker.kind === 'job') {
      const job = jobById(picker.jobId)
      if (job) {
        assignJob(job, contractorId)
        // A job with no crew yet that was started from its status pill goes straight to กำลังทำ.
        if (picker.thenStart && contractorId) onStatusChange(job.id, 'in_progress')
      }
    } else if (picker.kind === 'trade') {
      const list = (visible.filter((j) => (j.tradeName || 'งานอื่นๆ') === picker.trade))
      const targets = list.filter((j) => scope === 'all' || !j.contractorId)
      let changed = 0
      for (const j of targets) if (assignJob(j, contractorId)) changed++
      if (changed > 0) toast.success(contractorId ? `ใส่ช่างให้ ${changed} งานแล้ว` : `เอาช่างออกจาก ${changed} งานแล้ว`)
    } else {
      let changed = 0
      for (const id of selected) {
        const j = jobById(id)
        if (j && assignJob(j, contractorId)) changed++
      }
      toast.success(`${contractorId ? 'ใส่ช่างให้' : 'เอาช่างออกจาก'} ${changed} งานแล้ว`)
      setSelected(new Set())
    }
    setPicker(null)
  }

  const bulkStatus = (status: string) => {
    let skipped = 0
    let done = 0
    for (const id of selected) {
      const j = jobById(id)
      if (!j || j.status === status) continue
      if (!j.contractorId) {
        skipped++
        continue
      }
      onStatusChange(j.id, status)
      done++
    }
    toast.success(`ตั้งสถานะ ${STATUS_LABEL[status]} ให้ ${done} งานแล้ว`)
    if (skipped > 0) toast.info(`ข้าม ${skipped} งานที่ยังไม่มีช่าง (ต้องใส่ช่างก่อน)`)
    setSelected(new Set())
  }

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // ---- Summary ---------------------------------------------------------------
  const totalValue = jobs.reduce((s, j) => s + (j.cost?.totalBoq ?? 0), 0)
  const totalEarned = jobs.reduce((s, j) => s + (jobCost(j) ? earnedForJob(jobCost(j)!) : 0), 0)
  const totalPaid = jobs.reduce((s, j) => s + (j.cost?.paid ?? 0), 0)
  const earnedPct = totalValue > 0 ? Math.round((totalEarned / totalValue) * 100) : 0

  const renderJob = (job: PlotJobRow) => {
    const ahead = aheadOf(job)
    const pctJob = job.progressPercent == null ? null : Math.round(job.progressPercent)
    const name = crewName(job)
    const editingPrice = editPriceId === job.id
    const agreed = job.cost?.agreedPricePerUnit ?? null
    return (
      <div key={job.id} className="border-t border-slate-100 py-2.5 pl-4 pr-3 sm:pl-6">
        <div className="flex items-start gap-2">
          {selectMode && canEdit && (
            <input type="checkbox" checked={selected.has(job.id)} onChange={() => toggleSelected(job.id)} className="mt-1 h-4 w-4 rounded border-slate-300" aria-label={`เลือก ${job.itemName}`} />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 text-sm text-slate-800">{job.itemName}</span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setPicker({ kind: 'job', jobId: job.id, thenStart: false })}
                  className={`rounded-full border px-2 py-0.5 text-xs ${name ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 'border-dashed border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100'}`}
                >
                  {name || '+ ช่าง'}
                </button>
              ) : (
                <span className="text-xs text-slate-500">{name || <span className="text-amber-700">ยังไม่มีช่าง</span>}</span>
              )}
              {canEdit ? (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => (job.contractorId ? stepStatus(job) : setPicker({ kind: 'job', jobId: job.id, thenStart: true }))}
                  title={job.contractorId ? `กดเพื่อเปลี่ยนเป็น ${STATUS_LABEL[NEXT_STATUS[job.status]]}` : 'ใส่ช่างก่อน แล้วเริ่มงาน'}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_CLASS[job.status] || STATUS_CLASS.pending} ${job.contractorId ? 'hover:brightness-95' : 'opacity-70'}`}
                >
                  {STATUS_LABEL[job.status] || job.status}
                </button>
              ) : (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_CLASS[job.status] || STATUS_CLASS.pending}`}>{STATUS_LABEL[job.status] || job.status}</span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              จ่ายแล้ว <span className={`tabular-nums ${ahead > 0 ? 'font-medium text-red-600' : ''}`}>฿{formatCurrency(job.cost?.paid ?? 0)}</span>
              {ahead > 0 && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">จ่ายเกินงาน ฿{formatCurrency(ahead)}</span>}
            </p>
          </div>

          <div className="shrink-0 text-right text-xs">
            {canEdit ? (
              <button type="button" onClick={() => setEditPriceId(editingPrice ? null : job.id)} className="group inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-100" title="แก้ราคาตกลง">
                <span className="tabular-nums font-medium text-slate-800">฿{formatCurrency(job.cost?.totalBoq ?? 0)}</span>
                <Pencil className="h-3 w-3 text-slate-400 group-hover:text-indigo-600" aria-hidden />
              </button>
            ) : (
              <span className="tabular-nums font-medium text-slate-800">฿{formatCurrency(job.cost?.totalBoq ?? 0)}</span>
            )}
            <span className="block text-slate-500">
              {job.quantity} {job.unit} × ฿{formatCurrency(job.cost?.effectivePrice ?? 0)} {agreed != null ? '(ราคาตกลง)' : '(BOQ)'}
            </span>
          </div>
        </div>

        <div className="mt-1.5 flex items-center gap-3 pl-0 sm:pl-0">
          <Bar value={pctJob} done={pctJob != null && pctJob >= 100} />
          <span className="w-10 text-right text-xs font-semibold tabular-nums text-slate-800">{pctJob == null ? '—' : `${pctJob}%`}</span>
        </div>

        {editingPrice && job.cost && canEdit && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs">
            <label className="text-slate-600">
              ราคาตกลง / {job.unit || 'หน่วย'}{' '}
              <input
                type="number"
                min="0"
                step="0.01"
                autoFocus
                placeholder={String(job.cost.boqPricePerUnit || 0)}
                value={priceDrafts[job.id] ?? ''}
                onChange={(e) => onPriceDraftChange(job.id, e.target.value)}
                className="ml-1 w-28 rounded-lg border border-slate-300 px-2 py-1"
              />
            </label>
            <span className="text-slate-500">BOQ ฿{formatCurrency(job.cost.boqPricePerUnit || 0)}</span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                onSaveVariablePrice(job)
                setEditPriceId(null)
              }}
              className="rounded-lg bg-indigo-600 px-2.5 py-1 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              บันทึก
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                onResetVariablePrice(job)
                setEditPriceId(null)
              }}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-slate-600 hover:bg-white disabled:opacity-60"
            >
              ใช้ราคา BOQ
            </button>
            <button type="button" onClick={() => setEditPriceId(null)} className="px-2 py-1 text-slate-500 hover:underline">
              ยกเลิก
            </button>
            {agreed === 0 && <span className="w-full text-amber-700">ราคาตกลง 0 หมายถึงงานนี้ไม่มีค่าแรง (กด &quot;ใช้ราคา BOQ&quot; ถ้าต้องการกลับไปใช้ราคา BOQ)</span>}
          </div>
        )}
      </div>
    )
  }

  const renderTrade = ([trade, list]: [string, PlotJobRow[]]) => {
    const value = list.reduce((s, j) => s + (j.cost?.totalBoq ?? 0), 0)
    const earned = list.reduce((s, j) => s + (jobCost(j) ? earnedForJob(jobCost(j)!) : 0), 0)
    const pct = value > 0 ? Math.round((earned / value) * 100) : 0
    const missing = list.filter((j) => !j.contractorId).length
    const crewIds = [...new Set(list.map((j) => j.contractorId).filter((v): v is string => !!v))]
    const chip = crewIds.length === 0 ? '+ ใส่ช่างทั้งหมวด' : crewIds.length === 1 ? (contractors.find((c) => c.id === crewIds[0])?.name ?? 'ช่าง 1 คน') : `${crewIds.length} ช่าง`
    return (
      <div key={trade} className="border-b border-slate-100 last:border-0">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50/60 px-4 py-2.5">
          <span>
            <b className="font-semibold text-slate-800">{trade}</b>
            <span className="ml-2 text-xs text-slate-500">
              {list.length} งาน · ฿{formatCurrency(value)}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {missing > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">ขาด {missing}</span>}
            {canEdit && (
              <button
                type="button"
                onClick={() => setPicker({ kind: 'trade', trade })}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${crewIds.length === 0 ? 'border-dashed border-amber-400 bg-amber-50 text-amber-800' : 'border-indigo-200 bg-indigo-50 text-indigo-700'} hover:brightness-95`}
              >
                {crewIds.length === 0 && <Plus className="h-3 w-3" aria-hidden />}
                {chip.replace(/^\+ /, '')}
              </button>
            )}
            <span className="w-10 text-right text-sm font-semibold tabular-nums">{pct}%</span>
          </span>
        </div>
        {list.map(renderJob)}
      </div>
    )
  }

  const pickerTitle =
    picker?.kind === 'trade' ? `ใส่ช่าง: ${picker.trade}` : picker?.kind === 'bulk' ? `ใส่ช่างให้ ${selected.size} งานที่เลือก` : picker?.kind === 'job' ? `ช่างของ: ${jobById(picker.jobId)?.itemName ?? ''}` : ''
  const pickerJob = picker?.kind === 'job' ? jobById(picker.jobId) : undefined
  const tradeList = picker?.kind === 'trade' ? visible.filter((j) => (j.tradeName || 'งานอื่นๆ') === picker.trade) : []

  return (
    <div className="space-y-3 pb-16">
      {progressSummary && <PlotProgressSummary summary={progressSummary} expectedPercent={expectedPercent ?? null} health={progressHealth ?? 'unknown'} />}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700">
        <span>
          ทำได้ <b className="tabular-nums">{earnedPct}%</b> (฿{formatCurrency(totalEarned)} จาก ฿{formatCurrency(totalValue)}) · จ่ายแล้ว <b className="tabular-nums">฿{formatCurrency(totalPaid)}</b>
          {counts.nocrew > 0 && <span className="ml-1 text-amber-700"> · {counts.nocrew} งานยังไม่มีช่าง</span>}
        </span>
        <Link href="/dashboard/weekly-plan" className="text-xs font-medium text-indigo-600 hover:underline">
          อัปเดตความคืบหน้าในแผนงาน ›
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
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
        {canEdit && (
          <button
            type="button"
            aria-pressed={selectMode}
            onClick={() => {
              setSelectMode((v) => !v)
              setSelected(new Set())
            }}
            className={`rounded-lg border px-3 py-1 text-xs ${selectMode ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {selectMode ? 'เสร็จการเลือก' : 'เลือกหลายงาน'}
          </button>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        {openTrades.length === 0 && doneTrades.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">ไม่มีงานในตัวกรองนี้</p>}
        {openTrades.map(renderTrade)}
        {doneTrades.length > 0 && (
          <div className="border-t border-slate-100">
            <button type="button" onClick={() => setDoneOpen((v) => !v)} aria-expanded={doneOpen} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
              <span className="text-sm text-slate-600">
                <b className="font-semibold text-emerald-700">เสร็จแล้ว {doneTrades.length} หมวด</b>
                <span className="ml-2 text-xs text-slate-500">{doneTrades.map(([t]) => t).join(' · ')}</span>
              </span>
              <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-[150ms] ${doneOpen ? 'rotate-90' : ''}`} aria-hidden />
            </button>
            {doneOpen && doneTrades.map(renderTrade)}
          </div>
        )}
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

      {picker && (
        <CrewPicker
          title={pickerTitle}
          contractors={contractors}
          currentId={pickerJob?.contractorId ?? null}
          scope={picker.kind === 'trade' ? { emptyCount: tradeList.filter((j) => !j.contractorId).length, totalCount: tradeList.length } : undefined}
          note={
            picker.kind === 'job' && pickerJob?.contractorId && pickerJob.status !== 'pending'
              ? 'เปลี่ยนช่างแล้วสถานะจะกลับเป็นรอเริ่ม'
              : picker.kind === 'trade' || picker.kind === 'bulk'
                ? 'งานที่เปลี่ยนช่างจะกลับเป็นรอเริ่ม'
                : undefined
          }
          onPick={handlePick}
          onClose={() => setPicker(null)}
        />
      )}

      {selectMode && canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-slate-700">
              เลือก <b className="tabular-nums">{selected.size}</b> งาน
              <button type="button" onClick={() => setSelected(new Set(visible.map((j) => j.id)))} className="ml-3 text-xs text-indigo-600 hover:underline">
                เลือกทั้งหมดที่เห็น
              </button>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={selected.size === 0} onClick={() => setPicker({ kind: 'bulk' })} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50">
                ใส่ช่าง
              </button>
              {(['pending', 'in_progress', 'completed'] as const).map((st) => (
                <button key={st} type="button" disabled={selected.size === 0} onClick={() => bulkStatus(st)} className={`rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${STATUS_CLASS[st]}`}>
                  {STATUS_LABEL[st]}
                </button>
              ))}
            </span>
          </div>
        </div>
      )}

      {undo && (
        <div className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
          <span>
            {undo.name}: {STATUS_LABEL[undo.from]} → {STATUS_LABEL[undo.to]}
          </span>
          <button
            type="button"
            onClick={() => {
              onStatusChange(undo.jobId, undo.from)
              setUndo(null)
            }}
            className="rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold hover:bg-white/25"
          >
            เลิกทำ
          </button>
        </div>
      )}
    </div>
  )
}
