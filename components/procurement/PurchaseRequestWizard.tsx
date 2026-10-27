'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Check, ChevronLeft, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { getProjects } from '@/actions/project-actions'
import { getPlotsByProjectId } from '@/actions/plot-actions'
import { getMaterialPickerOptions, getPlotGroups } from '@/actions/material-actions'
import { createPurchaseRequest, getBoqJobOptionsForPlots } from '@/actions/procurement-actions'
import { getBoqRemainingForRequest, type BoqRemainingRow } from '@/actions/procurement/boq-control'
import { getUnitConversions } from '@/actions/procurement/unit-conversions'
import UnitConversionNote from '@/components/procurement/UnitConversionNote'
import PurchasePurposePicker, { usePurchasePurpose, type PurchasePurpose } from '@/components/procurement/PurchasePurposePicker'
import { toBaseQty, UNKNOWN_CONVERSION_LABEL, type UnitConversions } from '@/lib/procurement/units'
import { todayInBangkok } from '@/lib/utils'
import type { MaterialPickerOption, PlotGroup } from '@/lib/types/materials'

type SubmitResult = { id: string; pr_no: string } | { error: string }
type CreateFn = (payload: Parameters<typeof createPurchaseRequest>[0]) => Promise<SubmitResult>

type Line = {
  key: number
  material_type_id: number
  material_name: string
  masterUnit: string
  quantity: string
  /** The unit sent with the line; the master unit unless the requester picked another. */
  unit: string
  otherUnit: boolean
  note: string
  boq_id: string | null
  showMore: boolean
}

const OTHER = '__other__'

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function recentKey(projectId: string) {
  return `pr-recent-plots:${projectId}`
}

function readRecent(projectId: string): string[] {
  try {
    const raw = window.localStorage.getItem(recentKey(projectId))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeRecent(projectId: string, plotIds: string[]) {
  try {
    const merged = [...plotIds, ...readRecent(projectId).filter((id) => !plotIds.includes(id))].slice(0, 8)
    window.localStorage.setItem(recentKey(projectId), JSON.stringify(merged))
  } catch {
    // Remembering recent plots is a convenience only.
  }
}

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 })

/**
 * New purchase request in three steps: which plots, which materials, when
 * it is needed. Nothing here blocks sending: asking for more than the BOQ
 * leaves shows an amber "PM จะเห็น", and a unit with no known conversion is
 * sent as written (it is just not compared to the BOQ until purchasing
 * records how many of it make one of the master unit).
 */
