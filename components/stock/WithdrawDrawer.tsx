'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useToast } from '@/components/ui/Toast'
import { getStockOverview, getStockWithdrawPickerOptions, createStockWithdrawal } from '@/actions/stock-actions'
import { getPlotsByProjectId } from '@/actions/plot-actions'
import { getPlotGroups } from '@/actions/material-actions'
import type { StockOverviewRow } from '@/lib/types/stock'
import type { PlotGroup } from '@/lib/types/materials'

type Line = { material_type_id: number | null; quantity: string }
type PlotScope = 'none' | 'plot' | 'group'

// The backend hard-blocks a withdrawal that would take stock negative - a
// deliberate call, see the integration plan. This form disables Submit
// instead of letting people find that out after a failed round trip, but
// the message still needs translating for the rare race (someone else
// withdrew the same material in between loading this form and submitting).
function friendlyError(message: string): string {
  if (message.startsWith('Not enough stock')) return 'วัสดุในสต็อกไม่พอสำหรับจำนวนที่ระบุ กรุณาลดจำนวนหรือรีเฟรชข้อมูล'
  // Shouldn't be reachable since the picker already excludes these
  // materials, but the RPC enforces it too (defense in depth) - translate
  // it just in case the list is stale.
  if (message.includes('is set to receive-only')) return `${message.split(' is set to receive-only')[0]} เป็นวัสดุรับเข้าอย่างเดียว ไม่สามารถเบิกได้ กรุณารีเฟรชข้อมูล`
  if (message === 'project_id is required') return 'กรุณาเลือกโครงการ'
  if (message === 'contractor_id is required') return 'กรุณาเลือกผู้รับเหมา'
  if (message === 'No permission to withdraw stock') return 'คุณไม่มีสิทธิ์เบิกวัสดุ'
  if (message.startsWith('Choose either a single plot')) return 'กรุณาเลือกแปลงเดียวหรือกลุ่มแปลง อย่างใดอย่างหนึ่ง'
  return message
}

