'use client'

import { useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { createPlotGroup, deletePlotGroup, getPlotGroups, updatePlotGroup } from '@/actions/material-actions'
import type { PlotGroup } from '@/lib/types/materials'

type PlotOption = { id: string; name: string }

type Props = {
  isOpen: boolean
  onClose: () => void
  projectId: string
  plots: PlotOption[]
  /** Called after any create/update/delete so the parent can refresh badges. */
  onChanged?: () => void
}

/** Manage plot groups for a project - named batches of plots built/supplied
 * together (e.g. "98-102"). Material purchases can be logged against a whole
 * group; a plot belongs to at most one group. */
export default function PlotGroupManager({ isOpen, onClose, projectId, plots, onChanged }: Props) {
  const [groups, setGroups] = useState<PlotGroup[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // null = list view; 'new' = creating; otherwise the group id being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [selectedPlotIds, setSelectedPlotIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!isOpen) return
    void loadGroups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, projectId])

  async function loadGroups() {
    setIsLoading(true)
    setError(null)
    try {
      setGroups(await getPlotGroups(projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดกลุ่มแปลงไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  const groupedPlotIds = new Set(groups.flatMap((g) => g.member_plot_ids))

  function startCreate() {
    setEditing('new')
    setNameDraft('')
    setSelectedPlotIds(new Set())
    setError(null)
  }

  function startEdit(group: PlotGroup) {
    setEditing(group.id)
    setNameDraft(group.name)
    setSelectedPlotIds(new Set(group.member_plot_ids))
    setError(null)
  }

  function togglePlot(plotId: string) {
    setSelectedPlotIds((prev) => {
      const next = new Set(prev)
      if (next.has(plotId)) next.delete(plotId)
      else next.add(plotId)
      return next
    })
  }

  async function handleSave() {
    setError(null)
    setIsSaving(true)
    try {
      if (editing === 'new') {
        await createPlotGroup(projectId, nameDraft, [...selectedPlotIds])
      } else if (editing) {
        await updatePlotGroup(editing, projectId, nameDraft, [...selectedPlotIds])
      }
      setEditing(null)
      await loadGroups()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกกลุ่มไม่สำเร็จ')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(group: PlotGroup) {
    if (!confirm(`ยืนยันลบกลุ่ม "${group.name}"?`)) return
    setError(null)
    setIsSaving(true)
    try {
      await deletePlotGroup(group.id, projectId)
      await loadGroups()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ลบกลุ่มไม่สำเร็จ')
    } finally {
      setIsSaving(false)
    }
  }

  // Plots eligible for the group being edited: ungrouped ones, plus the
  // current group's own members (so editing doesn't lock out its own plots).
  const editingGroup = editing && editing !== 'new' ? groups.find((g) => g.id === editing) : null
  const eligiblePlots = plots.filter(
    (plot) => !groupedPlotIds.has(plot.id) || editingGroup?.member_plot_ids.includes(plot.id)
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="จัดกลุ่มแปลง (สำหรับบันทึกวัสดุแบบรวมกลุ่ม)" panelClassName="max-w-2xl">
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          {editing === null ? (
            <>
              <p className="text-xs text-slate-500">
                กลุ่มแปลงคือชุดแปลงที่สร้าง/เบิกวัสดุพร้อมกัน (เช่น 98-102) - เวลาบันทึกวัสดุจะเลือกบันทึกให้ทั้งกลุ่มได้
                และงบเทียบต่อแปลงจะเฉลี่ยให้อัตโนมัติ · หนึ่งแปลงอยู่ได้เพียงกลุ่มเดียว
              </p>

              {groups.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-8 text-center text-sm text-slate-400">
                  ยังไม่มีกลุ่มแปลงในโครงการนี้
                </div>
              ) : (
                <div className="space-y-2">
                  {groups.map((group) => (
                    <div
                      key={group.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-medium text-slate-800">
                          <Users className="h-4 w-4 shrink-0 text-indigo-500" />
                          {group.name}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-slate-500">
                          {group.member_plot_names.length} แปลง: {group.member_plot_names.join(', ')}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(group)}
                          disabled={isSaving}
                          className="rounded p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
                          title="แก้ไข"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(group)}
                          disabled={isSaving}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="ลบ"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={startCreate}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                <Plus className="h-4 w-4" /> สร้างกลุ่มใหม่
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อกลุ่ม</label>
                <input
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="w-full rounded-md border border-slate-300 p-2 text-sm"
                  placeholder="เช่น 98-102"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  เลือกแปลงในกลุ่ม ({selectedPlotIds.size} แปลง - อย่างน้อย 2)
                </label>
                {eligiblePlots.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-400">
                    ไม่มีแปลงว่าง - ทุกแปลงอยู่ในกลุ่มอื่นแล้ว
                  </p>
                ) : (
                  <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                    {eligiblePlots.map((plot) => (
                      <label
                        key={plot.id}
                        className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                          selectedPlotIds.has(plot.id)
                            ? 'border-indigo-400 bg-indigo-100 text-indigo-800'
                            : 'border-slate-300 bg-white text-slate-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={selectedPlotIds.has(plot.id)}
                          onChange={() => togglePlot(plot.id)}
                        />
                        แปลง {plot.name}
                      </label>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-[11px] text-slate-400">
                  แปลงที่อยู่ในกลุ่มอื่นแล้วจะไม่แสดงที่นี่
                </p>
              </div>

              <div className="flex justify-end gap-3 border-t pt-3">
                <button type="button" onClick={() => setEditing(null)} className="btn-secondary" disabled={isSaving}>
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || !nameDraft.trim() || selectedPlotIds.size < 2}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSaving ? 'กำลังบันทึก...' : editing === 'new' ? 'สร้างกลุ่ม' : 'บันทึกการแก้ไข'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