export default function PurchaseRequestWizard({
  onSaved,
  onCancel,
  createAction = createPurchaseRequest,
  initialPurpose,
  initialLines,
  initialScope,
}: {
  onSaved: (result: { id: string; pr_no: string }) => void
  onCancel: () => void
  createAction?: CreateFn
  initialPurpose?: PurchasePurpose
  initialLines?: { material_type_id: number; quantity: number }[]
  /** Prefill the plots (e.g. "ขอใหม่จากใบนี้"). */
  initialScope?: { projectId: string; plotIds: string[] }
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [projects, setProjects] = useState<{ id: string; name: string; location: string | null; kind?: string | null }[]>([])
  const [plots, setPlots] = useState<{ id: string; name: string }[]>([])
  const [plotGroups, setPlotGroups] = useState<PlotGroup[]>([])
  const [materials, setMaterials] = useState<MaterialPickerOption[]>([])
  const [projectId, setProjectId] = useState(initialScope?.projectId || '')
  const [plotIds, setPlotIds] = useState<string[]>(initialScope?.plotIds || [])
  const [plotGroupId, setPlotGroupId] = useState('')
  const [plotQuery, setPlotQuery] = useState('')
  const [recentIds, setRecentIds] = useState<string[]>([])
  const [showOtherPurpose, setShowOtherPurpose] = useState(initialPurpose === 'store' || initialPurpose === 'overhead')
  const [showGroups, setShowGroups] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [nextKey, setNextKey] = useState(1)
  const [neededBy, setNeededBy] = useState('')
  const [neededMode, setNeededMode] = useState<'' | 'tomorrow' | 'three' | 'week' | 'pick'>('')
  const [note, setNote] = useState('')
  const [remaining, setRemaining] = useState<BoqRemainingRow[]>([])
  const [conversions, setConversions] = useState<UnitConversions>({})
  const [conversionsRev, setConversionsRev] = useState(0)
  const [boqJobOptions, setBoqJobOptions] = useState<{ id: string; item_name: string; label: string }[]>([])
  const [loadingPlots, setLoadingPlots] = useState(false)

  const { purpose, setPurpose, projectsForPurpose } = usePurchasePurpose(
    projects,
    projectId,
    (id) => {
      setProjectId(id)
      setPlotIds([])
      setPlotGroupId('')
    },
    initialPurpose
  )
  const forProject = purpose === 'project'

  useEffect(() => {
    let cancelled = false
    Promise.all([getProjects({ includeOverhead: true }), getMaterialPickerOptions()])
      .then(([p, m]) => {
        if (cancelled) return
        setProjects(p)
        setMaterials(m)
        if (initialPurpose === 'store') {
          const store = p.find((proj: { kind?: string | null }) => proj.kind === 'store')
          if (store) setProjectId(store.id)
        }
        if (initialLines && initialLines.length > 0) {
          setLines(
            initialLines.map((l, i) => {
              const mat = m.find((x) => x.id === l.material_type_id)
              return {
                key: i + 1,
                material_type_id: l.material_type_id,
                material_name: mat?.name || '-',
                masterUnit: mat?.unit || '',
                quantity: l.quantity > 0 ? String(l.quantity) : '',
                unit: mat?.unit || '',
                otherUnit: false,
                note: '',
                boq_id: null,
                showMore: false,
              }
            })
          )
          setNextKey(initialLines.length + 1)
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ'))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    Promise.all([getPlotsByProjectId(projectId), getPlotGroups(projectId)])
      .then(([p, g]) => {
        if (cancelled) return
        setPlots(p || [])
        setPlotGroups(g)
        setRecentIds(readRecent(projectId))
        setLoadingPlots(false)
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadingPlots(false)
          toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลแปลงไม่สำเร็จ')
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const groupPlotIds = useMemo(() => plotGroups.find((g) => g.id === plotGroupId)?.member_plot_ids || [], [plotGroups, plotGroupId])
  const scopePlotIds = plotGroupId ? groupPlotIds : plotIds
  const scopeKey = `${projectId}|${plotGroupId}|${plotIds.join(',')}`

  // What is left to ask for, for the plots chosen in step 1.
  useEffect(() => {
    let cancelled = false
    if (!forProject || !projectId || (plotIds.length === 0 && !plotGroupId)) {
      return
    }
    getBoqRemainingForRequest({
      projectId,
      plotGroupId: plotIds.length === 0 ? plotGroupId || null : null,
      plotIds,
    })
      .then((rows) => {
        if (!cancelled) setRemaining(rows)
      })
      .catch(() => {
        if (!cancelled) setRemaining([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, forProject])

  const hasScope = forProject && (plotIds.length > 0 || !!plotGroupId)
  const remainingByMaterial = useMemo(() => new Map((hasScope ? remaining : []).map((r) => [r.materialTypeId, r])), [remaining, hasScope])

  const scopeIdsKey = scopePlotIds.join(',')
  const jobOptions = scopePlotIds.length > 0 ? boqJobOptions : []
  useEffect(() => {
    let cancelled = false
    if (scopePlotIds.length === 0) return
    getBoqJobOptionsForPlots(scopePlotIds)
      .then((jobs) => {
        if (!cancelled) setBoqJobOptions(jobs)
      })
      .catch(() => {
        if (!cancelled) setBoqJobOptions([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeIdsKey])

  const materialIdsKey = lines.map((l) => l.material_type_id).join(',')
  useEffect(() => {
    let cancelled = false
    const ids = materialIdsKey ? materialIdsKey.split(',').map(Number) : []
    if (ids.length === 0) return
    getUnitConversions(ids)
      .then((c) => {
        if (!cancelled) setConversions(c)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [materialIdsKey, conversionsRev])

  const canSetConversion = createAction === createPurchaseRequest

  function addMaterial(materialId: number, quantity?: number) {
    const mat = materials.find((m) => m.id === materialId)
    if (!mat) return
    setLines((prev) => {
      if (prev.some((l) => l.material_type_id === materialId)) return prev
      return [
        ...prev,
        {
          key: nextKey,
          material_type_id: mat.id,
          material_name: mat.name,
          masterUnit: mat.unit,
          quantity: quantity && quantity > 0 ? String(quantity) : '',
          unit: mat.unit,
          otherUnit: false,
          note: '',
          boq_id: null,
          showMore: false,
        },
      ]
    })
    setNextKey((n) => n + 1)
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function togglePlot(id: string) {
    setPlotGroupId('')
    setPlotIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function goStep2() {
    if (!projectId) {
      toast.error(purpose === 'store' ? 'ไม่พบโครงการสโตร์กลางในระบบ' : 'กรุณาเลือกโครงการ')
      return
    }
    // A request for a project with no plot can't be turned into a purchase
    // order later: the order needs a plot, a group or "outside BOQ", and has
    // nothing to copy from the request.
    if (forProject && plotIds.length === 0 && !plotGroupId) {
      toast.error('กรุณาเลือกแปลงที่ใช้ (หรือเปลี่ยนเป็นสโตร์ / ค่าใช้จ่ายส่วนกลาง)')
      return
    }
    setStep(2)
  }

  function goStep3() {
    if (!lines.some((l) => l.material_type_id && Number(l.quantity) > 0)) {
      toast.error('กรุณาเพิ่มวัสดุและจำนวนอย่างน้อย 1 รายการ')
      return
    }
    setStep(3)
  }

  function chooseNeeded(mode: 'tomorrow' | 'three' | 'week' | 'pick') {
    setNeededMode(mode)
    const today = todayInBangkok()
    if (mode === 'tomorrow') setNeededBy(addDays(today, 1))
    else if (mode === 'three') setNeededBy(addDays(today, 3))
    else if (mode === 'week') setNeededBy(addDays(today, 7))
  }

  function submit() {
    const valid = lines.filter((l) => l.material_type_id && Number(l.quantity) > 0)
    if (valid.length === 0) {
      toast.error('กรุณาเพิ่มรายการวัสดุอย่างน้อย 1 รายการ')
      return
    }
    const ids = plotGroupId ? [] : plotIds
    const payload = {
      project_id: projectId,
      plot_id: ids.length === 1 ? ids[0] : null,
      plot_group_id: plotGroupId || null,
      plot_ids: ids.length > 1 ? ids : [],
      note,
      needed_by_date: neededBy,
      items: valid.map((l) => ({
        material_type_id: l.material_type_id,
        quantity_requested: Number(l.quantity),
        unit: l.unit.trim() || null,
        note: l.note,
        boq_id: l.boq_id,
      })),
    }
    startTransition(async () => {
      try {
        const result = await createAction(payload)
        if ('error' in result) {
          toast.error(result.error)
          return
        }
        if (projectId && ids.length > 0) writeRecent(projectId, ids)
        onSaved(result)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ส่งคำขอซื้อไม่สำเร็จ')
      }
    })
  }

  const projectOptions = projectsForPurpose.map((p) => ({ value: p.id, label: p.name, sublabel: p.location || undefined }))
  const q = plotQuery.trim().toLowerCase()
  const shownPlots = q ? plots.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 30) : []
  const recentPlots = recentIds.map((id) => plots.find((p) => p.id === id)).filter((p): p is { id: string; name: string } => !!p)
  const selectedPlots = plotIds.map((id) => plots.find((p) => p.id === id)).filter((p): p is { id: string; name: string } => !!p)
  const materialOptions = materials.filter((m) => !lines.some((l) => l.material_type_id === m.id)).map((m) => ({ value: String(m.id), label: `${m.name} (${m.unit})` }))
  const suggestions = remaining.filter((r) => r.remaining > 0 && !lines.some((l) => l.material_type_id === r.materialTypeId)).slice(0, 12)

  const steps = ['แปลง', 'วัสดุ', 'ต้องการเมื่อไร']

  return (
    <div className="space-y-5">
      <ol className="flex items-center gap-2 text-xs" aria-label="ขั้นตอน">
        {steps.map((label, i) => {
          const n = i + 1
          const done = step > n
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  step === n ? 'bg-indigo-600 text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : n}
              </span>
              <span className={step === n ? 'font-medium text-slate-800' : 'text-slate-500'}>{label}</span>
              {n < steps.length && <span className="text-slate-300">—</span>}
            </li>
          )
        })}
      </ol>

      {step === 1 && (
        <div className="space-y-4">
          {!showOtherPurpose ? (
            <p className="text-xs text-slate-500">
              ซื้อเข้าสโตร์หรือค่าใช้จ่ายส่วนกลาง?{' '}
              <button type="button" className="text-indigo-600 hover:underline" onClick={() => setShowOtherPurpose(true)}>
                เลือกที่นี่
              </button>
            </p>
          ) : (
            <PurchasePurposePicker value={purpose} onChange={setPurpose} />
          )}

          {purpose !== 'store' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{purpose === 'overhead' ? 'หมวดค่าใช้จ่าย' : 'โครงการ'}</label>
              <SearchableSelect
                options={projectOptions}
                value={projectId}
                onChange={(id) => {
                  setLoadingPlots(true)
                  setProjectId(id)
                  setPlotIds([])
                  setPlotGroupId('')
                }}
                placeholder={purpose === 'overhead' ? 'เลือกหมวด' : 'เลือกโครงการ'}
              />
            </div>
          )}

          {forProject && projectId && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">แปลงที่ใช้</label>
              {loadingPlots ? (
                <p className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังโหลดแปลง...
                </p>
              ) : (
                <>
                  <input
                    value={plotQuery}
                    onChange={(e) => setPlotQuery(e.target.value)}
                    placeholder="พิมพ์เลขแปลง เช่น 103 แล้วกดเลือก"
                    className="w-full"
                    inputMode="search"
                  />
                  {selectedPlots.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedPlots.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => togglePlot(p.id)}
                          className="rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white"
                          aria-label={`เอาแปลง ${p.name} ออก`}
                        >
                          {p.name} ✕
                        </button>
                      ))}
                    </div>
                  )}
                  {shownPlots.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {shownPlots
                        .filter((p) => !plotIds.includes(p.id))
                        .map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => togglePlot(p.id)}
                            className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                          >
                            + {p.name}
                          </button>
                        ))}
                    </div>
                  )}
                  {recentPlots.length > 0 && !q && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-slate-500">ล่าสุด:</span>
                      {recentPlots
                        .filter((p) => !plotIds.includes(p.id))
                        .map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => togglePlot(p.id)}
                            className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                          >
                            {p.name}
                          </button>
                        ))}
                    </div>
                  )}
                  {plotGroups.length > 0 && (
                    <p className="text-xs text-slate-500">
                      {showGroups ? (
                        <span className="block">
                          <span className="mb-1 block">กลุ่มแปลงที่บันทึกไว้</span>
                          <SearchableSelect
                            options={plotGroups.map((g) => ({
                              value: g.id,
                              label: g.name,
                              sublabel: g.member_plot_names.length === 0 ? 'ยังไม่มีแปลงในกลุ่ม' : `${g.member_plot_names.length} แปลง: ${g.member_plot_names.join(', ')}`,
                            }))}
                            value={plotGroupId}
                            onChange={(id) => {
                              setPlotGroupId(id)
                              setPlotIds([])
                            }}
                            placeholder="เลือกกลุ่มแปลง"
                          />
                        </span>
                      ) : (
                        <button type="button" className="text-indigo-600 hover:underline" onClick={() => setShowGroups(true)}>
                          ใช้กลุ่มแปลงที่บันทึกไว้
                        </button>
                      )}
                    </p>
                  )}
                  <p className="text-xs text-slate-500">ไม่เลือกแปลงก็ส่งได้ ระบบจะไม่เทียบ BOQ ให้</p>
                </>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={onCancel}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={goStep2}>
              ต่อไป: เลือกวัสดุ
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">เพิ่มวัสดุ</label>
            <SearchableSelect
              options={materialOptions}
              value=""
              onChange={(v) => addMaterial(Number(v))}
              placeholder="พิมพ์ชื่อวัสดุเพื่อค้นหา"
            />
          </div>

          {suggestions.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">ตาม BOQ ที่ยังเหลือให้ขอ</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s.materialTypeId}
                    type="button"
                    onClick={() => addMaterial(s.materialTypeId)}
                    className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                  >
                    + {s.materialName} <span className="text-slate-500">เหลือ {fmt(s.remaining)} {s.unit}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">ยังไม่มีวัสดุ ค้นหาด้านบน หรือกดจากรายการที่เหลือ</p>
          ) : (
            <ul className="space-y-2">
              {lines.map((line) => {
                const qty = Number(line.quantity) || 0
                const known = Array.from(new Set(Object.keys(conversions[line.material_type_id] || {})))
                const unitOptions = [line.masterUnit, ...known.filter((u) => u !== line.masterUnit)]
                const selectValue = line.otherUnit ? OTHER : unitOptions.includes(line.unit) ? line.unit : OTHER
                const base = toBaseQty(conversions, line.material_type_id, line.masterUnit, line.unit, qty)
                const rem = remainingByMaterial.get(line.material_type_id)
                const over = rem != null && qty > 0 && base != null && base > rem.remaining
                return (
                  <li key={line.key} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm font-medium text-slate-800">{line.material_name}</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                        placeholder="จำนวน"
                        className="w-24"
                        aria-label={`จำนวน ${line.material_name}`}
                      />
                      <select
                        value={selectValue}
                        onChange={(e) => {
                          if (e.target.value === OTHER) updateLine(line.key, { otherUnit: true, unit: '' })
                          else updateLine(line.key, { otherUnit: false, unit: e.target.value })
                        }}
                        className="w-28"
                        aria-label={`หน่วย ${line.material_name}`}
                      >
                        {unitOptions.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                        <option value={OTHER}>หน่วยอื่น…</option>
                      </select>
                      {(line.otherUnit || selectValue === OTHER) && (
                        <input
                          type="text"
                          value={line.unit}
                          onChange={(e) => updateLine(line.key, { unit: e.target.value, otherUnit: true })}
                          placeholder="พิมพ์หน่วย เช่น เส้น"
                          className="w-28"
                          aria-label="หน่วยอื่น"
                        />
                      )}
                      <button
                        type="button"
                        aria-label={`ลบ ${line.material_name}`}
                        onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                        className="rounded-lg p-2 text-slate-300 hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <UnitConversionNote
                      materialTypeId={line.material_type_id}
                      masterUnit={line.masterUnit}
                      unit={line.unit}
                      quantity={qty}
                      conversions={conversions}
                      onSaved={() => setConversionsRev((n) => n + 1)}
                      canSet={canSetConversion}
                    />
                    {rem && (
                      <p className={`mt-1 text-xs ${over ? 'text-amber-800' : 'text-slate-500'}`}>
                        {over ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium">
                            เกิน BOQ · เหลือให้ขอ {fmt(Math.max(rem.remaining, 0))} {rem.unit} · PM จะเห็น (ส่งได้ตามปกติ)
                          </span>
                        ) : (
                          <>BOQ เหลือให้ขอ {fmt(Math.max(rem.remaining, 0))} {rem.unit}</>
                        )}
                      </p>
                    )}
                    {qty > 0 && base == null && line.unit.trim() !== '' && (
                      <p className="mt-0.5 text-[11px] text-slate-500">{UNKNOWN_CONVERSION_LABEL}</p>
                    )}
                    <div className="mt-1">
                      {line.showMore ? (
                        <div className="space-y-2">
                          {jobOptions.length > 0 && (
                            <SearchableSelect
                              options={jobOptions.map((j) => ({ value: j.id, label: j.label }))}
                              value={line.boq_id || ''}
                              onChange={(v) => updateLine(line.key, { boq_id: v || null })}
                              placeholder="สำหรับงาน (ไม่ระบุก็ได้)"
                            />
                          )}
                          <input
                            type="text"
                            value={line.note}
                            onChange={(e) => updateLine(line.key, { note: e.target.value })}
                            placeholder="หมายเหตุสำหรับรายการนี้ (ถ้ามี)"
                            className="w-full text-sm"
                          />
                        </div>
                      ) : (
                        <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => updateLine(line.key, { showMore: true })}>
                          เพิ่มหมายเหตุ / ระบุงาน
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setStep(1)}>
              <ChevronLeft className="h-4 w-4" /> กลับ
            </Button>
            <Button type="button" onClick={goStep3}>
              ต่อไป: ต้องการเมื่อไร
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ต้องการใช้ของเมื่อไร</label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="ต้องการภายใน">
              {([
                ['tomorrow', 'พรุ่งนี้'],
                ['three', 'ภายใน 3 วัน'],
                ['week', 'สัปดาห์หน้า'],
                ['pick', 'เลือกวัน'],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={neededMode === mode}
                  onClick={() => chooseNeeded(mode)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    neededMode === mode ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {neededMode === 'pick' && <input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className="mt-2" />}
            {neededMode !== 'pick' && neededBy && <p className="mt-1 text-xs text-slate-500">ภายในวันที่ {new Date(neededBy).toLocaleDateString('th-TH')}</p>}
            <p className="mt-1 text-xs text-slate-500">ไม่ระบุก็ส่งได้</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">หมายเหตุ (ถ้ามี)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} className="w-full" rows={2} />
          </div>

          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            {lines
              .filter((l) => Number(l.quantity) > 0)
              .map((l) => (
                <p key={l.key}>
                  {l.material_name} · {fmt(Number(l.quantity))} {l.unit}
                </p>
              ))}
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setStep(2)}>
              <ChevronLeft className="h-4 w-4" /> กลับ
            </Button>
            <Button type="button" onClick={submit} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Plus className="h-4 w-4" /> ส่งคำขอซื้อ</>)}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
