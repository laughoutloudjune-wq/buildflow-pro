'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { createWeeklyPlanItems, getPlotBoard, type PlotBoardData, type PlotBoardJob } from '@/actions/weekly-plan-actions'
import { compressPlotNames, linearPlan } from '@/lib/weekly-plan'

type CellState = 'none' | 'empty' | 'doing' | 'done' | 'late'

const CELL_CLASS: Record<CellState, string> = {
  none: 'cursor-default border-transparent bg-transparent text-slate-300',
  empty: 'bg-slate-100 text-slate-400 hover:bg-slate-200',
  doing: 'bg-indigo-50 font-semibold text-indigo-700 hover:bg-indigo-100',
  done: 'bg-emerald-50 font-semibold text-emerald-700 hover:bg-emerald-100',
  late: 'bg-amber-50 font-semibold text-amber-800 hover:bg-amber-100',
}

type DockEntry = { id: string; title: string; tradeKey: string; order: number; crews: string[]; jobs: { jobId: string; plotId: string; plotName: string; percent: number }[] }

/**
 * Plots down the side, trade stages across (in build order, from the BOQ). A
 * cell shows how far that stage is on that plot; tapping cells (or a stage's
 * header) and pressing "ใส่แผนสัปดาห์นี้" puts the unfinished jobs inside into
 * this week's plan. The jobs already exist on the plot, so nothing is typed.
 */
