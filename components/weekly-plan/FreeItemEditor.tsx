'use client'

import { useState, useTransition } from 'react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { updateWeeklyPlanItem, type WeeklyPlanData, type WeeklyPlanItem } from '@/actions/weekly-plan-actions'
import type { WeeklyPlanKind } from '@/lib/weekly-plan'

const KINDS: { value: WeeklyPlanKind; label: string }[] = [
  { value: 'repair', label: 'ซ่อม' },
  { value: 'dc', label: 'DC' },
  { value: 'inspect', label: 'ตรวจบ้าน' },
  { value: 'other', label: 'อื่นๆ' },
]

/** Editing work outside the BOQ: name, type and plot only. Progress, crew and note are edited on the row. */
export default function FreeItemEditor({
  data,
  item,
  onClose,
  onSaved,
}: {
  data: WeeklyPlanData
  item: WeeklyPlanItem
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(item.title)
  const [kind, setKind] = useState<WeeklyPlanKind>(item.kind === 'main' ? 'other' : item.kind)
  const [plotId, setPlotId] = useState(item.plotId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const plots = data.plots.filter((p) => p.projectId === item.projectId)

  const save = () => {
    if (!title.trim()) return setError('กรุณากรอกชื่องาน')
    setError(null)
    startTransition(async () => {
      const res = await updateWeeklyPlanItem(item.id, {
        projectId: item.projectId,
        plotId: plotId || null,
        weekStart: item.weekStart,
        kind,
        title,
        jobAssignmentId: null,
        ownerId: item.ownerId,
        contractorId: item.contractorId,
        carryPct: item.carryPct,
        planPct: item.planPct,
        actualPct: item.actualPct,
        note: item.note,
      })
      if ('error' in res) setError(res.error)
      else onSaved()
    })
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="แก้ไขงาน"
      panelClassName="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            ยกเลิก
          </Button>
          <Button onClick={save} disabled={pending}>
            บันทึก
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="mb-1 block font-medium text-slate-700">ชื่องาน</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" autoFocus />
        </label>
        <div>
          <span className="mb-1 block font-medium text-slate-700">ประเภท</span>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                aria-pressed={kind === k.value}
                onClick={() => setKind(k.value)}
                className={`rounded-full border px-3 py-1 text-xs ${kind === k.value ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block font-medium text-slate-700">แปลง</span>
          <select value={plotId} onChange={(e) => setPlotId(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="">ไม่ระบุแปลง</option>
            {plots.map((p) => (
              <option key={p.id} value={p.id}>
                แปลง {p.name}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}
