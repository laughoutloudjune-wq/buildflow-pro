'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Info, RotateCcw, XCircle } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import {
  applyHouseTypeChanges,
  checkHouseTypeChanges,
  getHouseTypeChangeOverview,
  getHouseTypeChangeReview,
  listHouseTypeChangeRuns,
  revertHouseTypeChange,
  type HtcApplyResult,
  type HtcCheckResult,
  type HtcModel,
  type HtcOverview,
  type HtcPlotSummary,
  type HtcReview,
  type HtcRun,
} from '@/actions/house-type-change-actions'
import { buildPlan, type HtcJobChoice, type HtcPlan } from '@/lib/house-type-change'

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qtyFmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 })
const modelLabel = (m: Pick<HtcModel, 'name' | 'code'> | undefined | null) => (m ? `${m.name}${m.code ? ` · ${m.code}` : ''}` : '—')

type Step = 1 | 2 | 3 | 4
const STEP_NAMES = ['เลือกแปลง', 'ตรวจทีละแปลง', 'ยืนยัน', 'ผล']

type PlotState = {
  choices: Record<string, HtcJobChoice>
  newJobs: Set<string>
}

export default function HouseTypeChangeWizard({
  projectId,
  onClose,
  onChanged,
}: {
  projectId: string
  onClose: () => void
  /** called after at least one plot changed, so the page can refresh */
  onChanged: () => void
}) {
  const [view, setView] = useState<'wizard' | 'history'>('wizard')
  const [step, setStep] = useState<Step>(1)
  const [overview, setOverview] = useState<HtcOverview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState<Record<string, string>>({})
  const [seed, setSeed] = useState<Record<string, string>>({})

  const [reviews, setReviews] = useState<Record<string, HtcReview>>({})
  const [reviewErrors, setReviewErrors] = useState<Record<string, string>>({})
  const [plotState, setPlotState] = useState<Record<string, PlotState>>({})
  const [reviewing, setReviewing] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)

  const [checking, setChecking] = useState(false)
  const [checks, setChecks] = useState<Record<string, HtcCheckResult>>({})
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<HtcApplyResult[] | null>(null)
  const [revertMsg, setRevertMsg] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [reverted, setReverted] = useState<Set<string>>(new Set())
  const [reverting, setReverting] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)

  const [runs, setRuns] = useState<HtcRun[] | null>(null)
  const [runsError, setRunsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getHouseTypeChangeOverview(projectId)
      .then((o) => {
        if (!cancelled) setOverview(o)
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const modelById = useMemo(() => new Map((overview?.models ?? []).map((m) => [m.id, m])), [overview])
  const plotById = useMemo(() => new Map((overview?.plots ?? []).map((p) => [p.id, p])), [overview])

  const pickedPlots = useMemo(() => (overview?.plots ?? []).filter((p) => picked.has(p.id)), [overview, picked])
  const groups = useMemo(() => {
    const g = new Map<string, HtcPlotSummary[]>()
    for (const p of overview?.plots ?? []) {
      const k = p.houseModelId ?? ''
      g.set(k, [...(g.get(k) ?? []), p])
    }
    return [...g.entries()]
  }, [overview])

  const runnable = pickedPlots.filter((p) => !!target[p.id] && target[p.id] !== p.houseModelId)

  /** For an empty target type: which old type's BOQ is copied in first. */
  function seedFor(modelId: string): string | null {
    if (seed[modelId]) return seed[modelId]
    const counts = new Map<string, number>()
    for (const p of pickedPlots) {
      if (target[p.id] === modelId && p.houseModelId) counts.set(p.houseModelId, (counts.get(p.houseModelId) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }

  function togglePlot(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function goReview() {
    setStep(2)
    setReviewing(true)
    setReviewErrors({})
    const nextReviews: Record<string, HtcReview> = {}
    const nextState: Record<string, PlotState> = {}
    const errors: Record<string, string> = {}
    await Promise.all(
      runnable.map(async (p) => {
        const modelId = target[p.id]
        const m = modelById.get(modelId)
        try {
          const r = await getHouseTypeChangeReview(p.id, modelId, m && m.lines === 0 ? seedFor(modelId) : null)
          nextReviews[p.id] = r
          const choices: Record<string, HtcJobChoice> = {}
          for (const pair of r.pairs) {
            choices[pair.jobId] = pair.lineKey ? { mode: 'line', lineKey: pair.lineKey, useNewQty: false } : { mode: 'copy' }
          }
          nextState[p.id] = { choices, newJobs: new Set(r.unpaired.filter((u) => u.defaultOn).map((u) => u.key)) }
        } catch (e) {
          errors[p.id] = e instanceof Error ? e.message : 'โหลดไม่สำเร็จ'
        }
      })
    )
    setReviews(nextReviews)
    setPlotState(nextState)
    setReviewErrors(errors)
    setFocus((cur) => (cur && runnable.some((p) => p.id === cur) ? cur : (runnable[0]?.id ?? null)))
    setReviewing(false)
  }

  function planFor(plotId: string): HtcPlan | null {
    const r = reviews[plotId]
    const st = plotState[plotId]
    if (!r || !st) return null
    return buildPlan({
      plotId,
      newHouseModelId: target[plotId],
      jobs: r.jobs,
      lines: r.lines,
      choices: st.choices,
      newJobKeys: [...st.newJobs],
    })
  }

  /** What the contract total of a plot will be after the move (prediction; the database re-checks). */
  function predicted(plotId: string) {
    const r = reviews[plotId]
    const st = plotState[plotId]
    if (!r || !st) return { after: 0, approvedJobs: 0, copies: 0 }
    let after = 0
    let approvedJobs = 0
    let copies = 0
    for (const j of r.jobs) {
      const c = st.choices[j.id] ?? { mode: 'copy' as const }
      const line = c.mode === 'line' ? r.lines.find((l) => l.key === c.lineKey) : undefined
      if (line && Math.abs(line.qty - j.qty) >= 0.0001 && c.mode === 'line' && c.useNewQty) {
        after += line.qty * j.price
        approvedJobs += 1
      } else {
        after += j.contract
        if (!line || Math.abs(line.qty - j.qty) >= 0.0001 || line.virtual) copies += 1
      }
    }
    return { after, approvedJobs, copies }
  }

  const readyPlots = runnable.filter((p) => reviews[p.id] && plotState[p.id])
  // Plots that passed "check without saving" are the only ones that run.
  const passedPlots = readyPlots.filter((p) => checks[p.id]?.ok)

  async function goConfirm() {
    setStep(3)
    setChecking(true)
    setChecks({})
    const plans = readyPlots.map((p) => planFor(p.id)).filter((x): x is HtcPlan => !!x)
    try {
      const res = await checkHouseTypeChanges(plans)
      setChecks(Object.fromEntries(res.map((r) => [r.plotId, r])))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'ตรวจไม่สำเร็จ'
      setChecks(Object.fromEntries(plans.map((p) => [p.plotId, { ok: false as const, plotId: p.plotId, money: false, error: msg }])))
    }
    setChecking(false)
  }

  async function run() {
    setRunning(true)
    const plans = passedPlots.map((p) => planFor(p.id)).filter((x): x is HtcPlan => !!x)
    try {
      const res = await applyHouseTypeChanges(projectId, plans)
      setResults(res)
      if (res.some((r) => r.ok)) {
        setChanged(true)
        onChanged()
      }
    } catch (e) {
      setResults(plans.map((p) => ({ ok: false as const, plotId: p.plotId, error: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' })))
    }
    setRunning(false)
    setStep(4)
  }

  async function revert(runId: string, key: string) {
    setReverting(key)
    const r = await revertHouseTypeChange(projectId, runId)
    setReverting(null)
    if (r.ok) {
      setReverted((prev) => new Set(prev).add(key))
      setChanged(true)
      onChanged()
      const keep = r.keptJobs + r.keptLines
      setRevertMsg((prev) => ({
        ...prev,
        [key]: {
          ok: true,
          text: `คืนค่าแล้ว${keep ? ` · เก็บไว้ ${keep} รายการที่มีการใช้งานแล้ว` : ''}`,
        },
      }))
      if (view === 'history') void loadRuns()
    } else {
      setRevertMsg((prev) => ({ ...prev, [key]: { ok: false, text: r.error } }))
    }
  }

  async function loadRuns() {
    setRunsError(null)
    try {
      setRuns(await listHouseTypeChangeRuns(projectId))
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : 'โหลดประวัติไม่สำเร็จ')
    }
  }

  function openHistory() {
    setView('history')
    void loadRuns()
  }

  const plotName = (id: string) => plotById.get(id)?.name ?? reviews[id]?.plotName ?? id

  // ---------------------------------------------------------------- step 1
  function renderStep1() {
    if (loadError) return <p className="text-sm text-red-600">{loadError}</p>
    if (!overview) return <p className="text-sm text-slate-500">กำลังโหลด…</p>
    if (overview.plots.length === 0) return <p className="text-sm text-slate-500">โครงการนี้ยังไม่มีแปลงที่มีงาน</p>

    const pickedByModel = new Map<string, HtcPlotSummary[]>()
    for (const p of pickedPlots) pickedByModel.set(p.houseModelId ?? '', [...(pickedByModel.get(p.houseModelId ?? '') ?? []), p])
    const emptyTargets = [...new Set(runnable.map((p) => target[p.id]).filter((id) => modelById.get(id)?.lines === 0))]

    const modelSelect = (value: string, onChange: (v: string) => void, label: string, placeholder: string) => (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
      >
        <option value="">{placeholder}</option>
        {(overview?.models ?? []).map((m) => (
          <option key={m.id} value={m.id}>
            {modelLabel(m)} · {m.lines ? `${m.lines} รายการ` : 'ไม่มี BOQ'}
          </option>
        ))}
      </select>
    )

    return (
      <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-3">
          {groups.map(([modelId, ps]) => (
            <div key={modelId || 'none'} className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">{modelLabel(modelById.get(modelId))}</span>
                <button
                  type="button"
                  className="text-xs text-indigo-600 hover:underline"
                  onClick={() => setPicked((prev) => new Set([...prev, ...ps.map((p) => p.id)]))}
                >
                  เลือกทั้งหมด
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ps.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={picked.has(p.id)}
                    onClick={() => togglePlot(p.id)}
                    className={`rounded-lg border px-2.5 py-1 text-sm tabular-nums ${
                      picked.has(p.id) ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="px-1 text-xs text-slate-500">แสดงเฉพาะแปลงที่มีงานแล้ว {overview.plots.length} แปลง</p>
        </div>

        <div className="space-y-3">
          {emptyTargets.map((mid) => {
            const sources = [...new Set(runnable.filter((p) => target[p.id] === mid).map((p) => p.houseModelId).filter((x): x is string => !!x))]
            const chosen = seedFor(mid)
            return (
              <div key={mid} className="flex gap-2 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div className="space-y-2">
                  <div>
                    <b>{modelLabel(modelById.get(mid))} ยังไม่มีรายการ BOQ</b> ระบบจะคัดลอก BOQ ของแบบเดิมเข้าไปให้ (ชื่อ หน่วย จำนวน ราคา วัสดุ) แล้วย้ายงานไปที่รายการเหล่านั้น
                  </div>
                  {sources.length > 1 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={`seed-${mid}`} className="text-xs">คัดลอกจากแบบนี้ก่อน</label>
                      <select
                        id={`seed-${mid}`}
                        value={chosen ?? ''}
                        onChange={(e) => setSeed((prev) => ({ ...prev, [mid]: e.target.value }))}
                        className="rounded-lg border border-indigo-200 bg-white px-2 py-1 text-sm"
                      >
                        {sources.map((s) => (
                          <option key={s} value={s}>
                            {modelLabel(modelById.get(s))} · {modelById.get(s)?.lines ?? 0} รายการ
                          </option>
                        ))}
                      </select>
                      <span className="text-xs">แบบอื่นจะจับคู่ชื่อตรง/คล้ายกับรายการที่คัดลอกมา ที่ขาดจะคัดลอกเพิ่ม</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {pickedPlots.length === 0 && <p className="text-sm text-slate-500">ยังไม่ได้เลือกแปลง</p>}

          {[...pickedByModel.entries()].map(([modelId, ps]) => (
            <div key={modelId || 'none'} className="rounded-xl border border-slate-200 p-3">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">
                {modelLabel(modelById.get(modelId))} <span className="font-normal text-slate-500">{ps.length} แปลง</span>
              </h3>
              <div className="mb-2 flex items-center gap-3 border-b border-slate-100 pb-2">
                <span className="shrink-0 text-xs text-slate-500">ตั้งแบบใหม่ทั้งกลุ่ม</span>
                {modelSelect(
                  '',
                  (v) => {
                    if (!v) return
                    setTarget((prev) => ({ ...prev, ...Object.fromEntries(ps.map((p) => [p.id, v])) }))
                  },
                  'ตั้งทั้งกลุ่ม',
                  '— เลือกเพื่อใช้กับทุกแปลง —'
                )}
              </div>
              <div className="divide-y divide-slate-100">
                {ps.map((p) => {
                  const t = target[p.id] ?? ''
                  const sameAsOld = t && t === p.houseModelId
                  return (
                    <div key={p.id} className="grid items-center gap-2 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
                      <div className="text-sm">
                        <b className="tabular-nums">แปลง {p.name}</b>
                        <span className="text-slate-500"> · {p.jobs} งาน · จ่ายแล้ว {baht(p.paid)}</span>
                        {sameAsOld && <div className="text-xs text-amber-600">เป็นแบบนี้อยู่แล้ว แปลงนี้จะถูกข้าม</div>}
                      </div>
                      {modelSelect(t, (v) => setTarget((prev) => ({ ...prev, [p.id]: v })), `แบบใหม่ของแปลง ${p.name}`, '— เลือกแบบใหม่ —')}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-500">ราคา ช่าง ความคืบหน้า ใบเบิก และการจ่ายเงินของทุกงานอยู่ตามเดิม ไม่มีอะไรถูกลบหรือซ่อน</p>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- step 2
  function plotStatus(id: string): { cls: string; label: string } {
    if (reviewErrors[id]) return { cls: 'bg-red-100 text-red-700', label: 'โหลดไม่ได้' }
    if (!reviews[id]) return { cls: 'bg-slate-100 text-slate-600', label: '…' }
    const pr = predicted(id)
    if (pr.approvedJobs > 0) return { cls: 'bg-amber-100 text-amber-800', label: `เปลี่ยนจำนวน ${pr.approvedJobs}` }
    return { cls: 'bg-emerald-100 text-emerald-700', label: 'ตรงกัน' }
  }

  function setChoice(plotId: string, jobId: string, choice: HtcJobChoice) {
    setPlotState((prev) => ({ ...prev, [plotId]: { ...prev[plotId], choices: { ...prev[plotId].choices, [jobId]: choice } } }))
  }
  function toggleNewJob(plotId: string, key: string) {
    setPlotState((prev) => {
      const set = new Set(prev[plotId].newJobs)
      if (set.has(key)) set.delete(key)
      else set.add(key)
      return { ...prev, [plotId]: { ...prev[plotId], newJobs: set } }
    })
  }

  function renderStep2() {
    if (reviewing) return <p className="text-sm text-slate-500">กำลังตรวจสอบงานและยอดเงินของแต่ละแปลง…</p>
    const skipped = pickedPlots.filter((p) => !runnable.includes(p))
    const r = focus ? reviews[focus] : null
    const st = focus ? plotState[focus] : null
    const pr = focus ? predicted(focus) : null
    const nonePaired = runnable.length === 0

    return (
      <div className="grid gap-4 md:grid-cols-[230px_minmax(0,1fr)]">
        <div className="space-y-1">
          {runnable.map((p) => {
            const s = plotStatus(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setFocus(p.id)}
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm ${
                  focus === p.id ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <b className="tabular-nums">{p.name}</b>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                  {modelLabel(modelById.get(p.houseModelId ?? ''))} → {modelLabel(modelById.get(target[p.id]))}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>
              </button>
            )
          })}
          {skipped.length > 0 && (
            <p className="px-1 pt-2 text-xs text-amber-700">
              ข้าม {skipped.length} แปลงที่ยังไม่ได้เลือกแบบใหม่ (หรือเป็นแบบเดิม): {skipped.map((p) => p.name).join(', ')}
            </p>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          {nonePaired && <p className="text-sm text-slate-500">ไม่มีแปลงที่พร้อมตรวจ กลับไปเลือกแบบใหม่ก่อน</p>}
          {focus && reviewErrors[focus] && <p className="text-sm text-red-600">{reviewErrors[focus]}</p>}
          {r && st && pr && focus && (
            <>
              {r.seeded && (
                <div className="flex gap-2 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <div>แบบใหม่ยังไม่มี BOQ รายการด้านล่างคือรายการที่จะถูกคัดลอกเข้าแบบใหม่ก่อนย้ายงาน</div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['งาน', `${r.totals.jobs}`],
                  ['มีช่าง', `${r.totals.contractors}`],
                  ['จ่ายแล้ว', baht(r.totals.paid)],
                  ['ใบเบิกรวม', baht(r.totals.billed)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-slate-200 p-2">
                    <div className="text-xs text-slate-500">{k}</div>
                    <div className="text-sm font-semibold tabular-nums">{v}</div>
                  </div>
                ))}
              </div>

              <table className="w-full text-sm">
                <caption className="pb-1 text-left text-xs font-semibold text-slate-600">ตรวจยอดเงินก่อน/หลัง</caption>
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-1 text-left font-medium">รายการ</th>
                    <th className="py-1 text-right font-medium">ก่อน</th>
                    <th className="py-1 text-right font-medium">หลัง</th>
                    <th className="py-1 text-right font-medium">ผล</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  <tr className="border-b border-slate-100">
                    <td className="py-1">จ่ายแล้วรวม</td>
                    <td className="text-right">{baht(r.totals.paid)}</td>
                    <td className="text-right">{baht(r.totals.paid)}</td>
                    <td className="text-right text-emerald-600">ตรงกัน</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-1">ใบเบิกรวม</td>
                    <td className="text-right">{baht(r.totals.billed)}</td>
                    <td className="text-right">{baht(r.totals.billed)}</td>
                    <td className="text-right text-emerald-600">ตรงกัน</td>
                  </tr>
                  <tr>
                    <td className="py-1">มูลค่าสัญญารวม</td>
                    <td className="text-right">{baht(r.totals.contract)}</td>
                    <td className="text-right">{baht(pr.after)}</td>
                    <td className={`text-right ${Math.abs(pr.after - r.totals.contract) < 0.005 ? 'text-emerald-600' : 'text-amber-700'}`}>
                      {Math.abs(pr.after - r.totals.contract) < 0.005 ? 'ตรงกัน' : `ต่าง ${baht(pr.after - r.totals.contract)}`}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="text-xs text-slate-500">ยอดจ่ายและใบเบิกต้องตรงกันทุกบาท ถ้าต่างแม้ 1 บาท ระบบจะไม่เปลี่ยนแปลงนั้นและบอกว่างานไหนต่าง</p>

              <table className="w-full table-fixed text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="w-[24%] py-1 text-left font-medium">งานเดิม</th>
                    <th className="w-[12%] py-1 text-left font-medium">ช่าง</th>
                    <th className="w-[11%] py-1 text-right font-medium">จ่ายแล้ว</th>
                    <th className="w-[27%] py-1 pl-2 text-left font-medium">ไปที่รายการ</th>
                    <th className="w-[12%] py-1 text-right font-medium">จำนวน</th>
                    <th className="w-[14%] py-1 text-right font-medium">ราคาที่คงไว้</th>
                  </tr>
                </thead>
                <tbody>
                  {r.jobs.map((j) => {
                    const c = st.choices[j.id] ?? { mode: 'copy' as const }
                    const line = c.mode === 'line' ? r.lines.find((l) => l.key === c.lineKey) : undefined
                    const pairKind = r.pairs.find((x) => x.jobId === j.id)?.kind
                    const qtyDiffers = !!line && Math.abs(line.qty - j.qty) >= 0.0001
                    const usedElsewhere = new Set(
                      Object.entries(st.choices)
                        .filter(([id, ch]) => id !== j.id && ch.mode === 'line')
                        .map(([, ch]) => (ch as { lineKey: string }).lineKey)
                    )
                    return (
                      <tr key={j.id} className="border-b border-slate-100 align-top">
                        <td className="py-1.5 pr-2 break-words">{j.name}</td>
                        <td className="py-1.5 pr-1 break-words text-slate-600">{j.contractor ?? '—'}</td>
                        <td className="py-1.5 text-right tabular-nums">{j.paid ? baht(j.paid) : '—'}</td>
                        <td className="py-1.5 pl-2">
                          <select
                            aria-label={`รายการปลายทางของ ${j.name}`}
                            value={c.mode === 'line' ? c.lineKey : ''}
                            onChange={(e) => setChoice(focus, j.id, e.target.value ? { mode: 'line', lineKey: e.target.value, useNewQty: false } : { mode: 'copy' })}
                            className={`w-full rounded-md border px-1.5 py-1 text-xs ${
                              c.mode === 'copy' ? 'border-slate-300' : pairKind === 'near' && c.lineKey === r.pairs.find((x) => x.jobId === j.id)?.lineKey ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300'
                            }`}
                          >
                            <option value="">คัดลอกรายการเดิมเข้าแบบใหม่</option>
                            {r.lines.map((l) => (
                              <option key={l.key} value={l.key} disabled={usedElsewhere.has(l.key)}>
                                {l.name}
                                {l.virtual ? ' (คัดลอกจากแบบต้นทาง)' : ''}
                              </option>
                            ))}
                          </select>
                          {c.mode === 'line' && pairKind === 'near' && c.lineKey === r.pairs.find((x) => x.jobId === j.id)?.lineKey && (
                            <div className="mt-0.5 text-[11px] text-indigo-600">≈ ชื่อคล้ายกัน ตรวจดูก่อน</div>
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {qtyFmt(j.qty)}
                          {qtyDiffers && line && (
                            <div className="text-[11px] text-amber-700">
                              ใหม่ {qtyFmt(line.qty)}
                              <label className="mt-0.5 flex items-center justify-end gap-1">
                                <input
                                  type="checkbox"
                                  checked={c.mode === 'line' && c.useNewQty}
                                  onChange={(e) => setChoice(focus, j.id, { mode: 'line', lineKey: (c as { lineKey: string }).lineKey, useNewQty: e.target.checked })}
                                />
                                ใช้จำนวนใหม่
                              </label>
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {baht(j.price)}
                          {line && Math.abs(line.price - j.price) >= 0.005 && <div className="text-[11px] text-slate-400">แบบใหม่ {baht(line.price)}</div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="text-xs text-slate-500">
                จำนวนต่างกัน: ค่าเริ่มต้นคือคัดลอกรายการเดิมเข้าแบบใหม่ให้มูลค่าสัญญาเท่าเดิม ติ๊ก “ใช้จำนวนใหม่” ถ้าอนุมัติจำนวนของแบบใหม่
              </p>

              {r.unpaired.length > 0 && (
                <div className="rounded-xl border border-slate-200 p-3">
                  <h4 className="mb-1 text-sm font-semibold text-slate-800">รายการของแบบใหม่ที่ยังไม่มีงานในแปลงนี้</h4>
                  <p className="mb-2 text-xs text-slate-500">ติ๊กเพื่อสร้างงานใหม่ (ยังไม่มีช่าง เลือกช่างภายหลัง) รายการที่ชื่อคล้ายงานเดิมจะไม่ถูกติ๊กไว้ให้</p>
                  <div className="space-y-1">
                    {r.unpaired.map((u) => {
                      const l = r.lines.find((x) => x.key === u.key)
                      if (!l) return null
                      return (
                        <label key={u.key} className="flex items-start gap-2 text-sm">
                          <input type="checkbox" className="mt-1" checked={st.newJobs.has(u.key)} onChange={() => toggleNewJob(focus, u.key)} />
                          <span className="min-w-0 flex-1">
                            {l.name} <span className="text-xs text-slate-500">· {qtyFmt(l.qty)} {l.unit ?? ''} · {baht(l.price)}</span>
                            {u.similarTo && <span className="block text-xs text-amber-700">คล้าย “{u.similarTo}” อาจเป็นงานเดียวกัน</span>}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- step 3
  function renderStep3() {
    const blocked = runnable.filter((p) => !reviews[p.id])
    return (
      <div className="space-y-3">
        <div className="flex gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            ระบบ “ลองทำจริงโดยไม่บันทึก” กับแต่ละแปลงก่อน (ผ่านทุกกฎของฐานข้อมูลและเช็กยอดจ่าย ใบเบิก มูลค่าสัญญาทุกบาท) แล้วย้อนกลับให้ทั้งหมด
            เฉพาะแปลงที่ผ่านเท่านั้นที่กดเปลี่ยนจริงได้ เมื่อทำจริงจะบันทึกสำรองไว้ และใช้ปุ่ม “คืนค่า” ย้อนกลับได้ภายหลัง
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="py-1 text-left font-medium">แปลง</th>
              <th className="py-1 text-left font-medium">แบบเดิม → แบบใหม่</th>
              <th className="py-1 text-right font-medium">งานที่ย้าย</th>
              <th className="py-1 text-right font-medium">รายการที่คัดลอก</th>
              <th className="py-1 text-right font-medium">งานใหม่</th>
              <th className="py-1 text-right font-medium">จ่ายแล้ว</th>
              <th className="py-1 pl-3 text-left font-medium">ผลตรวจ</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {readyPlots.map((p) => {
              const plan = planFor(p.id)
              const r = reviews[p.id]
              const pr = predicted(p.id)
              return (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="py-1.5 font-semibold">{p.name}</td>
                  <td className="py-1.5 font-sans text-xs text-slate-600">
                    {modelLabel(modelById.get(p.houseModelId ?? ''))} → {modelLabel(modelById.get(target[p.id]))}
                    {pr.approvedJobs > 0 && <span className="ml-1 text-amber-700">(อนุมัติจำนวนใหม่ {pr.approvedJobs} งาน)</span>}
                  </td>
                  <td className="py-1.5 text-right">{plan?.moves.length ?? 0}</td>
                  <td className="py-1.5 text-right">{pr.copies}</td>
                  <td className="py-1.5 text-right">{plan?.newJobs.length ?? 0}</td>
                  <td className="py-1.5 text-right">{baht(r.totals.paid)}</td>
                  <td className="py-1.5 pl-3 font-sans text-xs">
                    {checking || !checks[p.id] ? (
                      <span className="text-slate-500">กำลังตรวจ…</span>
                    ) : checks[p.id].ok ? (
                      <span className="text-emerald-700">✓ ผ่าน ยอดตรงกัน</span>
                    ) : (
                      <span className="text-red-700">
                        ✗ {(checks[p.id] as { error: string }).error}
                        {((checks[p.id] as { diffs?: { job_id: string | null; field: string }[] }).diffs ?? []).slice(0, 3).map((d, i) => (
                          <span key={i} className="block text-[11px]">
                            {r.jobs.find((j) => j.id === d.job_id)?.name ?? 'รวมทั้งแปลง'} · {d.field}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {blocked.length > 0 && (
          <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>แปลง {blocked.map((p) => p.name).join(', ')} โหลดข้อมูลไม่สำเร็จ จะไม่ถูกเปลี่ยนในรอบนี้</div>
          </div>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------- step 4
  function renderStep4() {
    if (!results) return null
    const okCount = results.filter((r) => r.ok).length
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-700">
          สำเร็จ {okCount} แปลง · ย้อนกลับ/ไม่สำเร็จ {results.length - okCount} แปลง
        </p>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {results.map((r) => {
            const msg = r.ok ? revertMsg[r.runId] : undefined
            const isReverted = r.ok && reverted.has(r.runId)
            return (
              <div key={r.plotId} className="p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {r.ok ? (
                    isReverted ? <RotateCcw className="h-4 w-4 text-slate-500" aria-hidden /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-600" aria-hidden />
                  )}
                  <b className="tabular-nums">แปลง {plotName(r.plotId)}</b>
                  <span className="text-slate-600">
                    {r.ok
                      ? isReverted
                        ? 'คืนค่าแล้ว'
                        : `เปลี่ยนแล้ว · ย้าย ${r.moved} งาน · คัดลอก ${r.copiedLines} รายการ · งานใหม่ ${r.newJobs}`
                      : 'ย้อนกลับ ไม่มีอะไรเปลี่ยน'}
                  </span>
                  <span className="flex-1" />
                  <Link href={`/dashboard/projects/${projectId}/${r.plotId}`} className="text-xs text-indigo-600 hover:underline">
                    เปิดแปลง
                  </Link>
                  {r.ok && !isReverted && (
                    <Button size="sm" variant="secondary" disabled={reverting === r.runId} onClick={() => revert(r.runId, r.runId)}>
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      {reverting === r.runId ? 'กำลังคืนค่า…' : 'คืนค่า'}
                    </Button>
                  )}
                </div>
                {!r.ok && (
                  <div className="mt-1 text-red-700">
                    {r.error}
                    {r.diffs && r.diffs.length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-xs">
                        {r.diffs.slice(0, 8).map((d, i) => {
                          const jobName = reviews[r.plotId]?.jobs.find((j) => j.id === d.job_id)?.name
                          return (
                            <li key={i}>
                              {jobName ?? d.job_id ?? 'รวมทั้งแปลง'} · {d.field}: {JSON.stringify(d.before)} → {JSON.stringify(d.after)}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
                {msg && <div className={`mt-1 text-xs ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</div>}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- history
  function renderHistory() {
    if (runsError) return <p className="text-sm text-red-600">{runsError}</p>
    if (!runs) return <p className="text-sm text-slate-500">กำลังโหลด…</p>
    if (runs.length === 0) return <p className="text-sm text-slate-500">ยังไม่เคยเปลี่ยนแบบบ้านในโครงการนี้</p>
    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500">
            <th className="py-1 text-left font-medium">วันที่</th>
            <th className="py-1 text-left font-medium">แปลง</th>
            <th className="py-1 text-left font-medium">แบบเดิม → แบบใหม่</th>
            <th className="py-1 text-right font-medium">งานที่ย้าย</th>
            <th className="py-1 text-right font-medium">จ่ายแล้ว</th>
            <th className="py-1 text-left font-medium pl-3">สถานะ</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {runs.map((r) => (
            <tr key={r.id} className="border-b border-slate-100 align-top">
              <td className="py-1.5 whitespace-nowrap">{new Date(r.createdAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td className="py-1.5 font-semibold">{r.plotName}</td>
              <td className="py-1.5 font-sans text-xs text-slate-600">{r.oldModel} → {r.newModel}</td>
              <td className="py-1.5 text-right">{r.moved}</td>
              <td className="py-1.5 text-right">{baht(r.paidTotal)}</td>
              <td className="py-1.5 pl-3 font-sans">
                {r.status === 'reverted' ? (
                  <span className="text-slate-500">คืนค่าแล้ว</span>
                ) : (
                  <Button size="sm" variant="secondary" disabled={reverting === r.id} onClick={() => revert(r.id, r.id)}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    {reverting === r.id ? 'กำลังคืนค่า…' : 'คืนค่า'}
                  </Button>
                )}
                {revertMsg[r.id] && <div className={`mt-1 text-xs ${revertMsg[r.id].ok ? 'text-emerald-700' : 'text-red-700'}`}>{revertMsg[r.id].text}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  // ---------------------------------------------------------------- frame
  const header = (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      {view === 'wizard' ? (
        <>
          {STEP_NAMES.map((n, i) => (
            <span
              key={n}
              className={`rounded-full px-2.5 py-1 ${i + 1 === step ? 'bg-indigo-600 text-white' : i + 1 < step ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
            >
              {i + 1 < step ? '✓ ' : ''}
              {i + 1}. {n}
            </span>
          ))}
          <span className="flex-1" />
          <button type="button" className="text-indigo-600 hover:underline" onClick={openHistory}>
            ประวัติ / คืนค่า
          </button>
        </>
      ) : (
        <>
          <b className="text-sm text-slate-800">ประวัติการเปลี่ยนแบบบ้าน</b>
          <span className="flex-1" />
          <button type="button" className="text-indigo-600 hover:underline" onClick={() => setView('wizard')}>
            กลับไปตัวช่วย
          </button>
        </>
      )}
    </div>
  )

  const footer =
    view === 'history' ? (
      <div className="flex w-full justify-end gap-2">
        <Button variant="secondary" onClick={() => setView('wizard')}>กลับ</Button>
      </div>
    ) : (
      <div className="flex w-full flex-wrap items-center gap-2">
        <span className="flex-1 text-xs text-slate-500">
          {step === 1 && `${runnable.length} แปลงพร้อมตรวจ`}
          {step === 2 && `${readyPlots.length} แปลงพร้อมตรวจ`}
          {step === 3 && !checking && `ผ่าน ${passedPlots.length} จาก ${readyPlots.length} แปลง`}
        </span>
        {step === 1 && (
          <>
            <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
            <Button disabled={runnable.length === 0} onClick={goReview}>ถัดไป: ตรวจ {runnable.length} แปลง</Button>
          </>
        )}
        {step === 2 && (
          <>
            <Button variant="secondary" onClick={() => setStep(1)}>ย้อนกลับ</Button>
            <Button disabled={reviewing || readyPlots.length === 0} onClick={goConfirm}>ถัดไป: ตรวจก่อนทำจริง</Button>
          </>
        )}
        {step === 3 && (
          <>
            <Button variant="secondary" disabled={running || checking} onClick={() => setStep(2)}>ย้อนกลับ</Button>
            <Button disabled={running || checking || passedPlots.length === 0} onClick={run}>
              {running ? 'กำลังเปลี่ยน…' : `เปลี่ยนแบบบ้าน ${passedPlots.length} แปลง`}
            </Button>
          </>
        )}
        {step === 4 && <Button onClick={onClose}>ปิด</Button>}
      </div>
    )

  return (
    <Modal isOpen onClose={onClose} title="เปลี่ยนแบบบ้าน" panelClassName="max-w-6xl" footer={footer}>
      {header}
      {view === 'history' ? renderHistory() : step === 1 ? renderStep1() : step === 2 ? renderStep2() : step === 3 ? renderStep3() : renderStep4()}
      {changed && view === 'wizard' && step !== 4 && <p className="mt-3 text-xs text-emerald-700">มีการเปลี่ยนแปลงแล้ว หน้าโครงการจะรีเฟรชเมื่อปิด</p>}
    </Modal>
  )
}
