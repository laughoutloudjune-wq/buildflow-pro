'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useDepartment } from '@/components/layout/DepartmentContext'
import {
  createWeeklyPlanItems,
  getPlotsJobsForPlan,
  updateWeeklyPlanItem,
  type WeeklyPlanData,
  type WeeklyPlanItem,
  type WeeklyPlanJob,
} from '@/actions/weekly-plan-actions'
import {
  WEEKLY_PLAN_KINDS,
  WEEK_DAY_LABELS,
  currentProgress,
  formatWeekRange,
  linearPlan,
  plotIdsFromRangeText,
  compressPlotNames,
  type WeeklyPlanKind,
} from '@/lib/weekly-plan'

const inputClass = 'w-full'

function toNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

function formatQty(q: number | null, unit: string | null): string {
  if (q == null) return ''
  return `${q.toLocaleString('th-TH', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`
}

function DayRow({
  label,
  values,
  onChange,
  disabled,
}: {
  label: string
  values: string[]
  onChange: (i: number, v: string) => void
  disabled?: boolean
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-600">{label}</p>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEK_DAY_LABELS.map((d, i) => (
          <label key={d} className="block text-center">
            <span className="mb-0.5 block text-[11px] text-slate-500">{d}</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              inputMode="decimal"
              value={values[i]}
              onChange={(e) => onChange(i, e.target.value)}
              disabled={disabled}
              className="w-full rounded-md border border-slate-200 px-1 py-1.5 text-center text-sm disabled:bg-slate-50 disabled:text-slate-400"
              aria-label={`${label} ${d}`}
            />
          </label>
        ))}
      </div>
    </div>
  )
}


type JobGroup = { title: string; trade: string | null; jobs: WeeklyPlanJob[] }

const END_TARGETS = [100, 75, 50, 25]
const FREE_KINDS: WeeklyPlanKind[] = ['repair', 'dc', 'inspect', 'other']

