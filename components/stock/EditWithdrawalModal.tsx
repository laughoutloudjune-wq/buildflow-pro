'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useToast } from '@/components/ui/Toast'
import { getStockOverview, getStockWithdrawPickerOptions, editStockWithdrawal } from '@/actions/stock-actions'
import { getPlotsByProjectId } from '@/actions/plot-actions'
import { getPlotGroups } from '@/actions/material-actions'
import type { StockMovement, StockOverviewRow } from '@/lib/types/stock'
import type { PlotGroup } from '@/lib/types/materials'

type Line = { material_type_id: number | null; quantity: string; original: number }
type PlotScope = 'none' | 'plot' | 'group'

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 })

/** Edit a saved contractor withdrawal slip (เบิกวัสดุ): change contractor,
 * plot, note, add material or change quantities. More quantity is taken from
 * stock, less goes back - the database does the stock maths. */
export default function EditWithdrawalModal({
  rows,
  onClose,
  onSaved,
}: {
  /** Every stock_movements row of the slip (same source_id). */
  rows: StockMovement[]
  onClose: () => void
  onSaved: () => void
}) {
  const first = rows[0]
  const toast = useToast()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [materials, setMaterials] = useState<StockOverviewRow[]>([])
  const [contractors, setContractors] = useState<{ id: string; name: string }[]>([])
  const [plots, setPlots] = useState<{ id: string; name: string }[]>([])
  const [plotGroups, setPlotGroups] = useState<PlotGroup[]>([])
  const [contractorId, setContractorId] = useState(first.contractor_id || '')
  const [plotScope, setPlotScope] = useState<PlotScope>(first.plot_group_id ? 'group' : first.plot_id ? 'plot' : 'none')
  const [plotId, setPlotId] = useState(first.plot_id || '')
  const [plotGroupId, setPlotGroupId] = useState(first.plot_group_id || '')
  const [note, setNote] = useState(first.note || '')
  const [lines, setLines] = useState<Line[]>(() => {
    const byMaterial = new Map<number, number>()
    for (const r of rows) byMaterial.set(r.material_type_id, (byMaterial.get(r.material_type_id) || 0) + Number(r.quantity))
    return Array.from(byMaterial, ([id, qty]) => ({ material_type_id: id, quantity: String(qty), original: qty }))
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [overview, options, plotRows, groupRows] = await Promise.all([
          getStockOverview(),
          getStockWithdrawPickerOptions(),
          first.project_id ? getPlotsByProjectId(first.project_id) : Promise.resolve([]),
          first.project_id ? getPlotGroups(first.project_id) : Promise.resolve([] as PlotGroup[]),
        ])
        if (cancelled) return
        setMaterials(overview.rows)
        setContractors(options.contractors)
        setPlots((plotRows || []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
        setPlotGroups(groupRows)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const materialById = useMemo(() => new Map(materials.map((m) => [m.material_type_id, m])), [materials])
  const usedIds = new Set(lines.map((l) => l.material_type_id).filter((id): id is number => id !== null))
  const materialOptions = materials
    .filter((m) => m.is_requestable && !usedIds.has(m.material_type_id))
    .map((m) => ({ value: String(m.material_type_id), label: m.name, sublabel: `หน่วย: ${m.unit} · คงเหลือ: ${fmt(m.quantity_on_hand)}` }))

  // Extra quantity beyond what the slip already holds has to come from stock.
  const shortLines = lines.filter((l) => {
    if (l.material_type_id === null) return false
    const extra = Number(l.quantity) - l.original
    return extra > 0 && extra > (materialById.get(l.material_type_id)?.quantity_on_hand ?? 0)
  })
  const needsPlot = plots.length > 0
  const plotValid = (plotScope === 'none' && !needsPlot) || (plotScope === 'plot' && !!plotId) || (plotScope === 'group' && !!plotGroupId)
  const canSave =
    !isLoading && !!contractorId && plotValid && lines.length > 0 && lines.every((l) => l.material_type_id !== null && Number(l.quantity) > 0) && shortLines.length === 0

  async function save() {
    if (!canSave || !first.source_id) return
    setIsSaving(true)
    const result = await editStockWithdrawal(first.source_id, {
      contractor_id: contractorId,
      plot_id: plotScope === 'plot' ? plotId : null,
      plot_group_id: plotScope === 'group' ? plotGroupId : null,
      note,
      items: lines.map((l) => ({ material_type_id: l.material_type_id as number, quantity: Number(l.quantity) })),
    })
    setIsSaving(false)
    if ('error' in result) {
      toast.error(result.error)
      return
    }
    toast.success(`แก้ไขใบเบิก ${result.issue_no || ''} แล้ว — ปรับสต็อกให้ตรงแล้ว`.replace(/\s+/g, ' '))
    onSaved()
  }

  return (
    <Modal isOpen onClose={onClose} title={`แก้ไขใบเบิก ${first.issue_no || ''}`.trim()} panelClassName="max-w-2xl">
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            เพิ่มจำนวน = เบิกเพิ่มจากสต็อก (ใบเดิมเลขเดิม) · ลดจำนวนหรือลบรายการ = คืนเข้าสต็อก ทุกการแก้ไขมีประวัติบันทึกไว้ · โครงการแก้ไม่ได้ ({first.projects?.name || '-'})
          </p>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">ผู้รับเหมา</label>
            <SearchableSelect options={contractors.map((c) => ({ value: c.id, label: c.name }))} value={contractorId} onChange={setContractorId} placeholder="เลือกผู้รับเหมา" />
          </div>

          {(plots.length > 0 || plotGroups.length > 0 || plotScope !== 'none') && (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">แปลง</label>
              <div className="flex flex-wrap gap-3">
                {!needsPlot && (
                  <label className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input type="radio" checked={plotScope === 'none'} onChange={() => setPlotScope('none')} /> ทั้งโครงการ
                  </label>
                )}
                <label className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="radio" checked={plotScope === 'plot'} onChange={() => setPlotScope('plot')} disabled={plots.length === 0} /> แปลงเดียว
                </label>
                <label className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="radio" checked={plotScope === 'group'} onChange={() => setPlotScope('group')} disabled={plotGroups.length === 0} /> ทั้งกลุ่ม
                </label>
              </div>
              {plotScope === 'plot' && (
                <SearchableSelect className="mt-2" options={plots.map((p) => ({ value: p.id, label: p.name }))} value={plotId} onChange={setPlotId} placeholder="เลือกแปลง" />
              )}
              {plotScope === 'group' && (
                <SearchableSelect className="mt-2" options={plotGroups.map((g) => ({ value: g.id, label: g.name }))} value={plotGroupId} onChange={setPlotGroupId} placeholder="เลือกกลุ่มแปลง" />
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">รายการวัสดุ</label>
            <div className="space-y-2">
              {lines.map((line, i) => {
                const m = line.material_type_id !== null ? materialById.get(line.material_type_id) : undefined
                const name = m?.name || rows.find((r) => r.material_type_id === line.material_type_id)?.material_types?.name || 'วัสดุ'
                const unit = m?.unit || rows.find((r) => r.material_type_id === line.material_type_id)?.material_types?.unit || ''
                const extra = Number(line.quantity) - line.original
                return (
                  <div key={line.material_type_id ?? i} className="rounded-lg border border-slate-200 p-2">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 text-sm font-medium text-slate-800">{name}</div>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={line.quantity}
                        onChange={(e) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))}
                        className="w-24 text-right"
                        aria-label={`จำนวน ${name}`}
                      />
                      <span className="w-12 text-xs text-slate-500">{unit}</span>
                      <button type="button" aria-label="ลบรายการ" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} className="rounded-lg p-2 text-slate-300 hover:bg-red-50 hover:text-red-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {line.original > 0 ? `เดิม ${fmt(line.original)}` : 'รายการใหม่'} · คงเหลือในสต็อก {fmt(m?.quantity_on_hand ?? 0)}
                      {extra > 0 && <span className="text-indigo-600"> · เบิกเพิ่ม {fmt(extra)}</span>}
                      {extra < 0 && line.quantity !== '' && <span className="text-emerald-600"> · คืนสต็อก {fmt(-extra)}</span>}
                    </p>
                    {shortLines.includes(line) && <p className="mt-1 text-xs font-medium text-red-600">สต็อกไม่พอสำหรับส่วนที่เพิ่ม</p>}
                  </div>
                )
              })}
            </div>
            <div className="mt-2">
              <SearchableSelect
                options={materialOptions}
                value=""
                onChange={(v) => v && setLines((prev) => [...prev, { material_type_id: Number(v), quantity: '1', original: 0 }])}
                placeholder="+ เพิ่มวัสดุ (เบิกเพิ่มใบเดิม)"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">หมายเหตุ</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className="w-full" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={save} disabled={!canSave || isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึกการแก้ไข'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
