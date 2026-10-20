'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Plus, RotateCw, Search } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import {
  recordWeeklyPlanActual,
  rollOverWeeklyPlan,
  setWeeklyPlanItemStatus,
  type WeeklyPlanData,
  type WeeklyPlanItem,
} from '@/actions/weekly-plan-actions'
import { checkInState, currentProgress, dayIndexInWeek, plannedProgressAt } from '@/lib/weekly-plan'
import { todayInBangkok } from '@/lib/utils'

const QUICK = [25, 50, 75, 100]

/** One job: how far along it is, where the plan says it should be, and one tap to update it. */
function JobRow({ item, dayIdx, busy, onSave }: { item: WeeklyPlanItem; dayIdx: number; busy: boolean; onSave: (item: WeeklyPlanItem, value: number) => void }) {
  const actual = currentProgress(item)
  const plan = plannedProgressAt(item, dayIdx)
  const state = checkInState(actual, plan)
  const [draft, setDraft] = useState('')

  const submitDraft = () => {
    const n = Number(draft)
    if (draft.trim() === '' || Number.isNaN(n) || n < 0 || n > 100) return
    onSave(item, n)
    setDraft('')
  }

  return (
    <li className="rounded-lg border border-slate-100 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-sm font-medium ${item.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{item.title}</p>
          <p className="text-xs text-slate-500">
            {item.jobQuantity != null ? `${item.jobQuantity.toLocaleString('th-TH', { maximumFractionDigits: 2 })}${item.jobUnit ? ` ${item.jobUnit}` : ''} · ` : ''}
            {item.contractorName || 'ยังไม่มีผู้รับเหมา'}
          </p>
        </div>
        <div className="text-right text-xs">
          <span className="text-base font-bold tabular-nums text-slate-800">{Math.round(actual)}%</span>
          {plan != null && <span className="ml-1 text-slate-500">แผน {Math.round(plan)}%</span>}
          {state === 'behind' && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
              <AlertTriangle className="h-3 w-3" aria-hidden /> ช้ากว่าแผน
            </span>
          )}
          {state === 'on_track' && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <CheckCircle2 className="h-3 w-3" aria-hidden /> ตามแผน
            </span>
          )}
        </div>
      </div>

      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, actual)}%` }} />
        {plan != null && <div className="absolute inset-y-0 w-0.5 bg-slate-500" style={{ left: `${Math.min(100, plan)}%` }} title="แผน" />}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-500">ตอนนี้ทำได้:</span>
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => onSave(item, q)}
            aria-pressed={Math.round(actual) === q}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-60 ${
              Math.round(actual) === q ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {q}%
          </button>
        ))}
        <input
          type="number"
          min={0}
          max={100}
          step="1"
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitDraft()}
          placeholder="อื่นๆ %"
          aria-label={`ความคืบหน้า ${item.title}`}
          className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs"
        />
        <Button size="sm" variant="secondary" disabled={busy || draft.trim() === ''} onClick={submitDraft}>
          บันทึก
        </Button>
      </div>
    </li>
  )
}

/**
 * The default plan view: this week's jobs by plot, each with one thing to do -
 * say how far along it is. Today's date and the daily PLAN/ACTUAL grid stay
 * out of sight: a tap writes today's ACTUAL, and 100% ticks the job done.
 * Anything else (adding, editing, the agreed-week lock) lives in the other
 * views, unchanged.
 */
export default function CheckInView({
  data,
  projectId,
  currentWeek,
  agreed,
  onAdd,
}: {
  data: WeeklyPlanData
  projectId: string
  currentWeek: string
  agreed: boolean
  onAdd: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [showDone, setShowDone] = useState(false)

  const today = todayInBangkok()
  const dayIdx = dayIndexInWeek(currentWeek, today) ?? 0
  const loaded = data.weeks.includes(currentWeek)
  const items = useMemo(() => data.items.filter((i) => i.projectId === projectId && i.weekStart === currentWeek), [data.items, projectId, currentWeek])

  const byPlot = useMemo(() => {
    const q = search.trim().toLowerCase()
    const map = new Map<string, WeeklyPlanItem[]>()
    for (const item of items) {
      if (!showDone && item.status === 'done') continue
      const plot = item.plotName || 'ไม่ระบุแปลง'
      if (q && !plot.toLowerCase().includes(q) && !item.title.toLowerCase().includes(q)) continue
      const list = map.get(plot) || []
      list.push(item)
      map.set(plot, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'th', { numeric: true }))
  }, [items, search, showDone])

  const boqItems = items.filter((i) => i.jobAssignmentId)
  const behind = boqItems.filter((i) => checkInState(currentProgress(i), plannedProgressAt(i, dayIdx)) === 'behind').length
  const doneCount = items.filter((i) => i.status === 'done').length

  const run = (fn: () => Promise<{ ok: true } | { error: string }>, success?: string) => {
    startTransition(async () => {
      const res = await fn()
      if ('error' in res) toast.error(res.error)
      else {
        if (success) toast.success(success)
        router.refresh()
      }
    })
  }

  const save = (item: WeeklyPlanItem, value: number) =>
    run(async () => {
      const res = await recordWeeklyPlanActual(item.id, dayIdx, value)
      if ('error' in res) return res
      // 100% means the job is done; coming back down reopens it. No other rule.
      if (value >= 100 && item.status !== 'done') return setWeeklyPlanItemStatus(item.id, 'done')
      if (value < 100 && item.status === 'done') return setWeeklyPlanItemStatus(item.id, 'planned')
      return { ok: true as const }
    }, 'บันทึกความคืบหน้าแล้ว')

  const rollOver = () =>
    run(async () => {
      const res = await rollOverWeeklyPlan(projectId, currentWeek)
      if ('error' in res) return res
      toast.success(`ต่องานค้างจากสัปดาห์ก่อน ${res.created} รายการ`)
      return { ok: true as const }
    })

  if (!loaded) {
    return (
      <Card className="p-6 text-center text-sm text-slate-600">
        <p>หน้านี้แสดงงานของสัปดาห์ปัจจุบัน</p>
        <Button className="mt-3" onClick={() => router.push(`/dashboard/weekly-plan?week=${currentWeek}&project=${projectId}`)}>
          ไปสัปดาห์นี้
        </Button>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-sm">
          <p className="font-semibold text-slate-800">งานสัปดาห์นี้ {items.length} รายการ</p>
          <p className="text-slate-600">
            เสร็จแล้ว {doneCount}
            {behind > 0 && <span className="ml-3 font-medium text-amber-700">ช้ากว่าแผน {behind} รายการ</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={pending || agreed} onClick={rollOver} title={agreed ? 'แผนสัปดาห์นี้ตกลงแล้ว — ยกเลิกการตกลงแผนก่อนจึงจะเพิ่มงานได้' : 'ดึงงาน BOQ ที่ยังไม่เสร็จจากสัปดาห์ก่อนมาต่อ พร้อมความคืบหน้าเดิม'}>
            <RotateCw className="h-4 w-4" /> ต่องานค้างจากสัปดาห์ก่อน
          </Button>
          <Button size="sm" disabled={agreed} onClick={onAdd}>
            <Plus className="h-4 w-4" /> เพิ่มงาน
          </Button>
        </div>
      </Card>

      {items.length === 0 ? (
        <Card className="p-6 text-center text-sm text-slate-600">
          <p className="font-medium text-slate-800">ยังไม่มีงานในสัปดาห์นี้</p>
          <p className="mt-1">กด &quot;ต่องานค้างจากสัปดาห์ก่อน&quot; เพื่อดึงงานที่ยังไม่เสร็จมาต่อ หรือกด &quot;เพิ่มงาน&quot;</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาแปลงหรืองาน"
                className="rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm"
                aria-label="ค้นหาแปลงหรืองาน"
              />
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              แสดงงานที่เสร็จแล้ว
            </label>
          </div>

          {byPlot.length === 0 ? (
            <Card className="p-6 text-center text-sm text-slate-500">ไม่พบงานตามที่ค้นหา หรืองานทั้งหมดเสร็จแล้ว</Card>
          ) : (
            byPlot.map(([plot, list]) => (
              <Card key={plot} className="p-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-800">แปลง {plot}</h3>
                <ul className="space-y-2">
                  {list.map((item) =>
                    item.jobAssignmentId ? (
                      <JobRow key={item.id} item={item} dayIdx={dayIdx} busy={pending} onSave={save} />
                    ) : (
                      <li key={item.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={item.status === 'done'}
                          disabled={pending}
                          onChange={() => run(() => setWeeklyPlanItemStatus(item.id, item.status === 'done' ? 'planned' : 'done'))}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                          aria-label="ทำเสร็จแล้ว"
                        />
                        <span className={`text-sm ${item.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{item.title}</span>
                      </li>
                    )
                  )}
                </ul>
              </Card>
            ))
          )}
        </>
      )}
    </div>
  )
}