export default function WeeklyPlanItemModal({
  data,
  projectId,
  weekStart,
  item,
  onClose,
  onSaved,
}: {
  data: WeeklyPlanData
  projectId: string
  weekStart: string
  item: WeeklyPlanItem | null
  onClose: () => void
  onSaved: () => void
}) {
  const agreedWeeks = useMemo(
    () => new Set(data.meetings.filter((m) => m.projectId === projectId).map((m) => m.weekStart)),
    [data.meetings, projectId]
  )
  const openWeeks = data.weeks.filter((w) => !agreedWeeks.has(w))
  // An agreed week's plan is locked: only progress (ACTUAL, carry, note) can change.
  const locked = !!item && agreedWeeks.has(item.weekStart)

  const [mode, setMode] = useState<'boq' | 'manual'>(item ? (item.jobAssignmentId ? 'boq' : 'manual') : 'boq')
  const [kind, setKind] = useState<WeeklyPlanKind>(item?.kind ?? 'repair')
  const [title, setTitle] = useState(item?.title ?? '')
  const [plotIds, setPlotIds] = useState<string[]>(item?.plotId ? [item.plotId] : [])
  const [weekSel, setWeekSel] = useState<string[]>(item ? [item.weekStart] : openWeeks.includes(weekStart) ? [weekStart] : [])
  const [boqSel, setBoqSel] = useState<string[]>([])
  const [loaded, setLoaded] = useState<{ key: string; jobs: WeeklyPlanJob[] } | null>(null)
  const [jobSearch, setJobSearch] = useState('')
  const [ownerId, setOwnerId] = useState(item?.ownerId ?? '')
  const [contractorId, setContractorId] = useState(item?.contractorId ?? '')
  const [crewByTitle, setCrewByTitle] = useState<Record<string, string>>({})
  const [carry, setCarry] = useState(item?.carryPct != null ? String(item.carryPct) : '')
  const [plan, setPlan] = useState<string[]>((item?.planPct ?? Array(7).fill(null)).map((v) => (v == null ? '' : String(v))))
  const [actual, setActual] = useState<string[]>((item?.actualPct ?? Array(7).fill(null)).map((v) => (v == null ? '' : String(v))))
  const [target, setTarget] = useState('')
  const [endTarget, setEndTarget] = useState(100)
  const [note, setNote] = useState(item?.note ?? '')
  const [plotSearch, setPlotSearch] = useState('')
  const [rangeText, setRangeText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const { theme } = useDepartment()
  const [progressOpen, setProgressOpen] = useState(
    !!item && (item.carryPct != null || item.planPct.some((v) => v != null) || item.actualPct.some((v) => v != null))
  )

  const editing = !!item
  const boqCreate = !editing && mode === 'boq'
  const plotKey = [...plotIds].sort().join(',')

  // Offer only the selected plots' own BOQ jobs.
  useEffect(() => {
    if (!boqCreate || !plotKey) return
    let cancelled = false
    getPlotsJobsForPlan(plotKey.split(',')).then((res) => {
      if (cancelled) return
      if ('error' in res) {
        setError(res.error)
        setLoaded({ key: plotKey, jobs: [] })
      } else {
        setError(null)
        setLoaded({ key: plotKey, jobs: res.jobs })
      }
    })
    return () => {
      cancelled = true
    }
  }, [boqCreate, plotKey])

  const jobs = useMemo(() => (loaded && loaded.key === plotKey ? loaded.jobs : []), [loaded, plotKey])
  const jobsLoading = boqCreate && !!plotKey && loaded?.key !== plotKey

  // The same job name exists once per house type, and a separate job row per plot.
  // Merge by NAME so a job shows once however many house types the picked plots cover;
  // ticking it schedules it on every picked plot that has it.
  const groups = useMemo(() => {
    const map = new Map<string, JobGroup>()
    for (const j of jobs) {
      const key = j.title.trim()
      const g = map.get(key)
      if (g) g.jobs.push(j)
      else map.set(key, { title: key, trade: j.trade, jobs: [j] })
    }
    return [...map.values()].sort((a, b) => (a.trade || '').localeCompare(b.trade || '', 'th') || a.title.localeCompare(b.title, 'th'))
  }, [jobs])

  const eligibility = (g: JobGroup) => {
    const have = new Set(g.jobs.map((j) => j.plotId))
    const missing = plotIds.filter((id) => !have.has(id))
    const done = g.jobs.filter((j) => j.status === 'completed')
    const dup = g.jobs.filter((j) => j.status !== 'completed' && j.plannedWeeks.some((w) => weekSel.includes(w)))
    const go = g.jobs.filter((j) => !done.includes(j) && !dup.includes(j))
    return { missing, done, dup, go }
  }

  const q = jobSearch.trim().toLowerCase()
  const visibleGroups = groups.filter((g) => !q || `${g.title} ${g.trade ?? ''}`.toLowerCase().includes(q))
  const doingGroups = visibleGroups.filter((g) => g.jobs.some((j) => j.status === 'in_progress'))
  const otherByTrade = useMemo(() => {
    const by = new Map<string, JobGroup[]>()
    for (const g of visibleGroups.filter((x) => !x.jobs.some((j) => j.status === 'in_progress'))) {
      const key = g.trade || 'ไม่ระบุประเภทช่าง'
      by.set(key, [...(by.get(key) || []), g])
    }
    return [...by.entries()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, jobSearch])

  const chosenGroups = groups.filter((g) => boqSel.includes(g.title) && eligibility(g).go.length > 0)
  const chosenJobs = chosenGroups.flatMap((g) => eligibility(g).go)
  const chosenPlotIds = [...new Set(chosenJobs.map((j) => j.plotId))]

  const plots = useMemo(() => data.plots.filter((p) => p.projectId === projectId), [data.plots, projectId])
  const visiblePlots = useMemo(() => {
    const qq = plotSearch.trim().toLowerCase()
    return qq ? plots.filter((p) => `${p.name} ${p.houseType}`.toLowerCase().includes(qq)) : plots
  }, [plots, plotSearch])
  const projectGroups = useMemo(() => data.plotGroups.filter((g) => g.projectId === projectId), [data.plotGroups, projectId])
  const toggleGroup = (ids: string[]) =>
    setPlotIds((prev) => (ids.every((id) => prev.includes(id)) ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]))

  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const setDay = (setter: (fn: (prev: string[]) => string[]) => void) => (i: number, v: string) =>
    setter((prev) => prev.map((x, idx) => (idx === i ? v : x)))

  const applyRange = () => {
    const ids = plotIdsFromRangeText(rangeText, plots)
    if (ids.length === 0) {
      setError('ไม่พบแปลงตามช่วงที่ระบุ')
      return
    }
    setError(null)
    setPlotIds((prev) => [...new Set([...prev, ...ids])])
    setRangeText('')
  }

  const autoFillPlan = () => {
    const t = toNum(target)
    if (t == null) {
      setError('กรอก % เป้าหมายสิ้นสัปดาห์ก่อน')
      return
    }
    setError(null)
    setPlan(linearPlan(toNum(carry) ?? 0, t).map(String))
  }

  // Where each job already is before the first picked week: the newest plan row's progress.
  const firstWeek = [...weekSel].sort()[0]
  const startedAt = useMemo(() => {
    const best = new Map<string, { week: string; pct: number }>()
    for (const it of data.items) {
      if (!it.jobAssignmentId || !firstWeek || it.weekStart >= firstWeek) continue
      const prev = best.get(it.jobAssignmentId)
      if (!prev || it.weekStart > prev.week) best.set(it.jobAssignmentId, { week: it.weekStart, pct: currentProgress(it) })
    }
    return best
  }, [data.items, firstWeek])

  const save = () => {
    setError(null)
    const detail = {
      contractorId: contractorId || null,
      carryPct: toNum(carry),
      planPct: plan.map(toNum),
      actualPct: actual.map(toNum),
      note,
    }
    if (boqCreate) {
      if (plotIds.length === 0) return setError('กรุณาเลือกแปลง')
      if (chosenJobs.length === 0) return setError('กรุณาเลือกงาน BOQ อย่างน้อยหนึ่งรายการ')
    } else if (!editing && !title.trim()) {
      return setError('กรุณากรอกชื่องาน')
    }
    if (weekSel.length === 0 && !editing) return setError('กรุณาเลือกสัปดาห์')
    startTransition(async () => {
      if (item) {
        const res = await updateWeeklyPlanItem(item.id, {
          projectId: item.projectId,
          plotId: plotIds[0] || null,
          weekStart: item.weekStart,
          kind: item.jobAssignmentId ? 'main' : kind,
          title,
          jobAssignmentId: item.jobAssignmentId,
          ownerId: ownerId || null,
          ...detail,
        })
        if ('error' in res) setError(res.error)
        else onSaved()
        return
      }
      if (boqCreate) {
        const weeks = [...weekSel].sort()
        // One end-of-week target for the first week: each job starts from where it already is.
        const jobPlans: Record<string, { carryPct: number | null; planPct: (number | null)[] }> = {}
        const jobContractors: Record<string, string> = {}
        for (const g of chosenGroups) {
          for (const j of eligibility(g).go) {
            const c = Math.round(Math.min(100, startedAt.get(j.id)?.pct ?? 0))
            jobPlans[j.id] = { carryPct: c, planPct: linearPlan(c, Math.max(endTarget, c)) }
            if (!j.contractorId && crewByTitle[g.title]) jobContractors[j.id] = crewByTitle[g.title]
          }
        }
        const base = { projectId, plotIds: chosenPlotIds, jobAssignmentIds: chosenJobs.map((j) => j.id), kind: 'main' as const, title: '', ownerId: ownerId || null, contractorId: null, note, jobContractors }
        const first = await createWeeklyPlanItems({ ...base, weekStarts: [weeks[0]], jobPlans })
        if ('error' in first) return setError(first.error)
        // Later weeks start empty; "ต่องานค้างจากสัปดาห์ก่อน" carries the progress in when they come.
        if (weeks.length > 1) {
          const rest = await createWeeklyPlanItems({ ...base, weekStarts: weeks.slice(1) })
          if ('error' in rest) return setError(rest.error)
        }
        onSaved()
        return
      }
      const res = await createWeeklyPlanItems({
        projectId,
        plotIds,
        weekStarts: weekSel,
        kind,
        title,
        ownerId: ownerId || null,
        contractorId: null,
        note,
      })
      if ('error' in res) setError(res.error)
      else onSaved()
    })
  }

  const count = boqCreate ? chosenJobs.length * weekSel.length : Math.max(plotIds.length, 1) * weekSel.length
  const projectName = data.projects.find((p) => p.id === projectId)?.name ?? ''

  const lockedBanner = locked && (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
      แผนสัปดาห์นี้ตกลงในที่ประชุมแล้ว แก้ได้เฉพาะ ยอดยกมา / ACTUAL / หมายเหตุ — ถ้าต้องแก้แผนให้ แอดมิน/PM กด &quot;เปิดแก้ไขแผน&quot; ก่อน
    </p>
  )

  const assignmentFields = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <span className="mb-1 block font-medium text-slate-700">ผู้รับเหมา</span>
        <SearchableSelect
          options={[
            { value: '', label: boqCreate ? 'ตามที่มอบหมายในงาน BOQ (ถ้ามี)' : 'ยังไม่ระบุ' },
            ...data.contractors.map((c) => ({ value: c.id, label: c.name })),
          ]}
          value={contractorId}
          onChange={setContractorId}
          placeholder="ยังไม่ระบุ"
          disabled={locked}
        />
      </div>
      <label className="block">
        <span className="mb-1 block font-medium text-slate-700">ผู้คุมงาน / ผู้รับผิดชอบ</span>
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} disabled={locked} className={inputClass}>
          <option value="">ยังไม่มีผู้รับผิดชอบ</option>
          {data.owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )

  // Optional and collapsed by default: most plans are created without daily %.
  const progressSection = (
    <div className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setProgressOpen((v) => !v)}
        aria-expanded={progressOpen}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left font-medium text-slate-700"
      >
        <span>
          รายละเอียดความคืบหน้า <span className="font-normal text-slate-500">(ไม่บังคับ)</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${progressOpen ? 'rotate-180' : ''}`} />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-[180ms] ease-out ${progressOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        inert={!progressOpen || undefined}
      >
        <div className="min-h-0 overflow-hidden">
        <div className="space-y-3 border-t border-slate-200 bg-slate-50/60 p-3">
          <p className="text-xs text-slate-500">
            กรอกเป็น % สะสมสิ้นวัน (เช่น จันทร์ 20 → อังคาร 25 หมายถึงงานเสร็จสะสม 25% เมื่อจบวันอังคาร) เหมือนตาราง PLAN / ACTUAL ในแผนงาน
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block w-36">
              <span className="mb-1 block text-xs text-slate-500">ยอดยกมา (อาทิตย์ก่อน)</span>
              <input type="number" min={0} max={100} step="0.1" value={carry} onChange={(e) => setCarry(e.target.value)} className="w-full rounded-md border border-slate-200 px-2 py-1.5" />
            </label>
            <label className="block w-36">
              <span className="mb-1 block text-xs text-slate-500">เป้าหมายสิ้นสัปดาห์</span>
              <input type="number" min={0} max={100} step="0.1" value={target} onChange={(e) => setTarget(e.target.value)} className="w-full rounded-md border border-slate-200 px-2 py-1.5" />
            </label>
            <Button type="button" variant="secondary" size="sm" onClick={autoFillPlan} disabled={locked}>
              เติม PLAN รายวันอัตโนมัติ
            </Button>
          </div>
          <DayRow label="PLAN (% สะสมสิ้นวัน)" values={plan} onChange={setDay(setPlan)} disabled={locked} />
          <DayRow label="ACTUAL (% สะสมสิ้นวัน)" values={actual} onChange={setDay(setActual)} />
        </div>
        </div>
      </div>
    </div>
  )

  const noteField = (
    <label className="block">
      <span className="mb-1 block font-medium text-slate-700">หมายเหตุ</span>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputClass} />
    </label>
  )

  const errorBox = error && (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
      {error}
    </p>
  )

  // ---- Editing: one compact form ------------------------------------------
  if (editing && item) {
    return (
      <Modal
        isOpen
        onClose={onClose}
        title="แก้ไขรายการ"
        placement="right"
        panelClassName="max-w-2xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              ยกเลิก
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          {lockedBanner}
          {item.jobAssignmentId ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="font-medium text-slate-800">{item.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                งาน BOQ · แปลง {item.plotName ?? '-'}
                {item.jobTrade ? ` · ${item.jobTrade}` : ''}
                {item.jobQuantity != null ? ` · ${formatQty(item.jobQuantity, item.jobUnit)}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">สัปดาห์ {formatWeekRange(item.weekStart)}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block font-medium text-slate-700">ประเภทงาน</span>
                  <select value={kind} onChange={(e) => setKind(e.target.value as WeeklyPlanKind)} disabled={locked} className={inputClass}>
                    {WEEKLY_PLAN_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block font-medium text-slate-700">รายการงาน</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={locked} className={inputClass} />
                </label>
              </div>
              <div>
                <span className="mb-1 block font-medium text-slate-700">
                  แปลง <span className="font-normal text-slate-500">ไม่บังคับ</span>
                </span>
                <SearchableSelect
                  options={plots.map((p) => ({ value: p.id, label: p.name }))}
                  value={plotIds[0] ?? ''}
                  onChange={(v) => setPlotIds(v ? [v] : [])}
                  placeholder="พิมพ์เลขแปลงเพื่อค้นหา"
                  disabled={locked}
                />
              </div>
              <p className="text-slate-500">สัปดาห์ {formatWeekRange(item.weekStart)}</p>
            </>
          )}
          {assignmentFields}
          {progressSection}
          {noteField}
          {errorBox}
        </div>
      </Modal>
    )
  }


  // ---- Creating: one sheet, three questions -----------------------------------
  const pickRow = (g: JobGroup) => {
    const e = eligibility(g)
    const on = boqSel.includes(g.title) && e.go.length > 0
    const crews = [...new Set(g.jobs.map((j) => j.contractorName).filter((n): n is string => !!n))]
    const needsCrew = e.go.some((j) => !j.contractorId)
    const notes: string[] = []
    if (e.done.length) notes.push(`เสร็จแล้ว แปลง ${compressPlotNames(e.done.map((j) => j.plotName))} (ข้าม)`)
    if (e.dup.length) notes.push(`อยู่ในแผนสัปดาห์ที่เลือกแล้ว แปลง ${compressPlotNames(e.dup.map((j) => j.plotName))} (ข้าม)`)
    if (e.missing.length) {
      const names = e.missing.map((id) => plots.find((p) => p.id === id)?.name ?? '').filter(Boolean)
      notes.push(`แบบบ้านของแปลง ${compressPlotNames(names)} ไม่มีงานนี้`)
    }
    return (
      <label
        key={g.title}
        className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
          e.go.length === 0 ? 'cursor-not-allowed border-slate-100 bg-slate-50 opacity-60' : on ? `cursor-pointer ${theme.selected}` : 'cursor-pointer border-slate-200 hover:bg-slate-50'
        }`}
      >
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={on}
          disabled={e.go.length === 0}
          onChange={() => setBoqSel((prev) => toggleIn(prev, g.title))}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-slate-800">{g.title}</span>
            <span className="text-xs tabular-nums text-slate-500">{e.go.length > 0 ? `${e.go.length} แปลง` : 'ไม่มีแปลงให้เพิ่ม'}</span>
          </span>
          <span className="block text-xs text-slate-500">
            {crews.length > 0 ? crews.join(', ') : needsCrew ? 'ยังไม่มีช่าง' : ''}
          </span>
          {needsCrew && e.go.length > 0 && (
            <select
              value={crewByTitle[g.title] ?? ''}
              onChange={(ev) => setCrewByTitle((prev) => ({ ...prev, [g.title]: ev.target.value }))}
              onClick={(ev) => ev.stopPropagation()}
              aria-label={`เลือกช่างสำหรับ ${g.title}`}
              className="mt-1 max-w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
            >
              <option value="">เลือกช่าง (ไม่บังคับ)</option>
              {data.contractors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {notes.map((n) => (
            <span key={n} className="block text-xs text-amber-700">
              {n}
            </span>
          ))}
        </span>
      </label>
    )
  }

  const summary =
    count > 0 ? (
      <>
        <span className="font-semibold text-slate-800">
          {boqCreate ? `${chosenGroups.length} งาน · ${chosenPlotIds.length} แปลง` : `${Math.max(plotIds.length, 1)} แปลง`} · {weekSel.length} สัปดาห์
        </span>{' '}
        = <span className={`font-semibold ${theme.text}`}>{count} รายการ</span>
      </>
    ) : (
      <span className="text-slate-500">เลือกงานเพื่อดูว่าจะเพิ่มกี่รายการ</span>
    )

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="เพิ่มงานเข้าแผน"
      placement="right"
      panelClassName="max-w-2xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm" aria-live="polite">
            {summary}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              ยกเลิก
            </Button>
            <Button onClick={save} disabled={pending || count === 0}>
              {pending ? 'กำลังเพิ่ม...' : 'เพิ่มเข้าแผน'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6 text-sm">
        <p className="text-xs text-slate-500">{projectName}</p>

        <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="ประเภทงาน">
          {(
            [
              ['boq', 'งานจาก BOQ'],
              ['manual', 'งานนอก BOQ (ซ่อม / DC / ตรวจบ้าน)'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m)
                setError(null)
              }}
              className={`rounded-md px-3 py-1.5 text-sm ${mode === m ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="font-semibold text-slate-800">แปลงไหน</h3>
            <span className="text-xs text-slate-500">
              {plotIds.length > 0 ? `${plotIds.length} แปลง · ${compressPlotNames(plotIds.map((id) => plots.find((p) => p.id === id)?.name ?? ''))}` : 'ยังไม่เลือก'}
            </span>
          </div>
          {projectGroups.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {projectGroups.map((g) => {
                const on = g.plotIds.every((id) => plotIds.includes(id))
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleGroup(g.plotIds)}
                    className={`rounded-full border px-3 py-1 text-xs ${on ? theme.selected + ' font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {g.name} ({g.plotIds.length})
                  </button>
                )
              })}
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
            <input
              id="wp-plot-search"
              value={plotSearch}
              onChange={(e) => setPlotSearch(e.target.value)}
              placeholder="ค้นหาเลขแปลงหรือแบบบ้าน"
              aria-label="ค้นหาแปลง"
              className="w-full rounded-md border border-slate-200 py-2 pl-8 pr-2"
            />
          </div>
          <div className="grid max-h-44 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-5">
            {visiblePlots.length === 0 && <p className="col-span-full py-2 text-center text-slate-500">ไม่พบแปลง</p>}
            {visiblePlots.map((p) => {
              const on = plotIds.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPlotIds((prev) => toggleIn(prev, p.id))}
                  className={`min-w-0 rounded-md border px-1.5 py-1.5 text-center ${on ? theme.selected + ' font-semibold' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                  title={`${p.name} · ${p.houseType}`}
                >
                  <span className="block truncate text-sm tabular-nums">{p.name}</span>
                  {p.houseType && <span className="block truncate text-[10px] font-normal text-slate-500">{p.houseType}</span>}
                </button>
              )
            })}
          </div>
          <div className="flex gap-2">
            <input
              value={rangeText}
              onChange={(e) => setRangeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyRange()
                }
              }}
              placeholder="หรือพิมพ์ช่วง เช่น 120-124, 127 แล้วกด Enter"
              aria-label="ช่วงแปลง"
              className="w-full rounded-md border border-slate-200 px-2 py-2"
            />
            <Button type="button" variant="secondary" size="sm" onClick={() => setPlotIds([])}>
              ล้าง
            </Button>
          </div>
        </section>

        {boqCreate ? (
          <section className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="font-semibold text-slate-800">งานอะไร</h3>
              <span className="text-xs text-slate-500">งานชื่อเดียวกันรวมเป็นแถวเดียว ไม่ว่าแบบบ้านใด</span>
            </div>
            {plotIds.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-slate-500">เลือกแปลงก่อน แล้วงานของแปลงเหล่านั้นจะขึ้นที่นี่</p>
            ) : jobsLoading ? (
              <p className="py-3 text-center text-slate-500">กำลังโหลดงาน BOQ...</p>
            ) : groups.length === 0 ? (
              <div className="space-y-3 py-3 text-center">
                <p className="text-slate-600">แปลงที่เลือกยังไม่มีงาน BOQ ต้อง sync งาน BOQ ให้แปลงก่อน</p>
                <Button type="button" size="sm" variant="secondary" onClick={() => setMode('manual')}>
                  เปลี่ยนเป็นงานนอก BOQ
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
                  <input
                    id="wp-job-search"
                    value={jobSearch}
                    onChange={(e) => setJobSearch(e.target.value)}
                    placeholder="ค้นหางาน เช่น ก่ออิฐ ไฟฟ้า"
                    aria-label="ค้นหางาน"
                    className="w-full rounded-md border border-slate-200 py-2 pl-8 pr-2"
                  />
                </div>
                <div className="space-y-2">
                  {doingGroups.length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-slate-600">กำลังทำอยู่</p>
                      {doingGroups.map(pickRow)}
                    </>
                  )}
                  {otherByTrade.map(([trade, list]) => (
                    <details key={trade} open={!!q || list.some((g) => boqSel.includes(g.title))} className="rounded-lg">
                      <summary className="cursor-pointer py-1 text-xs font-semibold text-slate-600">
                        {trade} · {list.length} งาน
                      </summary>
                      <div className="mt-1 space-y-2">{list.map(pickRow)}</div>
                    </details>
                  ))}
                  {visibleGroups.length === 0 && <p className="py-2 text-center text-slate-500">ไม่พบงานที่ค้นหา</p>}
                </div>
              </>
            )}
          </section>
        ) : (
          <section className="space-y-2">
            <h3 className="font-semibold text-slate-800">งานอะไร</h3>
            <div className="flex flex-wrap gap-1.5">
              {FREE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={`rounded-full border px-3 py-1 text-xs ${kind === k ? theme.selected + ' font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {WEEKLY_PLAN_KINDS.find((x) => x.value === k)?.label}
                </button>
              ))}
            </div>
            <input
              id="wp-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-2 py-2"
              placeholder="ชื่องาน เช่น ซ่อมรอยร้าวผนังห้องนอน"
              aria-label="ชื่องาน"
            />
            <p className="text-xs text-slate-500">สร้างให้ทุกแปลงที่เลือกในทุกสัปดาห์ที่เลือก ถ้าไม่เลือกแปลงจะเป็นงานของโครงการ</p>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="font-semibold text-slate-800">สัปดาห์ไหน</h3>
          <div className="flex flex-wrap gap-1.5">
            {data.weeks.map((w) => {
              const agreed = agreedWeeks.has(w)
              const on = weekSel.includes(w) && !agreed
              return (
                <button
                  key={w}
                  type="button"
                  disabled={agreed}
                  aria-pressed={on}
                  onClick={() => setWeekSel((prev) => toggleIn(prev, w))}
                  title={agreed ? 'ตกลงแผนแล้ว ต้องเปิดแก้ไขแผนก่อนจึงจะเพิ่มงานได้' : undefined}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    agreed ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400' : on ? theme.selected + ' font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  } ${w === weekStart ? 'ring-1 ring-slate-300' : ''}`}
                >
                  {formatWeekRange(w)}
                  {agreed ? ' 🔒' : w === weekStart ? ' (ที่กำลังดู)' : ''}
                </button>
              )
            })}
          </div>
        </section>

        {boqCreate && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="font-semibold text-slate-800">เป้าหมายสิ้นสัปดาห์</h3>
              <span className="text-xs text-slate-500">ใช้คำนวณ &quot;ควรเสร็จ&quot; ของแต่ละวัน ไม่ต้องกรอกรายวัน</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {END_TARGETS.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={endTarget === t}
                  onClick={() => setEndTarget(t)}
                  className={`rounded-full border px-3 py-1 text-xs tabular-nums ${endTarget === t ? theme.selected + ' font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {t === 100 ? 'เสร็จ 100%' : `${t}%`}
                </button>
              ))}
            </div>
            {weekSel.length > 1 && <p className="text-xs text-slate-500">เป้าหมายใช้กับสัปดาห์แรกที่เลือก สัปดาห์ถัดไปใช้ &quot;ต่องานค้างจากสัปดาห์ก่อน&quot; เพื่อยกความคืบหน้าและตั้งเป้าใหม่</p>}
          </section>
        )}

        <details>
          <summary className="cursor-pointer text-xs text-slate-600">ผู้คุมงานและหมายเหตุ (ไม่บังคับ)</summary>
          <div className="mt-2 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">ผู้คุมงาน / ผู้รับผิดชอบ</span>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-2 py-2">
                <option value="">ยังไม่มีผู้รับผิดชอบ</option>
                {data.owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            {noteField}
          </div>
        </details>

        {errorBox}
      </div>
    </Modal>
  )
}
