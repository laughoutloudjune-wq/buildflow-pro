'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
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
  formatWeekRange,
  linearPlan,
  plotIdsFromRangeText,
  type WeeklyPlanKind,
} from '@/lib/weekly-plan'

const inputClass = 'w-full'

function toNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

/** A row of seven % inputs, Monday to Sunday. */
const JOB_STATUS_LABEL: Record<string, string> = { pending: 'ยังไม่เริ่ม', in_progress: 'กำลังทำ', completed: 'เสร็จแล้ว' }

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
  const [kind, setKind] = useState<WeeklyPlanKind>(item?.kind ?? 'main')
  const [title, setTitle] = useState(item?.title ?? '')
  const [plotIds, setPlotIds] = useState<string[]>(item?.plotId ? [item.plotId] : [])
  const [weekSel, setWeekSel] = useState<string[]>(item ? [item.weekStart] : openWeeks.includes(weekStart) ? [weekStart] : [])
  const [boqSel, setBoqSel] = useState<string[]>([])
  const [loaded, setLoaded] = useState<{ key: string; jobs: WeeklyPlanJob[] } | null>(null)
  const [jobSearch, setJobSearch] = useState('')
  const [ownerId, setOwnerId] = useState(item?.ownerId ?? '')
  const [contractorId, setContractorId] = useState(item?.contractorId ?? '')
  const [carry, setCarry] = useState(item?.carryPct != null ? String(item.carryPct) : '')
  const [plan, setPlan] = useState<string[]>((item?.planPct ?? Array(7).fill(null)).map((v) => (v == null ? '' : String(v))))
  const [actual, setActual] = useState<string[]>((item?.actualPct ?? Array(7).fill(null)).map((v) => (v == null ? '' : String(v))))
  const [target, setTarget] = useState('')
  const [note, setNote] = useState(item?.note ?? '')
  const [plotSearch, setPlotSearch] = useState('')
  const [rangeText, setRangeText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const { theme } = useDepartment()
  const [step, setStep] = useState(1)
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

  // The same BOQ line has a separate job row on every plot, so group by line:
  // ticking a line schedules it on every selected plot that has it.
  const isBlocked = (j: WeeklyPlanJob) => j.plannedWeeks.some((w) => weekSel.includes(w))
  const groups = useMemo(() => {
    const map = new Map<string, { boqItemId: string; title: string; trade: string | null; quantity: number | null; unit: string | null; jobs: WeeklyPlanJob[] }>()
    for (const j of jobs) {
      const g = map.get(j.boqItemId)
      if (g) g.jobs.push(j)
      else map.set(j.boqItemId, { boqItemId: j.boqItemId, title: j.title, trade: j.trade, quantity: j.quantity, unit: j.unit, jobs: [j] })
    }
    return [...map.values()].sort((a, b) => (a.trade || '').localeCompare(b.trade || '', 'th') || a.title.localeCompare(b.title, 'th'))
  }, [jobs])
  const visibleGroups = useMemo(() => {
    const q = jobSearch.trim().toLowerCase()
    return q ? groups.filter((g) => `${g.title} ${g.trade ?? ''}`.toLowerCase().includes(q)) : groups
  }, [groups, jobSearch])
  const chosenJobs = groups.filter((g) => boqSel.includes(g.boqItemId)).flatMap((g) => g.jobs.filter((j) => !isBlocked(j)))
  const chosenPlotIds = [...new Set(chosenJobs.map((j) => j.plotId))]

  const plots = useMemo(() => data.plots.filter((p) => p.projectId === projectId), [data.plots, projectId])
  const visiblePlots = useMemo(() => {
    const q = plotSearch.trim().toLowerCase()
    return q ? plots.filter((p) => p.name.toLowerCase().includes(q)) : plots
  }, [plots, plotSearch])
  const plotName = (id: string) => plots.find((p) => p.id === id)?.name ?? ''
  const projectGroups = useMemo(() => data.plotGroups.filter((g) => g.projectId === projectId), [data.plotGroups, projectId])
  // Clicking a group selects all its plots; clicking again when all are selected clears them.
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
      const res = await createWeeklyPlanItems({
        projectId,
        plotIds: boqCreate ? chosenPlotIds : plotIds,
        jobAssignmentIds: boqCreate ? chosenJobs.map((j) => j.id) : undefined,
        weekStarts: weekSel,
        kind: boqCreate ? 'main' : kind,
        title: boqCreate ? '' : title,
        ownerId: ownerId || null,
        ...detail,
      })
      if ('error' in res) setError(res.error)
      else onSaved()
    })
  }

  const count = boqCreate ? chosenJobs.length * weekSel.length : Math.max(plotIds.length, 1) * weekSel.length
  const selectedLineCount = boqSel.filter((id) => groups.some((g) => g.boqItemId === id)).length
  const projectName = data.projects.find((p) => p.id === projectId)?.name ?? ''

  // ---- Guided creation: validation per step ------------------------------
  const focusId = (id: string) => setTimeout(() => document.getElementById(id)?.focus(), 0)
  const stepProblem = (s: number): { message: string; focus?: string } | null => {
    if (s === 2) {
      if (boqCreate && plotIds.length === 0) return { message: 'กรุณาเลือกแปลงอย่างน้อยหนึ่งแปลง', focus: 'wp-plot-search' }
      if (weekSel.length === 0) return { message: 'กรุณาเลือกสัปดาห์อย่างน้อยหนึ่งสัปดาห์' }
    }
    if (s === 3) {
      if (boqCreate && chosenJobs.length === 0) return { message: 'กรุณาเลือกงาน BOQ อย่างน้อยหนึ่งรายการ', focus: 'wp-job-search' }
      if (!boqCreate && !title.trim()) return { message: 'กรุณากรอกชื่องาน', focus: 'wp-title' }
    }
    return null
  }
  const goNext = () => {
    const problem = stepProblem(step)
    if (problem) {
      setError(problem.message)
      if (problem.focus) focusId(problem.focus)
      return
    }
    setError(null)
    setStep((s) => Math.min(4, s + 1))
  }
  const goBack = () => {
    setError(null)
    setStep((s) => Math.max(1, s - 1))
  }
  const createLabel = `สร้าง ${count} รายการแผน`
  const canCreate = count > 0

  const STEPS = ['แหล่งงาน', 'แปลงและสัปดาห์', 'งาน', 'ผู้รับผิดชอบ'] as const

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

  // ---- Creating: four guided steps -----------------------------------------
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="เพิ่มรายการแผนงาน"
      placement="right"
      panelClassName="max-w-4xl"
      footer={
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-800" aria-live="polite">
            {boqCreate ? (
              <>
                {selectedLineCount} งาน · {chosenPlotIds.length} แปลง · {weekSel.length} สัปดาห์ = <span className={theme.text}>{count} รายการแผน</span>
              </>
            ) : (
              <>
                {Math.max(plotIds.length, 1)} แปลง · {weekSel.length} สัปดาห์ = <span className={theme.text}>{count} รายการแผน</span>
              </>
            )}
            <span className="ml-2 text-xs font-normal text-slate-500">
              {weekSel.length > 0 ? weekSel.slice(0, 3).map(formatWeekRange).join(', ') + (weekSel.length > 3 ? ` +${weekSel.length - 3}` : '') : 'ยังไม่ได้เลือกสัปดาห์'}
            </span>
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              ยกเลิก
            </Button>
            {step > 1 && (
              <Button variant="secondary" onClick={goBack} disabled={pending}>
                ย้อนกลับ
              </Button>
            )}
            {step < 4 ? (
              <Button onClick={goNext}>ถัดไป</Button>
            ) : (
              <Button onClick={save} disabled={pending || !canCreate}>
                {pending ? 'กำลังสร้าง...' : createLabel}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-xs text-slate-500">
          {projectName && <>โครงการ {projectName} · </>}กำลังดูสัปดาห์ {formatWeekRange(weekStart)}
        </p>

        <ol className="flex flex-wrap gap-2" aria-label="ขั้นตอน">
          {STEPS.map((label, i) => {
            const n = i + 1
            const done = n < step
            const current = n === step
            return (
              <li key={label} aria-current={current ? 'step' : undefined}>
                <button
                  type="button"
                  disabled={n > step}
                  onClick={() => setStep(n)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
                    current
                      ? theme.selected
                      : done
                        ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        : 'border-slate-100 bg-slate-50 text-slate-400'
                  }`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${current ? theme.stepSolid : done ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-500'}`}>
                    {done ? '✓' : n}
                  </span>
                  {label}
                </button>
              </li>
            )
          })}
        </ol>

        {step === 1 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                ['boq', 'งานจาก BOQ', 'เลือกงานจาก BOQ ของแต่ละแปลง ระบบดึงชื่องาน ประเภทช่าง และปริมาณให้เอง'],
                ['manual', 'งานนอก BOQ (DC / ซ่อม / ตรวจ / อื่นๆ)', 'พิมพ์ชื่องานเอง ใช้กับงานที่ไม่อยู่ใน BOQ'],
              ] as const
            ).map(([m, label, hint]) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  mode === m ? theme.selected : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span className="block font-semibold text-slate-800">{label}</span>
                <span className="mt-1 block text-xs text-slate-500">{hint}</span>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-slate-700">
                  แปลง <span className="font-normal text-slate-500">(เลือกได้หลายแปลง)</span>
                  {!boqCreate && <span className="ml-1 font-normal text-slate-500">ไม่บังคับ</span>}
                </span>
                <span className="text-xs text-slate-500">เลือกแล้ว {plotIds.length}</span>
              </div>
              <div className="space-y-2 rounded-lg border border-slate-200 p-2">
                {projectGroups.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs text-slate-500">กลุ่มแปลง (เลือกทั้งกลุ่มในครั้งเดียว · เลือกซ้ำเพื่อยกเลิกกลุ่ม)</p>
                    <SearchableSelect
                      options={projectGroups.map((g) => ({
                        value: g.id,
                        label: `${g.plotIds.every((id) => plotIds.includes(id)) ? '✓ ' : ''}${g.name} (${g.plotIds.length} แปลง)`,
                      }))}
                      value=""
                      onChange={(v) => {
                        const g = projectGroups.find((x) => x.id === v)
                        if (g) toggleGroup(g.plotIds)
                      }}
                      placeholder="เลือกกลุ่มแปลง"
                    />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <div className="relative min-w-[8rem] flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      id="wp-plot-search"
                      value={plotSearch}
                      onChange={(e) => setPlotSearch(e.target.value)}
                      placeholder="ค้นหาเลขแปลง"
                      className="w-full rounded-md border border-slate-200 py-2 pl-8 pr-2"
                    />
                  </div>
                  <div className="flex min-w-[10rem] flex-1 gap-1">
                    <input
                      value={rangeText}
                      onChange={(e) => setRangeText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          applyRange()
                        }
                      }}
                      placeholder="ช่วง เช่น 103-107, 120"
                      className="w-full rounded-md border border-slate-200 px-2 py-2"
                    />
                    <Button type="button" variant="secondary" size="sm" onClick={applyRange}>
                      เพิ่ม
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-xs">
                  <button
                    type="button"
                    className="text-indigo-600 hover:underline"
                    onClick={() => setPlotIds((prev) => [...new Set([...prev, ...visiblePlots.map((p) => p.id)])])}
                  >
                    เลือกทั้งหมดที่แสดง ({visiblePlots.length})
                  </button>
                  <button type="button" className="text-slate-500 hover:underline" onClick={() => setPlotIds([])}>
                    ล้างที่เลือก
                  </button>
                </div>
                <div className="grid max-h-36 grid-cols-4 gap-1 overflow-y-auto sm:grid-cols-6 md:grid-cols-8">
                  {visiblePlots.length === 0 && <p className="col-span-full py-2 text-center text-slate-500">ไม่พบแปลง</p>}
                  {visiblePlots.map((p) => {
                    const on = plotIds.includes(p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPlotIds((prev) => toggleIn(prev, p.id))}
                        className={`truncate rounded-md border px-1.5 py-1.5 text-xs ${
                          on ? theme.selected + ' font-semibold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                        title={p.name}
                      >
                        {on ? '✓ ' : ''}
                        {p.name}
                      </button>
                    )
                  })}
                </div>
              </div>
              {plotIds.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {plotIds.slice(0, 20).map((id) => (
                    <span key={id} className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-xs ${theme.chip}`}>
                      {plotName(id)}
                      <button
                        type="button"
                        aria-label={`เอาแปลง ${plotName(id)} ออก`}
                        onClick={() => setPlotIds((prev) => prev.filter((x) => x !== id))}
                        className="rounded-full p-0.5 hover:bg-black/5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {plotIds.length > 20 && <span className="text-xs text-slate-500">+{plotIds.length - 20} แปลง</span>}
                  <button type="button" className="ml-1 text-xs text-slate-500 hover:underline" onClick={() => setPlotIds([])}>
                    ล้างทั้งหมด
                  </button>
                </div>
              )}
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-slate-700">
                  สัปดาห์ <span className="font-normal text-slate-500">(ค่าเริ่มต้นคือสัปดาห์ที่กำลังดู เพิ่มสัปดาห์อื่นได้)</span>
                </span>
                <span className="flex gap-3 text-xs">
                  <button type="button" className="text-indigo-600 hover:underline" onClick={() => setWeekSel(openWeeks)}>
                    ทั้งเดือน
                  </button>
                  <button
                    type="button"
                    className="text-slate-500 hover:underline"
                    onClick={() => setWeekSel(openWeeks.includes(weekStart) ? [weekStart] : [])}
                  >
                    เฉพาะสัปดาห์นี้
                  </button>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {data.weeks.map((w) => {
                  const agreed = agreedWeeks.has(w)
                  const on = weekSel.includes(w) && !agreed
                  return (
                    <label
                      key={w}
                      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                        agreed
                          ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-500'
                          : on
                            ? 'cursor-pointer ' + theme.selected
                            : 'cursor-pointer border-slate-200 text-slate-600'
                      }`}
                    >
                      <input type="checkbox" checked={on} disabled={agreed} onChange={() => setWeekSel((prev) => toggleIn(prev, w))} />
                      <span className="min-w-0">
                        {formatWeekRange(w)}
                        {agreed && <span className="block text-[11px]">🔒 ตกลงแผนแล้ว — ต้องยกเลิกการตกลงแผนก่อนจึงจะเพิ่มงานได้</span>}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {step === 3 && boqCreate && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-700">งาน BOQ ของแปลงที่เลือก</span>
              <span className="text-xs text-slate-500">
                แปลง {plotIds.length} · สัปดาห์ {weekSel.length}
              </span>
            </div>
            <div className="space-y-2 rounded-lg border border-slate-200 p-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  id="wp-job-search"
                  value={jobSearch}
                  onChange={(e) => setJobSearch(e.target.value)}
                  placeholder="ค้นหางาน BOQ หรือประเภทช่าง"
                  className="w-full rounded-md border border-slate-200 py-2 pl-8 pr-2"
                />
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {jobsLoading && <p className="py-3 text-center text-slate-500">กำลังโหลดงาน BOQ...</p>}
                {!jobsLoading && groups.length === 0 && (
                  <div className="space-y-3 py-4 text-center">
                    <p className="text-slate-600">แปลงที่เลือกยังไม่มีงาน BOQ — ต้อง sync งาน BOQ ให้แปลงก่อนจึงจะวางแผนงาน BOQ ได้</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button type="button" variant="secondary" size="sm" onClick={() => setStep(2)}>
                        กลับไปเปลี่ยนแปลง
                      </Button>
                      <Button type="button" size="sm" onClick={() => setMode('manual')}>
                        เปลี่ยนเป็นงานนอก BOQ
                      </Button>
                    </div>
                  </div>
                )}
                {!jobsLoading &&
                  visibleGroups.map((g) => {
                    const free = g.jobs.filter((j) => !isBlocked(j))
                    const blocked = free.length === 0
                    const on = boqSel.includes(g.boqItemId) && !blocked
                    const plotCount = new Set(g.jobs.map((j) => j.plotId)).size
                    const noContractor = free.filter((j) => !j.contractorName).length
                    const statusSummary = (['completed', 'in_progress', 'pending'] as const)
                      .map((s) => ({ s, n: g.jobs.filter((j) => (j.status || 'pending') === s).length }))
                      .filter((x) => x.n > 0)
                      .map((x) => (g.jobs.length === 1 ? JOB_STATUS_LABEL[x.s] : `${JOB_STATUS_LABEL[x.s]} ${x.n}`))
                      .join(' · ')
                    return (
                      <label
                        key={g.boqItemId}
                        className={`flex items-start gap-2 rounded-md border px-2 py-2 ${
                          blocked
                            ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-500'
                            : on
                              ? 'cursor-pointer ' + theme.selected
                              : 'cursor-pointer border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={on}
                          disabled={blocked}
                          onChange={() => setBoqSel((prev) => toggleIn(prev, g.boqItemId))}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block">{g.title}</span>
                          <span className="block text-xs text-slate-500">
                            {[
                              g.trade,
                              formatQty(g.quantity, g.unit),
                              statusSummary,
                              plotIds.length > 1 ? `${plotCount}/${plotIds.length} แปลงที่เลือกมีงานนี้` : null,
                              noContractor > 0
                                ? noContractor === free.length
                                  ? 'ยังไม่มีผู้รับเหมา'
                                  : `${noContractor} แปลงยังไม่มีผู้รับผิดชอบ`
                                : g.jobs[0].contractorName,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                          {!blocked && free.length < g.jobs.length && (
                            <span className="block text-xs text-amber-700">
                              {g.jobs.length - free.length} แปลงวางแผนในสัปดาห์ที่เลือกแล้ว (จะข้าม)
                            </span>
                          )}
                          {blocked && <span className="block text-xs text-amber-700">วางแผนในสัปดาห์ที่เลือกแล้ว — ข้าม</span>}
                        </span>
                      </label>
                    )
                  })}
              </div>
            </div>
          </div>
        )}

        {step === 3 && !boqCreate && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block font-medium text-slate-700">ประเภทงาน</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as WeeklyPlanKind)} className={inputClass}>
                  {WEEKLY_PLAN_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-slate-700">รายการงาน</span>
                <input
                  id="wp-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                  placeholder="เช่น ตรวจรับบ้านก่อนโอน"
                />
              </label>
            </div>
            <p className="text-xs text-slate-500">งานนอก BOQ จะสร้างให้ทุกแปลงที่เลือกในทุกสัปดาห์ที่เลือก (ถ้าไม่เลือกแปลง จะสร้างเป็นงานของโครงการ)</p>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            {assignmentFields}
            {progressSection}
            {noteField}
          </div>
        )}

        {errorBox}
      </div>
    </Modal>
  )
}
