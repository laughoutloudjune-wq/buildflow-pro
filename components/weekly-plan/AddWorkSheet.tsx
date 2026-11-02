'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { createWeeklyPlanItems, getPlotBoard, type PlotBoardData, type PlotBoardJob } from '@/actions/weekly-plan-actions'
import { compressPlotNames, plotIdsFromRangeText, type WeeklyPlanKind } from '@/lib/weekly-plan'

const FREE_KINDS: { value: WeeklyPlanKind; label: string }[] = [
  { value: 'repair', label: 'ซ่อม' },
  { value: 'dc', label: 'DC' },
  { value: 'inspect', label: 'ตรวจบ้าน' },
  { value: 'other', label: 'อื่นๆ' },
]

type Row = { title: string; order: number; jobs: PlotBoardJob[] }

/** Add BOQ work to the week: type the plots, tick the jobs. Same-named jobs on several plots are one row. */
export default function AddWorkSheet({
  projectId,
  weekStart,
  contractors,
  onClose,
  onAdded,
}: {
  projectId: string
  weekStart: string
  contractors: { id: string; name: string }[]
  onClose: () => void
  onAdded: (created: number) => void
}) {
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const [board, setBoard] = useState<PlotBoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [crew, setCrew] = useState<Record<string, string>>({})
  const [freeKind, setFreeKind] = useState<WeeklyPlanKind>('repair')
  const [freeTitle, setFreeTitle] = useState('')

  useEffect(() => {
    let alive = true
    getPlotBoard(projectId, weekStart).then((res) => {
      if (!alive) return
      if ('error' in res) setError(res.error)
      else setBoard(res)
    })
    return () => {
      alive = false
    }
  }, [projectId, weekStart])

  const plotIds = useMemo(() => (board ? plotIdsFromRangeText(text, board.plots) : []), [board, text])
  const plotName = (id: string) => board?.plots.find((p) => p.id === id)?.name ?? ''

  const { rows, hidden } = useMemo(() => {
    const byTitle = new Map<string, Row>()
    let skipped = 0
    for (const j of board?.jobs ?? []) {
      if (!plotIds.includes(j.plotId)) continue
      if (j.plannedThisWeek || j.percent >= 100) {
        skipped++
        continue
      }
      const row = byTitle.get(j.title) ?? { title: j.title, order: j.order, jobs: [] }
      row.order = Math.min(row.order, j.order)
      row.jobs.push(j)
      byTitle.set(j.title, row)
    }
    return { rows: [...byTitle.values()].sort((a, b) => a.order - b.order), hidden: skipped }
  }, [board, plotIds])

  const chosen = rows.filter((r) => ticked[r.title])
  const jobsChosen = chosen.flatMap((r) => r.jobs)

  const freeReady = freeTitle.trim() !== ''

  const submit = () => {
    if (jobsChosen.length === 0 && !freeReady) return
    const jobPlans: Record<string, { carryPct: number | null; planPct: (number | null)[] }> = {}
    const jobContractors: Record<string, string> = {}
    for (const r of chosen) {
      for (const j of r.jobs) {
        jobPlans[j.id] = { carryPct: j.percent, planPct: Array(7).fill(null) }
        if (!j.contractorId && crew[r.title]) jobContractors[j.id] = crew[r.title]
      }
    }
    startTransition(async () => {
      let created = 0
      if (jobsChosen.length > 0) {
        const res = await createWeeklyPlanItems({
          projectId,
          kind: 'main',
          title: '',
          ownerId: null,
          plotIds: [...new Set(jobsChosen.map((j) => j.plotId))],
          jobAssignmentIds: jobsChosen.map((j) => j.id),
          jobPlans,
          jobContractors,
          weekStarts: [weekStart],
        })
        if ('error' in res) {
          toast.error(res.error)
          return
        }
        created += res.created ?? jobsChosen.length
      }
      if (freeReady) {
        // The typed plots, or one project-level item when none are typed.
        const res = await createWeeklyPlanItems({
          projectId,
          kind: freeKind,
          title: freeTitle,
          ownerId: null,
          plotIds,
          weekStarts: [weekStart],
        })
        if ('error' in res) {
          toast.error(res.error)
          return
        }
        created += res.created ?? 1
      }
      onAdded(created)
    })
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="เพิ่มงาน"
      panelClassName="max-w-lg"
      footer={
        <div className="flex items-center justify-between gap-3 px-1">
          <span className="text-sm text-slate-600">{jobsChosen.length > 0 ? `เลือก ${chosen.length} งาน · ${jobsChosen.length} แปลง` : freeReady ? 'เพิ่มงานนอก BOQ' : 'ยังไม่ได้เลือกงาน'}</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button onClick={submit} disabled={pending || (jobsChosen.length === 0 && !freeReady)}>
              เพิ่มเข้าแผน
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">แปลงไหน</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="เช่น 120-122 หรือ 103, 105"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            autoFocus
          />
          {board && text.trim() !== '' && (
            <span className="mt-1 block text-xs text-slate-500">
              {plotIds.length > 0 ? `แปลง ${compressPlotNames(plotIds.map(plotName))} (${plotIds.length} แปลง)` : 'ไม่พบแปลงที่พิมพ์'}
            </span>
          )}
        </label>

        {error && <p className="text-sm text-red-700">{error}</p>}
        {!board && !error && <p className="text-sm text-slate-500">กำลังโหลดงาน...</p>}

        {board && plotIds.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">ติ๊กงานที่จะทำ</p>
            {rows.length === 0 && <p className="text-sm text-slate-500">ไม่มีงานให้เพิ่มในแปลงเหล่านี้</p>}
            {rows.map((r) => {
              const needCrew = r.jobs.some((j) => !j.contractorId)
              const names = [...new Set(r.jobs.map((j) => j.contractorName).filter(Boolean))]
              const lo = Math.min(...r.jobs.map((j) => j.percent))
              const hi = Math.max(...r.jobs.map((j) => j.percent))
              return (
                <div key={r.title} className={`rounded-lg border p-2.5 ${ticked[r.title] ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200'}`}>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={!!ticked[r.title]}
                      onChange={(e) => setTicked((t) => ({ ...t, [r.title]: e.target.checked }))}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-slate-800">{r.title}</span>
                      <span className="block text-xs text-slate-500">
                        แปลง {compressPlotNames(r.jobs.map((j) => plotName(j.plotId)))}
                        {hi > 0 ? ` · ทำแล้ว ${lo === hi ? lo : `${lo}-${hi}`}%` : ''}
                        {names.length > 0 ? ` · ช่าง ${names.join(', ')}` : ''}
                      </span>
                    </span>
                  </label>
                  {ticked[r.title] && needCrew && (
                    <select
                      value={crew[r.title] ?? ''}
                      onChange={(e) => setCrew((c) => ({ ...c, [r.title]: e.target.value }))}
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                      aria-label="ช่าง"
                    >
                      <option value="">ยังไม่เลือกช่าง</option>
                      {contractors.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )
            })}
            {hidden > 0 && <p className="text-xs text-slate-500">ซ่อนงานที่เสร็จแล้วหรืออยู่ในแผนสัปดาห์นี้แล้ว {hidden} รายการ</p>}
          </div>
        )}

        <div className="space-y-2 border-t border-slate-200 pt-4">
          <p className="text-sm font-medium text-slate-700">งานอื่นที่ไม่อยู่ใน BOQ</p>
          <div className="flex flex-wrap gap-1.5">
            {FREE_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                aria-pressed={freeKind === k.value}
                onClick={() => setFreeKind(k.value)}
                className={`rounded-full border px-3 py-1 text-xs ${freeKind === k.value ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <input
            value={freeTitle}
            onChange={(e) => setFreeTitle(e.target.value)}
            placeholder="ชื่องาน เช่น ซ่อมรอยร้าวผนังห้องนอน"
            aria-label="ชื่องานนอก BOQ"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <p className="text-xs text-slate-500">สร้างให้ทุกแปลงที่พิมพ์ด้านบน ถ้าไม่พิมพ์แปลงจะเป็นงานไม่ระบุแปลง</p>
        </div>
      </div>
    </Modal>
  )
}
