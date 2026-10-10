'use client'

import { useState, useTransition } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { saveHouseModelPhaseTemplate, type HouseModelPhaseTemplateRow } from '@/actions/house-model-phase-template'

type UsedType = { typeId: number; typeName: string }
type Step = { key: string; typeIds: number[] }

let stepKeySeq = 0
function newStepKey(): string {
  stepKeySeq += 1
  return `step-${stepKeySeq}`
}

/** One step per trade, in whatever order usedTypes arrives in, when there's
 * no saved template yet - a starting point the PM reorders with the arrow
 * buttons, not a claim about the "right" construction order (nothing in the
 * schema knows that). When a template exists, trades sharing a
 * sequence_order become one step (rendered as one card = "these run
 * together") instead of surfacing the raw numbers. */
function buildInitialSteps(usedTypes: UsedType[], template: HouseModelPhaseTemplateRow[]): Step[] {
  if (template.length === 0) {
    return usedTypes.map((u) => ({ key: newStepKey(), typeIds: [u.typeId] }))
  }
  const templateTypeIds = new Set(template.map((t) => t.contractorTypeId))
  const bySequence = new Map<number, number[]>()
  for (const t of [...template].sort((a, b) => a.contractorTypeId - b.contractorTypeId)) {
    if (!bySequence.has(t.sequenceOrder)) bySequence.set(t.sequenceOrder, [])
    bySequence.get(t.sequenceOrder)!.push(t.contractorTypeId)
  }
  const steps = [...bySequence.keys()]
    .sort((a, b) => a - b)
    .map((seq): Step => ({ key: newStepKey(), typeIds: bySequence.get(seq)! }))
  // Trades on this house model's BOQ that never made it into a saved
  // template yet (added after the template was last saved) - give each its
  // own trailing step so nothing used gets silently left out of the editor.
  for (const u of usedTypes) {
    if (!templateTypeIds.has(u.typeId)) steps.push({ key: newStepKey(), typeIds: [u.typeId] })
  }
  return steps
}

export default function HouseModelPhaseTemplateEditor({
  houseModelId,
  usedTypes,
  template,
  canEdit,
}: {
  houseModelId: string
  usedTypes: UsedType[]
  template: HouseModelPhaseTemplateRow[]
  canEdit: boolean
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [steps, setSteps] = useState<Step[]>(() => buildInitialSteps(usedTypes, template))
  const [durations, setDurations] = useState<Record<number, string>>(() => {
    const byType = new Map(template.map((t) => [t.contractorTypeId, t.durationDays]))
    return usedTypes.reduce((acc: Record<number, string>, u) => {
      acc[u.typeId] = byType.has(u.typeId) ? String(byType.get(u.typeId)) : ''
      return acc
    }, {})
  })

  if (usedTypes.length === 0) {
    return <p className="text-sm text-slate-500">ยังไม่มีรายการ BOQ จึงยังไม่มีเฟสให้กำหนดระยะเวลา</p>
  }

  const typeNameById = new Map(usedTypes.map((u) => [u.typeId, u.typeName]))

  const moveStep = (stepIndex: number, direction: -1 | 1) => {
    setSteps((prev) => {
      const next = [...prev]
      const target = stepIndex + direction
      if (target < 0 || target >= next.length) return prev
      ;[next[stepIndex], next[target]] = [next[target], next[stepIndex]]
      return next
    })
  }

  const moveTypeToStep = (typeId: number, targetStepIndex: number) => {
    setSteps((prev) => {
      const withoutType = prev
        .map((s) => ({ ...s, typeIds: s.typeIds.filter((id) => id !== typeId) }))
        .filter((s) => s.typeIds.length > 0)
      if (targetStepIndex >= prev.length) {
        // "+ ขั้นตอนใหม่" - always append at the very end, regardless of
        // which step the type used to be in.
        return [...withoutType, { key: newStepKey(), typeIds: [typeId] }]
      }
      // targetStepIndex was computed against `prev` (before removal); find
      // that same step by identity in `withoutType` so removing an emptied
      // step earlier in the list can't shift which step we land in.
      const targetStep = prev[targetStepIndex]
      const idx = withoutType.findIndex((s) => s.key === targetStep.key)
      if (idx === -1) return [...withoutType, { key: newStepKey(), typeIds: [typeId] }]
      const next = [...withoutType]
      next[idx] = { ...next[idx], typeIds: [...next[idx].typeIds, typeId] }
      return next
    })
  }

  const handleDurationChange = (typeId: number, value: string) => {
    setDurations((prev) => ({ ...prev, [typeId]: value }))
  }

  const handleSave = () => {
    const entries: HouseModelPhaseTemplateRow[] = []
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      for (const typeId of steps[stepIndex].typeIds) {
        const raw = (durations[typeId] ?? '').trim()
        if (raw === '') continue
        const durationDays = Number(raw)
        if (!Number.isFinite(durationDays) || durationDays <= 0) {
          toast.error(`ระยะเวลาของ "${typeNameById.get(typeId)}" ไม่ถูกต้อง`)
          return
        }
        entries.push({ contractorTypeId: typeId, sequenceOrder: stepIndex + 1, durationDays })
      }
    }

    startTransition(async () => {
      const res = await saveHouseModelPhaseTemplate(houseModelId, entries)
      if (!res.success) {
        toast.error(res.error || 'บันทึกเทมเพลตแผนงานไม่สำเร็จ')
        return
      }
      toast.success('บันทึกเทมเพลตแผนงานแล้ว')
    })
  }

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        แต่ละขั้นตอนคือช่วงงานที่ทำ - ใส่เฟสมากกว่า 1 อย่างในขั้นตอนเดียวกันหมายถึงทำพร้อมกัน ใช้ลูกศรจัดลำดับขั้นตอนก่อน-หลัง
      </p>
      <div className="space-y-2">
        {steps.map((step, stepIndex) => (
          <div key={step.key} className="rounded-lg border border-slate-200 p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">
                ขั้นตอนที่ {stepIndex + 1}
                {step.typeIds.length > 1 && <span className="ml-1 font-normal text-indigo-500">(ทำพร้อมกัน)</span>}
              </span>
              {canEdit && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => moveStep(stepIndex, -1)}
                    disabled={stepIndex === 0}
                    className="rounded-lg p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStep(stepIndex, 1)}
                    disabled={stepIndex === steps.length - 1}
                    className="rounded-lg p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              {step.typeIds.map((typeId) => (
                <div key={typeId} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 text-slate-700">{typeNameById.get(typeId)}</span>
                  {canEdit ? (
                    <>
                      <input
                        type="number"
                        min={1}
                        className="w-20 text-xs"
                        placeholder="จำนวนวัน"
                        value={durations[typeId] ?? ''}
                        onChange={(e) => handleDurationChange(typeId, e.target.value)}
                      />
                      <span className="text-xs text-slate-500">วัน</span>
                      <select
                        className="text-xs"
                        value={stepIndex}
                        onChange={(e) => moveTypeToStep(typeId, Number(e.target.value))}
                      >
                        {steps.map((_, i) => (
                          <option key={i} value={i}>
                            ขั้นตอนที่ {i + 1}
                          </option>
                        ))}
                        <option value={steps.length}>+ ขั้นตอนใหม่</option>
                      </select>
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">
                      {durations[typeId] ? `${durations[typeId]} วัน` : 'ยังไม่กำหนด'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            บันทึกเทมเพลตแผนงาน
          </Button>
        </div>
      )}
    </div>
  )
}