export default function PlotBoard({
  projectId,
  weekStart,
  agreed,
  refreshKey,
  onChanged,
}: {
  projectId: string
  weekStart: string
  agreed: boolean
  refreshKey: number
  onChanged: () => void
}) {
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const [board, setBoard] = useState<PlotBoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [ticks, setTicks] = useState<Record<string, boolean>>({})
  const [target, setTarget] = useState<100 | 50>(100)

  useEffect(() => {
    let alive = true
    getPlotBoard(projectId, weekStart).then((res) => {
      if (!alive) return
      if ('error' in res) {
        setError(res.error)
        setBoard(null)
      } else {
        setError(null)
        setBoard(res)
      }
    })
    return () => {
      alive = false
    }
  }, [projectId, weekStart, refreshKey])

  const groups = useMemo(() => [...new Set((board?.plots || []).map((p) => p.groupName).filter(Boolean))], [board])
  const activeGroup = groupFilter ?? (groups.length > 0 ? groups[0] : '')
  const visiblePlots = useMemo(
    () => (board?.plots || []).filter((p) => !activeGroup || activeGroup === '*' || p.groupName === activeGroup),
    [board, activeGroup]
  )

  const cells = useMemo(() => {
    const map = new Map<string, PlotBoardJob[]>()
    for (const j of board?.jobs || []) {
      const key = `${j.plotId}|${j.tradeKey}`
      map.set(key, [...(map.get(key) || []), j])
    }
    return map
  }, [board])

  const cellInfo = (plotId: string, tradeKey: string): { state: CellState; avg: number; planned: boolean } => {
    const jobs = cells.get(`${plotId}|${tradeKey}`)
    if (!jobs || jobs.length === 0) return { state: 'none', avg: 0, planned: false }
    const avg = Math.round(jobs.reduce((s, j) => s + j.percent, 0) / jobs.length)
    const planned = jobs.some((j) => j.plannedThisWeek)
    if (jobs.every((j) => j.percent >= 100)) return { state: 'done', avg, planned }
    if (jobs.some((j) => j.missedLastWeek)) return { state: 'late', avg, planned }
    return { state: avg > 0 ? 'doing' : 'empty', avg, planned }
  }

  const toggleCell = (key: string) => {
    setTicks({})
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleColumn = (tradeKey: string) => {
    const keys = visiblePlots.map((p) => `${p.id}|${tradeKey}`).filter((k) => {
      const [plotId] = k.split('|')
      const st = cellInfo(plotId, tradeKey).state
      return st !== 'none' && st !== 'done'
    })
    setTicks({})
    setSel((prev) => {
      const next = new Set(prev)
      const all = keys.length > 0 && keys.every((k) => next.has(k))
      keys.forEach((k) => (all ? next.delete(k) : next.add(k)))
      return next
    })
  }

  // Unfinished, not-yet-planned jobs inside the selected cells, merged by job name across plots.
  const plotName = useMemo(() => new Map((board?.plots || []).map((p) => [p.id, p.name])), [board])
  const entries = useMemo<DockEntry[]>(() => {
    const by = new Map<string, DockEntry>()
    for (const key of sel) {
      for (const j of cells.get(key) || []) {
        if (j.percent >= 100 || j.plannedThisWeek) continue
        const id = `${j.tradeKey}|${j.title}`
        const e = by.get(id) || { id, title: j.title, tradeKey: j.tradeKey, order: j.order, crews: [], jobs: [] }
        e.order = Math.min(e.order, j.order)
        if (j.contractorName && !e.crews.includes(j.contractorName)) e.crews.push(j.contractorName)
        e.jobs.push({ jobId: j.id, plotId: j.plotId, plotName: plotName.get(j.plotId) || '', percent: j.percent })
        by.set(id, e)
      }
    }
    return [...by.values()].sort((a, b) => a.order - b.order)
  }, [sel, cells, plotName])

  // Default: only the first unfinished job of each stage is ticked (the next step); the rest are listed unticked.
  const isOn = (e: DockEntry) => {
    if (e.id in ticks) return ticks[e.id]
    return entries.find((x) => x.tradeKey === e.tradeKey)?.id === e.id
  }
  const chosen = entries.filter(isOn)
  const plannedInSel = [...sel].reduce((n, key) => n + (cells.get(key) || []).filter((j) => j.plannedThisWeek && j.percent < 100).length, 0)
  const selectedPlots = [...new Set([...sel].map((k) => k.split('|')[0]))]

  const submit = () => {
    if (chosen.length === 0) return
    const jobIds = chosen.flatMap((e) => e.jobs.map((j) => j.jobId))
    const jobPlans: Record<string, { carryPct: number | null; planPct: (number | null)[] }> = {}
    for (const e of chosen) {
      for (const j of e.jobs) jobPlans[j.jobId] = { carryPct: j.percent, planPct: linearPlan(j.percent, Math.max(target, j.percent)) }
    }
    startTransition(async () => {
      const res = await createWeeklyPlanItems({
        projectId,
        kind: 'main',
        title: '',
        ownerId: null,
        plotIds: [...new Set(chosen.flatMap((e) => e.jobs.map((j) => j.plotId)))],
        jobAssignmentIds: jobIds,
        jobPlans,
        weekStarts: [weekStart],
      })
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      toast.success(`ใส่แผนสัปดาห์นี้ ${res.created ?? jobIds.length} รายการ ดูได้ที่ "สัปดาห์นี้"`)
      setSel(new Set())
      setTicks({})
      onChanged()
    })
  }

  if (error) return <Card className="p-4 text-sm text-red-700">{error}</Card>
  if (!board) return <Card className="p-8 text-center text-sm text-slate-500">กำลังโหลดบอร์ด...</Card>
  if (board.plots.length === 0 || board.trades.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-slate-600">
        <p className="font-medium text-slate-800">ยังไม่มีงานให้วางแผน</p>
        <p className="mt-1">โครงการนี้ยังไม่ได้ดึง BOQ เข้าแปลง ไปที่หน้าแปลงแล้วกด &quot;ดึง BOQ&quot; ก่อน</p>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        {groups.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="กลุ่มแปลง">
            {[...groups, '*'].map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={activeGroup === g}
                onClick={() => setGroupFilter(g)}
                className={`rounded-full border px-3 py-1 text-xs ${activeGroup === g ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {g === '*' ? 'ทั้งหมด' : g}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          <Legend cls={CELL_CLASS.done} label="เสร็จ" />
          <Legend cls={CELL_CLASS.doing} label="กำลังทำ (% ในช่อง)" />
          <Legend cls="border-2 border-dashed border-indigo-500 bg-white" label="อยู่ในแผนสัปดาห์นี้" />
          <Legend cls={CELL_CLASS.late} label="สัปดาห์ก่อนทำไม่ได้" />
          <Legend cls={CELL_CLASS.empty} label="ยังไม่เริ่ม" />
        </div>
        {agreed && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">แผนสัปดาห์นี้ตกลงในที่ประชุมแล้ว เพิ่มงานไม่ได้ ถ้าจะเพิ่มต้องเปิดแก้ไขแผนที่หน้า &quot;สัปดาห์นี้&quot; ก่อน</p>}
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium text-slate-500">แปลง</th>
                {board.trades.map((t) => (
                  <th key={t.key} className="border-b border-slate-200 bg-white px-1 py-1.5 text-center text-xs font-medium text-slate-500">
                    <button type="button" onClick={() => toggleColumn(t.key)} title="เลือกทั้งคอลัมน์" className="whitespace-nowrap rounded-md px-1.5 py-0.5 hover:bg-slate-100">
                      {t.name}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiblePlots.map((p) => (
                <tr key={p.id}>
                  <td className="sticky left-0 z-10 whitespace-nowrap border-r border-slate-100 bg-white px-3 py-1">
                    <b className="font-semibold text-slate-800">{p.name}</b>
                    <small className="block text-[11px] leading-tight text-slate-400">{p.houseType || '—'}</small>
                  </td>
                  {board.trades.map((t) => {
                    const info = cellInfo(p.id, t.key)
                    const key = `${p.id}|${t.key}`
                    const on = sel.has(key)
                    const text = info.state === 'done' ? '✓' : info.state === 'doing' || info.state === 'late' ? `${info.avg}%` : info.state === 'none' ? '–' : ''
                    const sub = info.state === 'late' ? 'ค้าง' : info.planned ? 'แผน' : ''
                    return (
                      <td key={t.key} className="p-1 text-center">
                        <button
                          type="button"
                          disabled={info.state === 'none'}
                          aria-pressed={on}
                          aria-label={`แปลง ${p.name} ${t.name}`}
                          onClick={() => toggleCell(key)}
                          className={`block h-9 w-14 rounded-lg border-[1.5px] text-xs leading-tight tabular-nums ${CELL_CLASS[info.state]} ${info.planned ? 'border-dashed border-indigo-500' : 'border-transparent'} ${on ? 'outline outline-[3px] outline-offset-1 outline-indigo-500' : ''}`}
                        >
                          {text}
                          {sub && <small className="block text-[10px] font-normal">{sub}</small>}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">แตะช่องเพื่อเลือก (เลือกได้หลายช่อง) แตะชื่อขั้นงานด้านบนเพื่อเลือกทั้งคอลัมน์ในกลุ่มที่เลือกอยู่ แล้วกด &quot;ใส่แผนสัปดาห์นี้&quot;</p>
      </Card>

      {sel.size > 0 && (
        <Card className="sticky bottom-2 z-20 space-y-3 border-indigo-300 p-4 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <b>
              เลือก {sel.size} ช่อง · แปลง {compressPlotNames(selectedPlots.map((id) => plotName.get(id) || ''))}
            </b>
            <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => { setSel(new Set()); setTicks({}) }}>
              ล้าง
            </button>
          </div>
          {entries.length > 0 ? (
            <ul className="max-h-56 space-y-1.5 overflow-y-auto">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-sm">
                  <input id={`dock-${e.id}`} type="checkbox" checked={isOn(e)} onChange={(ev) => setTicks((prev) => ({ ...prev, [e.id]: ev.target.checked }))} className="h-4 w-4" />
                  <label htmlFor={`dock-${e.id}`} className="min-w-0 flex-1 truncate">
                    {e.title}
                  </label>
                  <span className="shrink-0 text-xs text-slate-500">
                    {compressPlotNames(e.jobs.map((j) => j.plotName))} · {e.crews.length > 0 ? e.crews.join(', ') : <span className="text-amber-700">ยังไม่มีช่าง</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">งานในช่องที่เลือกเสร็จหมดแล้วหรืออยู่ในแผนสัปดาห์นี้แล้ว</p>
          )}
          {plannedInSel > 0 && <p className="text-xs text-slate-500">{plannedInSel} งานในช่องที่เลือกอยู่ในแผนสัปดาห์นี้แล้ว ข้ามให้</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm">
              เป้าสิ้นสัปดาห์
              {([100, 50] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={target === t}
                  onClick={() => setTarget(t)}
                  className={`rounded-full border px-3 py-1 text-xs ${target === t ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 text-slate-600'}`}
                >
                  {t === 100 ? 'เสร็จ' : 'ถึง 50%'}
                </button>
              ))}
            </span>
            <Button disabled={pending || agreed || chosen.length === 0} onClick={submit}>
              {pending ? 'กำลังเพิ่ม...' : 'ใส่แผนสัปดาห์นี้'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-4 w-7 rounded-md ${cls}`} aria-hidden />
      {label}
    </span>
  )
}
