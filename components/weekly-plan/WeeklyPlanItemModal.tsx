'use client'

import { useState, useTransition } from 'react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import {
  createWeeklyPlanItem,
  updateWeeklyPlanItem,
  type WeeklyPlanData,
  type WeeklyPlanItem,
} from '@/actions/weekly-plan-actions'
import { WEEKLY_PLAN_KINDS, formatWeekRange, type WeeklyPlanKind } from '@/lib/weekly-plan'

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
  const [kind, setKind] = useState<WeeklyPlanKind>(item?.kind ?? 'main')
  const [title, setTitle] = useState(item?.title ?? '')
  const [plotId, setPlotId] = useState(item?.plotId ?? '')
  const [ownerId, setOwnerId] = useState(item?.ownerId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const plots = data.plots.filter((p) => p.projectId === projectId)
  const targetWeek = item?.weekStart ?? weekStart

  const save = () => {
    setError(null)
    startTransition(async () => {
      const input = { projectId: item?.projectId ?? projectId, plotId: plotId || null, weekStart: targetWeek, kind, title, ownerId: ownerId || null }
      const res = item ? await updateWeeklyPlanItem(item.id, input) : await createWeeklyPlanItem(input)
      if ('error' in res) setError(res.error)
      else onSaved()
    })
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={item ? 'แก้ไขรายการ' : 'เพิ่มรายการ'}
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
      <div className="space-y-3 text-sm">
        <p className="text-slate-500">สัปดาห์ {formatWeekRange(targetWeek)}</p>
        <label className="block">
          <span className="mb-1 block font-medium text-slate-700">ประเภท</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as WeeklyPlanKind)} className="w-full rounded-lg border border-slate-200 px-3 py-2">
            {WEEKLY_PLAN_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-slate-700">ชื่องาน</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-slate-700">แปลง (ไม่บังคับ)</span>
          <select value={plotId} onChange={(e) => setPlotId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2">
            <option value="">ไม่ระบุแปลง</option>
            {plots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-slate-700">ผู้รับผิดชอบ</span>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2">
            <option value="">ยังไม่มีผู้รับผิดชอบ</option>
            {data.owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}
