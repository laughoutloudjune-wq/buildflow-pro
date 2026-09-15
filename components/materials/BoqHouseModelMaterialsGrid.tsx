'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useToast } from '@/components/ui/Toast'
import {
  bulkUpsertBoqMaterialItems,
  deleteBoqMaterialItem,
  getBoqMaterialsForHouseModel,
  getMaterialTypes,
} from '@/actions/material-actions'
import type { BoqMaterialsForHouseModelJob, MaterialType } from '@/lib/types/materials'

type NewRowDraft = { materialTypeId: string; quantity: string; wastePercent: string }

const emptyDraft: NewRowDraft = { materialTypeId: '', quantity: '1', wastePercent: '0' }

/** "วัสดุทั้งแบบบ้าน" - every BOQ job of one house model, each with its own
 * editable material list, on a single page instead of the 11-separate-
 * modals workflow BoqMaterialItemsModal requires per job. See
 * BOQ_CONTROL_PLAN.md 7.2. Writes go through bulkUpsertBoqMaterialItems
 * (one row at a time from here) so the waste % column is available, which
 * the older per-job modal doesn't set. */
export default function BoqHouseModelMaterialsGrid({ houseModelId }: { houseModelId: string }) {
  const toast = useToast()
  const [jobs, setJobs] = useState<BoqMaterialsForHouseModelJob[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({})
  const [wasteDrafts, setWasteDrafts] = useState<Record<string, string>>({})
  const [newRowDrafts, setNewRowDrafts] = useState<Record<string, NewRowDraft>>({})

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseModelId])

  async function loadData() {
    setIsLoading(true)
    try {
      const [jobRows, types] = await Promise.all([getBoqMaterialsForHouseModel(houseModelId), getMaterialTypes()])
      setJobs(jobRows)
      setMaterialTypes(types)
      const qDrafts: Record<string, string> = {}
      const wDrafts: Record<string, string> = {}
      for (const job of jobRows) {
        for (const item of job.items) {
          qDrafts[item.id] = String(item.planned_quantity)
          wDrafts[item.id] = String(item.waste_percent || 0)
        }
      }
      setQuantityDrafts(qDrafts)
      setWasteDrafts(wDrafts)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลวัสดุทั้งแบบบ้านไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  function toggleCollapsed(boqId: string) {
    setCollapsed((prev) => ({ ...prev, [boqId]: !prev[boqId] }))
  }

  async function handleSaveExisting(boqId: string, itemId: string) {
    const quantity = parseFloat(quantityDrafts[itemId] ?? '')
    const waste = parseFloat(wasteDrafts[itemId] ?? '0')
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error('กรุณาใส่ปริมาณที่ถูกต้อง')
      return
    }
    const job = jobs.find((j) => j.boqId === boqId)
    const item = job?.items.find((i) => i.id === itemId)
    if (!item) return

    setSavingKey(itemId)
    try {
      await bulkUpsertBoqMaterialItems([
        { boqId, materialTypeId: item.material_type_id, plannedQuantity: quantity, wastePercent: Math.max(0, waste || 0) },
      ])
      setJobs((prev) =>
        prev.map((j) =>
          j.boqId !== boqId
            ? j
            : {
                ...j,
                items: j.items.map((i) =>
                  i.id === itemId ? { ...i, planned_quantity: quantity, waste_percent: Math.max(0, waste || 0) } : i
                ),
              }
        )
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSavingKey(null)
    }
  }

  async function handleDelete(boqId: string, itemId: string) {
    if (!confirm('ยืนยันลบรายการวัสดุนี้?')) return
    setSavingKey(itemId)
    try {
      await deleteBoqMaterialItem(itemId, boqId)
      setJobs((prev) => prev.map((j) => (j.boqId !== boqId ? j : { ...j, items: j.items.filter((i) => i.id !== itemId) })))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ลบรายการไม่สำเร็จ')
    } finally {
      setSavingKey(null)
    }
  }

  async function handleAddRow(boqId: string) {
    const draft = newRowDrafts[boqId] || emptyDraft
    const materialTypeId = Number(draft.materialTypeId)
    const quantity = parseFloat(draft.quantity)
    const waste = parseFloat(draft.wastePercent || '0')
    if (!materialTypeId) {
      toast.error('กรุณาเลือกวัสดุ')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error('กรุณาใส่ปริมาณที่ถูกต้อง')
      return
    }
    setSavingKey(`new:${boqId}`)
    try {
      await bulkUpsertBoqMaterialItems([{ boqId, materialTypeId, plannedQuantity: quantity, wastePercent: Math.max(0, waste || 0) }])
      setNewRowDrafts((prev) => ({ ...prev, [boqId]: emptyDraft }))
      await loadData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'เพิ่มรายการไม่สำเร็จ')
    } finally {
      setSavingKey(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-10 text-center text-sm text-slate-400">
        แบบบ้านนี้ยังไม่มีรายการงาน BOQ - เพิ่มรายการงานก่อนจึงจะกำหนดวัสดุได้
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => {
        const isCollapsed = collapsed[job.boqId]
        const availableMaterials = materialTypes.filter((mt) => !job.items.some((i) => i.material_type_id === mt.id))
        const draft = newRowDrafts[job.boqId] || emptyDraft
        const jobTotal = job.items.reduce((sum, i) => sum + (i.material_types?.current_price || 0) * i.planned_quantity, 0)

        return (
          <div key={job.boqId} className="overflow-hidden rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => toggleCollapsed(job.boqId)}
              className="flex w-full items-center justify-between gap-2 bg-slate-50 px-3 py-2.5 text-left"
            >
              <span className="flex items-center gap-1.5 font-medium text-slate-800">
                {isCollapsed ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                {job.boqItemName}
                <span className="ml-1 text-xs font-normal text-slate-400">({job.items.length} วัสดุ)</span>
              </span>
              {jobTotal > 0 && <span className="text-xs text-slate-500">฿{jobTotal.toLocaleString('th-TH')}</span>}
            </button>

            {!isCollapsed && (
              <div className="border-t border-slate-200 p-3">
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">วัสดุ</th>
                        <th className="px-3 py-2 text-right font-semibold">ปริมาณ</th>
                        <th className="px-3 py-2 text-left font-semibold">หน่วย</th>
                        <th className="px-3 py-2 text-right font-semibold">เผื่อ %</th>
                        <th className="px-3 py-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {job.items.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                            ยังไม่มีวัสดุในงานนี้
                          </td>
                        </tr>
                      ) : (
                        job.items.map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-1.5 font-medium text-slate-800">{item.material_types?.name || '-'}</td>
                            <td className="px-3 py-1.5 text-right">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={quantityDrafts[item.id] ?? ''}
                                onChange={(e) => setQuantityDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                onBlur={() => handleSaveExisting(job.boqId, item.id)}
                                disabled={savingKey === item.id}
                                className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-slate-500">{item.material_types?.unit || '-'}</td>
                            <td className="px-3 py-1.5 text-right">
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={wasteDrafts[item.id] ?? ''}
                                onChange={(e) => setWasteDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                onBlur={() => handleSaveExisting(job.boqId, item.id)}
                                disabled={savingKey === item.id}
                                className="w-16 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                                title="ถ้าเว้นว่าง/เป็น 0 จะใช้ค่าเผื่อเริ่มต้นขององค์กรแทน"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => handleDelete(job.boqId, item.id)}
                                disabled={savingKey === item.id}
                                className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600"
                              >
                                {savingKey === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
                  <div className="min-w-[160px] flex-1">
                    <SearchableSelect
                      value={draft.materialTypeId}
                      onChange={(v) => setNewRowDrafts((prev) => ({ ...prev, [job.boqId]: { ...draft, materialTypeId: v } }))}
                      placeholder="-- เพิ่มวัสดุ --"
                      options={availableMaterials.map((mt) => ({ value: String(mt.id), label: `${mt.name} (${mt.unit})` }))}
                    />
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={draft.quantity}
                    onChange={(e) => setNewRowDrafts((prev) => ({ ...prev, [job.boqId]: { ...draft, quantity: e.target.value } }))}
                    placeholder="ปริมาณ"
                    className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={draft.wastePercent}
                    onChange={(e) => setNewRowDrafts((prev) => ({ ...prev, [job.boqId]: { ...draft, wastePercent: e.target.value } }))}
                    placeholder="เผื่อ %"
                    className="w-20 rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddRow(job.boqId)}
                    disabled={savingKey === `new:${job.boqId}`}
                    className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {savingKey === `new:${job.boqId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    เพิ่ม
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
