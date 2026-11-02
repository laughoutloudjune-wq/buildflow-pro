'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { getProjects } from '@/actions/project-actions'
import { getPlotsByProjectId } from '@/actions/plot-actions'
import { getMaterialPickerOptions, getPlotGroups } from '@/actions/material-actions'
import { createPurchaseRequest, updatePurchaseRequest, getBoqJobOptionsForPlots } from '@/actions/procurement-actions'
import type { PurchaseRequest } from '@/lib/types/procurement'
import type { MaterialPickerOption, PlotGroup } from '@/lib/types/materials'
import { getBoqRemainingForRequest, type BoqRemainingRow } from '@/actions/procurement/boq-control'
import { getUnitConversions } from '@/actions/procurement/unit-conversions'
import UnitConversionNote from '@/components/procurement/UnitConversionNote'
import { toBaseQty, UNKNOWN_CONVERSION_LABEL, type UnitConversions } from '@/lib/procurement/units'
import PurchasePurposePicker, { usePurchasePurpose, type PurchasePurpose } from '@/components/procurement/PurchasePurposePicker'

type PlotScope = 'none' | 'plot' | 'group' | 'multi'
const OTHER_UNIT = '__other__'
const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 })
type Line = {
  material_type_id: number
  quantity_requested: string
  /** Prefilled from the picked material's catalog unit, editable - for a
   * material asked for in a different unit than it's catalogued in (e.g.
   * counting pieces for something catalogued by the box). */
  unit: string
  /** The material's catalog unit - what the BOQ is counted in. */
  masterUnit: string
  /** "หน่วยอื่น…" picked: the unit box is a free text field. */
  otherUnit: boolean
  note: string
  boq_id: string | null
  /** "+ งาน / หมายเหตุ" clicked: show the job picker and note box. */
  extraOpen?: boolean
  /** This line's own material name, from its joined material_types row
   * (unfiltered by is_active) - falls back to this when the material isn't
   * in the active-only picker list anymore, so a deactivated material still
   * shows its real name on a request that already asked for it, instead of
   * a blank picker box. Null for a freshly-added line. */
  material_name: string | null
}

type SubmitResult = { id: string; pr_no: string } | { error: string }
type CreateFn = (payload: Parameters<typeof createPurchaseRequest>[0]) => Promise<SubmitResult>
type UpdateFn = (id: string, payload: Parameters<typeof createPurchaseRequest>[0]) => Promise<SubmitResult>

