'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { savePlotPhaseSchedule, type PlotPhaseScheduleRow } from '@/actions/plot-phase-schedule'

type Draft = { start: string; end: string }

function buildDrafts(phases: PlotPhaseScheduleRow[]): Record<number, Draft> {
  return phases.reduce((acc: Record<number, Draft>, p) => {
    acc[p.contractorTypeId] = { start: p.plannedStartDate ?? '', end: p.plannedEndDate ?? '' }
    return acc
  }, {})
}

/** Per-phase (contractor_type) planned start/end date entry - the real
 * baseline behind the progress curve's planned line and Gantt strip. Only
 * offers trades that actually have jobs on this plot (phases prop), from
 * getPlotPhaseSchedule. A phase with only one date filled in is left out of
 * the save (both-or-nothing), since plot_phase_schedule's columns are
 * not-null. */
export default function PlotPhaseScheduleEditor({
  plotId,
  projectId,
  phases,
  canEdit,
}: {
  plotId: string
  projectId: string
  phases: PlotPhaseScheduleRow[]
  canEdit: boolean
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() => buildDrafts(phases))

  if (phases.length === 0) {
    return <p className="text-sm text-slate-500">ยังไม่มีรายการงาน (กด &quot;ดึง BOQ&quot;) จึงยังไม่มีเฟสให้กำหนดแผนงาน</p>
  }

  const handleChange = (typeId: number, field: keyof Draft, value: string) => {
    setDrafts((prev) => ({ ...prev, [typeId]: { ...prev[typeId], [field]: value } }))
  }

  const handleSave = () => {
    const entries = phases
      .map((p) => ({ contractorTypeId: p.contractorTypeId, ...drafts[p.contractorTypeId] }))
      .filter((e) => e.start && e.end)
      .map((e) => ({ contractorTypeId: e.contractorTypeId, plannedStartDate: e.start, plannedEndDate: e.end }))

    startTransition(async () => {
      const res = await savePlotPhaseSchedule(plotId, projectId, entries)
      if (!res.success) {
        toast.error(res.error || 'บันทึกแผนงานไม่สำเร็จ')
        return
      }
      toast.success('บันทึกแผนงานแล้ว')
    })
  }

  return (
    <div>
      <div className="space-y-2">
        {phases.map((p) => {
          const draft = drafts[p.contractorTypeId] ?? { start: '', end: '' }
          return (
            <div key={p.contractorTypeId} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-sm">
              <span className="text-slate-600">{p.contractorTypeName}</span>
              {canEdit ? (
                <>
                  <input
                    type="date"
                    className="w-36 text-xs"
                    value={draft.start}
                    onChange={(e) => handleChange(p.contractorTypeId, 'start', e.target.value)}
                  />
                  <input
                    type="date"
                    className="w-36 text-xs"
                    value={draft.end}
                    onChange={(e) => handleChange(p.contractorTypeId, 'end', e.target.value)}
                  />
                </>
              ) : (
                <span className="col-span-2 text-right text-xs text-slate-500">
                  {p.plannedStartDate && p.plannedEndDate
                    ? `${p.plannedStartDate} – ${p.plannedEndDate}`
                    : 'ยังไม่กำหนด'}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {canEdit && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            บันทึกแผนงาน
          </Button>
        </div>
      )}
    </div>
  )
}