export default function WithdrawDrawer({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const [materials, setMaterials] = useState<StockOverviewRow[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [contractors, setContractors] = useState<{ id: string; name: string }[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [projectId, setProjectId] = useState('')
  const [contractorId, setContractorId] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const toast = useToast()

  const [plots, setPlots] = useState<{ id: string; name: string }[]>([])
  const [plotGroups, setPlotGroups] = useState<PlotGroup[]>([])
  const [isPlotsLoading, setIsPlotsLoading] = useState(false)
  const [plotScope, setPlotScope] = useState<PlotScope>('none')
  const [plotId, setPlotId] = useState('')
  const [plotGroupId, setPlotGroupId] = useState('')

  useEffect(() => {
    if (isOpen) void bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // A withdrawal can be for one plot, a whole batch of plots, or the project
  // in general (site-wide supplies aren't house-specific) - the picker
  // resets whenever the project changes since plots/groups belong to one
  // project.
  useEffect(() => {
    setPlotScope('none')
    setPlotId('')
    setPlotGroupId('')
    if (!projectId) {
      setPlots([])
      setPlotGroups([])
      return
    }
    setIsPlotsLoading(true)
    Promise.all([getPlotsByProjectId(projectId), getPlotGroups(projectId)])
      .then(([plotRows, groupRows]) => {
        setPlots((plotRows || []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
        setPlotGroups(groupRows)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลแปลงไม่สำเร็จ'))
      .finally(() => setIsPlotsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function bootstrap() {
    setIsLoading(true)
    try {
      const [overview, options] = await Promise.all([getStockOverview(), getStockWithdrawPickerOptions()])
      setMaterials(overview)
      setProjects(options.projects)
      setContractors(options.contractors)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  function resetForm() {
    setProjectId('')
    setContractorId('')
    setNote('')
    setLines([])
    setPlotScope('none')
    setPlotId('')
    setPlotGroupId('')
  }

  function handleClose() {
    resetForm()
    onClose()
  }

  // Bulk consumables (อิฐมวลเบา, ปูนถุง, etc.) are flagged is_requestable:
  // false because they get used immediately on delivery, not warehoused for
  // a later withdrawal - stock_request_create refuses them server-side too,
  // but filtering here means they never show up as a pickable option in the
  // first place, rather than letting someone pick one and then explaining
  // the rejection after the fact.
  const materialOptions = useMemo(
    () =>
      materials
        .filter((m) => m.is_requestable)
        .map((m) => ({
          value: String(m.material_type_id),
          label: m.name,
          sublabel: `${m.category || 'ไม่ระบุหมวดหมู่'} · หน่วย: ${m.unit} · คงเหลือ: ${m.quantity_on_hand.toLocaleString('th-TH')}`,
        })),
    [materials]
  )

  function onHandFor(materialTypeId: number | null): number {
    if (materialTypeId === null) return 0
    return materials.find((m) => m.material_type_id === materialTypeId)?.quantity_on_hand ?? 0
  }

  function addLine() {
    setLines((prev) => [...prev, { material_type_id: null, quantity: '1' }])
  }

  function updateLineMaterial(index: number, materialTypeId: number) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, material_type_id: materialTypeId } : l)))
  }

  function updateLineQuantity(index: number, quantity: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, quantity } : l)))
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  const usedIds = new Set(lines.map((l) => l.material_type_id).filter((id): id is number => id !== null))
  const shortLines = lines.filter((l) => l.material_type_id !== null && Number(l.quantity) > onHandFor(l.material_type_id))
  const plotSelectionValid =
    plotScope === 'none' || (plotScope === 'plot' && Boolean(plotId)) || (plotScope === 'group' && Boolean(plotGroupId))
  const canSubmit =
    Boolean(projectId) &&
    Boolean(contractorId) &&
    plotSelectionValid &&
    lines.length > 0 &&
    lines.every((l) => l.material_type_id !== null && Number(l.quantity) > 0) &&
    shortLines.length === 0

  async function handleSubmit() {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      await createStockWithdrawal({
        project_id: projectId,
        contractor_id: contractorId,
        plot_id: plotScope === 'plot' ? plotId : null,
        plot_group_id: plotScope === 'group' ? plotGroupId : null,
        note,
        items: lines.map((l) => ({ material_type_id: l.material_type_id as number, quantity: Number(l.quantity) })),
      })
      toast.success('บันทึกการเบิกวัสดุแล้ว')
      resetForm()
      onSuccess()
      onClose()
    } catch (error) {
      toast.error(friendlyError(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="เบิกวัสดุให้ผู้รับเหมา" panelClassName="max-w-2xl">
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">บันทึกทันที ไม่ต้องรออนุมัติ - การเบิกแบบเดียวกับที่ใช้บนแอปมือถือ</p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">โครงการ</label>
              <SearchableSelect
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                value={projectId}
                onChange={setProjectId}
                placeholder="เลือกโครงการ"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">ผู้รับเหมา</label>
              <SearchableSelect
                options={contractors.map((c) => ({ value: c.id, label: c.name }))}
                value={contractorId}
                onChange={setContractorId}
                placeholder="เลือกผู้รับเหมา"
              />
            </div>
          </div>

          {projectId && (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">แปลง</label>
              {isPlotsLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังโหลดข้อมูลแปลง...
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-3">
                    <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
                      <input type="radio" name="plot-scope" checked={plotScope === 'none'} onChange={() => setPlotScope('none')} />
                      ทั้งโครงการ (ไม่ระบุแปลง)
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="plot-scope"
                        checked={plotScope === 'plot'}
                        onChange={() => setPlotScope('plot')}
                        disabled={plots.length === 0}
                      />
                      แปลงเดียว
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="plot-scope"
                        checked={plotScope === 'group'}
                        onChange={() => setPlotScope('group')}
                        disabled={plotGroups.length === 0}
                      />
                      ทั้งกลุ่ม (หลายแปลง)
                    </label>
                  </div>
                  {plotScope === 'plot' && (
                    <SearchableSelect
                      className="mt-2"
                      options={plots.map((p) => ({ value: p.id, label: p.name }))}
                      value={plotId}
                      onChange={setPlotId}
                      placeholder="เลือกแปลง"
                    />
                  )}
                  {plotScope === 'group' && (
                    <SearchableSelect
                      className="mt-2"
                      options={plotGroups.map((g) => ({ value: g.id, label: g.name, sublabel: `${g.member_plot_names.length} แปลง: ${g.member_plot_names.join(', ')}` }))}
                      value={plotGroupId}
                      onChange={setPlotGroupId}
                      placeholder="เลือกกลุ่มแปลง"
                    />
                  )}
                  {plots.length === 0 && plotGroups.length === 0 && (
                    <p className="mt-1 text-xs text-slate-400">โครงการนี้ยังไม่มีแปลงหรือกลุ่มแปลงให้เลือก</p>
                  )}
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">รายการวัสดุ</label>
              <Button type="button" size="sm" variant="secondary" onClick={addLine}>
                <Plus className="h-3.5 w-3.5" /> เพิ่มรายการ
              </Button>
            </div>

            {lines.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
                ยังไม่มีรายการวัสดุ
              </div>
            ) : (
              <div className="space-y-2">
                {lines.map((line, index) => {
                  const onHand = onHandFor(line.material_type_id)
                  const isShort = line.material_type_id !== null && Number(line.quantity) > onHand
                  return (
                    <div key={index} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2">
                      <div className="flex-1">
                        <SearchableSelect
                          options={materialOptions.filter(
                            (o) => Number(o.value) === line.material_type_id || !usedIds.has(Number(o.value))
                          )}
                          value={line.material_type_id !== null ? String(line.material_type_id) : ''}
                          onChange={(v) => updateLineMaterial(index, Number(v))}
                          placeholder="เลือกวัสดุ"
                        />
                        {line.material_type_id !== null && (
                          <div className={`mt-1 text-xs ${isShort ? 'font-medium text-red-600' : 'text-slate-400'}`}>
                            คงเหลือในระบบ: {onHand.toLocaleString('th-TH')}
                            {isShort && ' · ไม่พอ'}
                          </div>
                        )}
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={line.quantity}
                        onChange={(e) => updateLineQuantity(index, e.target.value)}
                        className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm focus:border-indigo-400 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => removeLine(index)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label="ลบรายการ"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">หมายเหตุ</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
              placeholder="หมายเหตุเพิ่มเติม..."
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="secondary" onClick={handleClose}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : `บันทึกการเบิก (${lines.length} รายการ)`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