function PurchaseRequestEditForm({
  mode,
  requestId,
  initialRequest,
  onSaved,
  onCancel,
  // No prices/suppliers/POs ever appear in this component - only the
  // create/update call itself differs by caller. Defaults to the
  // procurement-gated actions; the foreman purchase-request page (which
  // can't reach the procurement module) passes its own foreman-gated
  // create action instead (W-01) - same form, same validation, different
  // permission check server-side.
  createAction = createPurchaseRequest,
  updateAction = updatePurchaseRequest,
  initialPurpose,
  initialLines,
  initialScope,
}: {
  mode: 'create' | 'edit'
  requestId?: string
  initialRequest?: PurchaseRequest | null
  onSaved: (result: { id: string; pr_no: string }) => void
  onCancel: () => void
  createAction?: CreateFn
  updateAction?: UpdateFn
  /** Create mode only: open on this purpose (e.g. the low-stock list's restock button). */
  initialPurpose?: PurchasePurpose
  /** Create mode only: prefilled lines (material + quantity). */
  initialLines?: { material_type_id: number; quantity: number }[]
  /** Create mode only: prefilled project and plots. */
  initialScope?: { projectId: string; plotIds: string[] }
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [projects, setProjects] = useState<{ id: string; name: string; location: string | null; kind?: string | null }[]>([])
  const [plots, setPlots] = useState<{ id: string; name: string }[]>([])
  const [plotGroups, setPlotGroups] = useState<PlotGroup[]>([])
  const [isPlotsLoading, setIsPlotsLoading] = useState(false)
  const [materials, setMaterials] = useState<MaterialPickerOption[]>([])
  const [projectId, setProjectId] = useState('')
  const [plotScopeChoice, setPlotScope] = useState<PlotScope>(mode === 'create' ? 'multi' : 'none')
  const [plotId, setPlotId] = useState('')
  const [plotGroupId, setPlotGroupId] = useState('')
  const [plotIds, setPlotIds] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [neededByDate, setNeededByDate] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [boqJobOptions, setBoqJobOptions] = useState<{ id: string; item_name: string; label: string }[]>([])
  const [remaining, setRemaining] = useState<BoqRemainingRow[]>([])
  const [conversions, setConversions] = useState<UnitConversions>({})
  const [conversionsRev, setConversionsRev] = useState(0)
  const { purpose, setPurpose, projectsForPurpose } = usePurchasePurpose(
    projects,
    projectId,
    (id) => {
      setProjectId(id)
      setPlotScope(mode === 'create' ? 'multi' : 'none')
    },
    initialPurpose
  )
  // Plots only belong to a project purchase - a scope left over from before
  // switching purpose is ignored, not saved.
  const plotScope: PlotScope = purpose === 'project' ? plotScopeChoice : 'none'

  useEffect(() => {
    async function bootstrap() {
      const [p, m] = await Promise.all([getProjects({ includeOverhead: true }), getMaterialPickerOptions()])
      setProjects(p)
      setMaterials(m)

      if (mode === 'edit' && initialRequest) {
        setProjectId(initialRequest.project_id)
        if (initialRequest.plot_group_id) {
          setPlotScope('group')
          setPlotGroupId(initialRequest.plot_group_id)
        } else if (initialRequest.plot_id) {
          setPlotScope('plot')
          setPlotId(initialRequest.plot_id)
        } else if (initialRequest.purchase_request_plots && initialRequest.purchase_request_plots.length > 0) {
          setPlotScope('multi')
          setPlotIds(initialRequest.purchase_request_plots.map((pl) => pl.plot_id))
        }
        setNote(initialRequest.note || '')
        setNeededByDate(initialRequest.needed_by_date || '')
        setLines(
          (initialRequest.purchase_request_items || []).map((i) => ({
            material_type_id: i.material_type_id,
            quantity_requested: String(i.quantity_requested),
            // Falls back to the material's current catalog unit for a line
            // saved before this field existed (unit is null) - same prefill
            // a brand-new line gets.
            unit: i.unit || m.find((mat) => mat.id === i.material_type_id)?.unit || '',
            masterUnit: m.find((mat) => mat.id === i.material_type_id)?.unit || i.material_types?.unit || '',
            otherUnit: false,
            note: i.note || '',
            boq_id: i.boq_id,
            material_name: i.material_types?.name || null,
          }))
        )
      } else if (mode === 'create' && initialLines && initialLines.length > 0) {
        setLines(
          initialLines.map((l) => {
            const mat = m.find((mat) => mat.id === l.material_type_id)
            return {
              material_type_id: l.material_type_id,
              quantity_requested: l.quantity > 0 ? String(l.quantity) : '',
              unit: mat?.unit || '',
              masterUnit: mat?.unit || '',
              otherUnit: false,
              note: '',
              boq_id: null,
              material_name: mat?.name || null,
            }
          })
        )
      }
      if (mode === 'create' && initialScope?.projectId) {
        setProjectId(initialScope.projectId)
        if (initialScope.plotIds.length > 0) {
          setPlotScope('multi')
          setPlotIds(initialScope.plotIds)
        }
      }
      if (mode === 'create' && initialPurpose === 'store') {
        const store = p.find((proj: { kind?: string | null }) => proj.kind === 'store')
        if (store) setProjectId(store.id)
      }
    }
    void bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!projectId) {
      setPlots([])
      setPlotGroups([])
      return
    }
    setIsPlotsLoading(true)
    Promise.all([getPlotsByProjectId(projectId), getPlotGroups(projectId)])
      .then(([p, g]) => {
        setPlots(p || [])
        setPlotGroups(g)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลแปลงไม่สำเร็จ'))
      .finally(() => setIsPlotsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Picking a material from the search box adds a row and moves the cursor to
  // its quantity; Enter there returns to the search box for the next one.
  function addMaterial(material: MaterialPickerOption) {
    const index = lines.length
    setLines((prev) => [
      ...prev,
      {
        material_type_id: material.id,
        quantity_requested: '',
        unit: material.unit || '',
        masterUnit: material.unit || '',
        otherUnit: false,
        note: '',
        boq_id: null,
        material_name: material.name,
      },
    ])
    setTimeout(() => document.getElementById(`pr-qty-${index}`)?.focus(), 0)
  }

  // The BOQ job picker's options: every job belonging to any plot currently
  // in scope's house model. Resolved the same way regardless of which of
  // the three plot-scope shapes is active, since a saved group's members
  // aren't otherwise available client-side.
  const resolvedPlotIds =
    plotScope === 'plot' && plotId
      ? [plotId]
      : plotScope === 'multi'
        ? plotIds
        : plotScope === 'group' && plotGroupId
          ? plotGroups.find((g) => g.id === plotGroupId)?.member_plot_ids || []
          : []

  useEffect(() => {
    if (resolvedPlotIds.length === 0) {
      setBoqJobOptions([])
      return
    }
    getBoqJobOptionsForPlots(resolvedPlotIds)
      .then(setBoqJobOptions)
      .catch(() => setBoqJobOptions([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedPlotIds.join(',')])

  // What the BOQ still allows for the plots chosen, shown under each line.
  const hasScope = purpose === 'project' && !!projectId && resolvedPlotIds.length > 0
  useEffect(() => {
    let cancelled = false
    if (!hasScope) return
    getBoqRemainingForRequest({
      projectId,
      plotGroupId: plotScope === 'group' ? plotGroupId || null : null,
      plotIds: plotScope === 'group' ? [] : resolvedPlotIds,
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
  }, [hasScope, projectId, plotScope, plotGroupId, resolvedPlotIds.join(',')])
  const remainingByMaterial = useMemo(() => new Map((hasScope ? remaining : []).map((r) => [r.materialTypeId, r])), [remaining, hasScope])

  const materialIdsKey = lines.map((l) => l.material_type_id).join(',')
  useEffect(() => {
    let cancelled = false
    const ids = materialIdsKey ? materialIdsKey.split(',').map(Number).filter(Boolean) : []
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

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  function handleSubmit() {
    if (!projectId) {
      toast.error(purpose === 'store' ? 'ไม่พบโครงการสโตร์กลางในระบบ' : 'กรุณาเลือกโครงการ')
      return
    }
    if (purpose === 'project' && plotScope === 'none') {
      toast.error('กรุณาเลือกแปลงที่ใช้ (หรือเปลี่ยนเป็นสโตร์ / ค่าใช้จ่ายส่วนกลาง)')
      return
    }
    if (plotScope === 'plot' && !plotId) {
      toast.error('กรุณาเลือกแปลง')
      return
    }
    if (plotScope === 'group' && !plotGroupId) {
      toast.error('กรุณาเลือกกลุ่มแปลง')
      return
    }
    if (plotScope === 'multi' && plotIds.length === 0) {
      toast.error('กรุณาเลือกแปลงอย่างน้อย 1 แปลง')
      return
    }
    const validLines = lines.filter((l) => l.material_type_id && Number(l.quantity_requested) > 0)
    if (validLines.length === 0) {
      toast.error('กรุณาเพิ่มรายการวัสดุอย่างน้อย 1 รายการ')
      return
    }

    const payload = {
      project_id: projectId,
      plot_id: plotScope === 'plot' ? plotId : null,
      plot_group_id: plotScope === 'group' ? plotGroupId : null,
      plot_ids: plotScope === 'multi' ? plotIds : [],
      note,
      needed_by_date: neededByDate,
      items: validLines.map((l) => ({
        material_type_id: l.material_type_id,
        quantity_requested: Number(l.quantity_requested),
        unit: l.unit.trim() || null,
        note: l.note,
        boq_id: l.boq_id,
      })),
    }

    startTransition(async () => {
      try {
        const result =
          mode === 'edit' && requestId ? await updateAction(requestId, payload) : await createAction(payload)
        if ('error' in result) {
          toast.error(result.error)
          return
        }
        toast.success(mode === 'edit' ? 'บันทึกการแก้ไขแล้ว' : 'ส่งคำขอซื้อเรียบร้อยแล้ว')
        onSaved(result)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : mode === 'edit' ? 'บันทึกการแก้ไขไม่สำเร็จ' : 'ส่งคำขอซื้อไม่สำเร็จ')
      }
    })
  }

  const projectOptions = projectsForPurpose.map((p) => ({ value: p.id, label: p.name, sublabel: p.location || undefined }))
  const plotOptions = plots.map((p) => ({ value: p.id, label: p.name }))
  const plotGroupOptions = plotGroups.map((g) => ({
    value: g.id,
    label: g.name,
    sublabel: g.member_plot_names.length === 0 ? 'ยังไม่มีแปลงในกลุ่ม' : `${g.member_plot_names.length} แปลง: ${g.member_plot_names.join(', ')}`,
  }))

  return (
    <div className="space-y-4">
      <PurchasePurposePicker value={purpose} onChange={setPurpose} />

      {purpose !== 'store' && (
        <div className="grid grid-cols-2 gap-4">
          <div className={purpose === 'project' ? '' : 'col-span-2'}>
            <label className="mb-1 block text-sm font-medium text-slate-700">{purpose === 'overhead' ? 'หมวดค่าใช้จ่าย' : 'โครงการ'}</label>
            <SearchableSelect
              options={projectOptions}
              value={projectId}
              onChange={setProjectId}
              placeholder={purpose === 'overhead' ? 'เลือกหมวด' : 'เลือกโครงการ'}
            />
          </div>
          {purpose === 'project' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">โครงการย่อย / แปลง</label>
              <select value={plotScope} onChange={(e) => setPlotScope(e.target.value as PlotScope)} className="w-full" disabled={!projectId}>
                <option value="none">ไม่ระบุ</option>
                <option value="plot" disabled={plots.length === 0}>แปลงเดียว</option>
                <option value="multi" disabled={plots.length === 0}>หลายแปลง (เลือกเอง)</option>
                <option value="group" disabled={plotGroups.length === 0}>กลุ่มที่บันทึกไว้</option>
              </select>
            </div>
          )}
        </div>
      )}

      {purpose === 'project' && plotScope !== 'none' && (
        <div>
          {isPlotsLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังโหลดข้อมูลแปลง...
            </div>
          ) : plotScope === 'plot' ? (
            <>
              <label className="mb-1 block text-sm font-medium text-slate-700">เลือกแปลง</label>
              <SearchableSelect options={plotOptions} value={plotId} onChange={setPlotId} placeholder="เลือกแปลง" />
            </>
          ) : plotScope === 'multi' ? (
            <>
              <label className="mb-1 block text-sm font-medium text-slate-700">เลือกแปลง (เลือกได้หลายแปลง)</label>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {plots.map((p) => {
                  const checked = plotIds.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlotIds((prev) => (prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]))}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                        checked ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {p.name}
                    </button>
                  )
                })}
              </div>
              {plotIds.length > 0 && <p className="mt-1 text-xs text-slate-500">เลือกแล้ว {plotIds.length} แปลง</p>}
            </>
          ) : (
            <>
              <label className="mb-1 block text-sm font-medium text-slate-700">เลือกกลุ่มแปลง</label>
              <SearchableSelect options={plotGroupOptions} value={plotGroupId} onChange={setPlotGroupId} placeholder="เลือกกลุ่มแปลง" />
            </>
          )}
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">ต้องการภายในวันที่</label>
        <input type="date" value={neededByDate} onChange={(e) => setNeededByDate(e.target.value)} className="w-full" />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">รายการวัสดุ</label>
        {lines.length > 0 && (
          <div className="space-y-2">
            {lines.map((line, i) => {
              // A line whose material was deactivated after it was requested
              // is not in the active-only list: its own joined name is used.
              const lineName =
                line.material_name || materials.find((m) => m.id === line.material_type_id)?.name || 'วัสดุที่ปิดใช้งานแล้ว'
              const extraOpen = !!line.extraOpen || !!line.boq_id || line.note.trim() !== ''
              return (
              <div key={i} className="rounded-lg border border-slate-200 p-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800" title={lineName}>
                    {lineName}
                  </div>
                  <input
                    id={`pr-qty-${i}`}
                    type="number"
                    min="0"
                    step="any"
                    value={line.quantity_requested}
                    onChange={(e) => updateLine(i, { quantity_requested: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        document.getElementById('pr-material-search')?.focus()
                      }
                    }}
                    placeholder="จำนวน"
                    className="w-24"
                  />
                  {(() => {
                    const known = Object.keys(conversions[line.material_type_id] || {})
                    const unitOptions = line.masterUnit ? [line.masterUnit, ...known.filter((u) => u !== line.masterUnit)] : known
                    const selectValue = line.otherUnit ? OTHER_UNIT : unitOptions.includes(line.unit) ? line.unit : line.unit ? OTHER_UNIT : ''
                    return (
                      <>
                        <select
                          value={selectValue}
                          onChange={(e) => {
                            if (e.target.value === OTHER_UNIT) updateLine(i, { otherUnit: true, unit: '' })
                            else updateLine(i, { otherUnit: false, unit: e.target.value })
                          }}
                          className="w-28"
                          aria-label="หน่วย"
                          title="หน่วยที่ขอ - เลือกหน่วยอื่นได้ถ้าต้องการขอต่างจากหน่วยของวัสดุในระบบ"
                        >
                          {unitOptions.length === 0 && <option value="">หน่วย</option>}
                          {unitOptions.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                          <option value={OTHER_UNIT}>หน่วยอื่น…</option>
                        </select>
                        {selectValue === OTHER_UNIT && (
                          <input
                            type="text"
                            value={line.unit}
                            onChange={(e) => updateLine(i, { unit: e.target.value, otherUnit: true })}
                            placeholder="พิมพ์หน่วย เช่น เส้น"
                            className="w-28"
                            aria-label="หน่วยอื่น"
                          />
                        )}
                      </>
                    )
                  })()}
                  <button type="button" aria-label="ลบรายการ" onClick={() => removeLine(i)} className="rounded-lg p-2 text-slate-300 hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {line.material_type_id > 0 && (
                  <LineHints
                    line={line}
                    conversions={conversions}
                    remaining={remainingByMaterial.get(line.material_type_id)}
                    onConversionSaved={() => setConversionsRev((n) => n + 1)}
                    canSetConversion={createAction === createPurchaseRequest}
                  />
                )}
                {extraOpen ? (
                  <>
                    <div className="mt-2">
                      {boqJobOptions.length > 0 ? (
                        <SearchableSelect
                          options={boqJobOptions.map((j) => ({ value: j.id, label: j.label }))}
                          value={line.boq_id || ''}
                          onChange={(v) => updateLine(i, { boq_id: v || null })}
                          placeholder="สำหรับงาน (ไม่ระบุก็ได้)"
                        />
                      ) : (
                        <p className="text-xs text-slate-500">เลือกแปลงก่อน จึงจะระบุได้ว่าวัสดุนี้สำหรับงานใด (ไม่บังคับ)</p>
                      )}
                    </div>
                    <input
                      type="text"
                      value={line.note}
                      onChange={(e) => updateLine(i, { note: e.target.value })}
                      placeholder="หมายเหตุสำหรับรายการนี้ (ถ้ามี)"
                      className="mt-2 w-full text-sm"
                    />
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => updateLine(i, { extraOpen: true })}
                    className="mt-1 text-xs font-medium text-indigo-600 hover:underline"
                  >
                    + งาน / หมายเหตุ
                  </button>
                )}
              </div>
              )
            })}
          </div>
        )}

        <MaterialSearch
          materials={materials}
          remainingByMaterial={remainingByMaterial}
          hasLines={lines.length > 0}
          onPick={addMaterial}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">หมายเหตุ</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} className="w-full" rows={2} />
      </div>

      <div className="flex justify-end gap-3 border-t pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          ยกเลิก
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'edit' ? 'บันทึกการแก้ไข' : 'ส่งคำขอซื้อ'}
        </Button>
      </div>
    </div>
  )
}

/** Under a line: how the unit relates to the master unit, and what the BOQ
 * still allows (a warning only - the request is sent either way). */
function LineHints({
  line,
  conversions,
  remaining,
  onConversionSaved,
  canSetConversion,
}: {
  line: Line
  conversions: UnitConversions
  remaining: BoqRemainingRow | undefined
  onConversionSaved: () => void
  canSetConversion: boolean
}) {
  const qty = Number(line.quantity_requested) || 0
  const base = toBaseQty(conversions, line.material_type_id, line.masterUnit, line.unit, qty)
  const over = remaining != null && qty > 0 && base != null && base > remaining.remaining
  return (
    <div className="mt-1">
      <UnitConversionNote
        materialTypeId={line.material_type_id}
        masterUnit={line.masterUnit}
        unit={line.unit}
        quantity={qty}
        conversions={conversions}
        onSaved={onConversionSaved}
        canSet={canSetConversion}
      />
      {remaining && (
        <p className={`mt-1 text-xs ${over ? 'text-amber-800' : 'text-slate-500'}`}>
          {over ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium">
              เกิน BOQ · เหลือให้ขอ {fmt(Math.max(remaining.remaining, 0))} {remaining.unit} · PM จะเห็น (ส่งได้ตามปกติ)
            </span>
          ) : (
            <>BOQ เหลือให้ขอ {fmt(Math.max(remaining.remaining, 0))} {remaining.unit}</>
          )}
        </p>
      )}
      {qty > 0 && base == null && line.unit.trim() !== '' && (
        <p className="mt-0.5 text-[11px] text-slate-500">{UNKNOWN_CONVERSION_LABEL}</p>
      )}
    </div>
  )
}

/** The one way to add a material: a big search box under the list. Only
 * materials already in the catalog can be picked. */
function MaterialSearch({
  materials,
  remainingByMaterial,
  hasLines,
  onPick,
}: {
  materials: MaterialPickerOption[]
  remainingByMaterial: Map<number, BoqRemainingRow>
  hasLines: boolean
  onPick: (m: MaterialPickerOption) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q ? materials.filter((m) => m.name.toLowerCase().includes(q)) : materials
    // Materials the BOQ allows for these plots come first.
    return [...matched]
      .sort((a, b) => Number(remainingByMaterial.has(b.id)) - Number(remainingByMaterial.has(a.id)))
      .slice(0, 30)
  }, [materials, query, remainingByMaterial])

  function pick(m: MaterialPickerOption) {
    onPick(m)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className={`relative ${hasLines ? 'mt-3' : ''}`}>
      {!hasLines && (
        <p className="mb-2 rounded-lg border border-dashed border-slate-200 py-4 text-center text-sm text-slate-500">
          ยังไม่มีรายการ พิมพ์ชื่อวัสดุด้านล่างเพื่อเพิ่ม
        </p>
      )}
      <div className="relative">
        <Plus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-500" />
        <input
          id="pr-material-search"
          type="text"
          value={query}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (results[0]) pick(results[0])
            }
          }}
          placeholder="+ พิมพ์ชื่อวัสดุที่จะขอ"
          className="w-full rounded-xl border-2 border-indigo-200 py-3 pl-9 pr-3 text-base focus:border-indigo-500"
        />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-500">ไม่พบวัสดุนี้ในรายการ หากต้องการวัสดุใหม่ ให้แจ้งฝ่ายจัดซื้อเพิ่มให้</p>
          ) : (
            results.map((m) => {
              const r = remainingByMaterial.get(m.id)
              return (
                <button
                  key={m.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(m)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-indigo-50"
                >
                  <span className="min-w-0 truncate text-slate-800">
                    {m.name} <span className="text-slate-400">({m.unit})</span>
                  </span>
                  {r && (
                    <span className="shrink-0 text-xs text-slate-500">
                      BOQ เหลือ {fmt(Math.max(r.remaining, 0))} {r.unit}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

type FormProps = Parameters<typeof PurchaseRequestEditForm>[0]

/** One page for both creating and editing a request. */
export default function PurchaseRequestForm(props: FormProps) {
  return <PurchaseRequestEditForm {...props} />
}
