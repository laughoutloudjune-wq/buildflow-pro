'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarCheck, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import {
  agreeWeeklyPlan,
  deleteWeeklyPlanItem,
  recordWeeklyPlanActual,
  rollOverWeeklyPlan,
  setWeeklyPlanItemNote,
  setWeeklyPlanItemStatus,
  unagreeWeeklyPlan,
  type WeeklyPlanData,
  type WeeklyPlanItem,
} from '@/actions/weekly-plan-actions'
import {
  addDaysStr,
  currentProgress,
  dayIndexInWeek,
  formatThaiDay,
  formatWeekRange,
  groupPlanItems,
  mondayOf,
  WEEKLY_PLAN_KINDS,
} from '@/lib/weekly-plan'
import { todayInBangkok } from '@/lib/utils'
import WeeklyPlanItemModal from './WeeklyPlanItemModal'
import JobMaterialDetailModal from './JobMaterialDetailModal'
import PlotBoard from './PlotBoard'

const REQUEST_STATUS_LABEL: Record<string, string> = { new: 'ใหม่', accepted: 'รับเรื่องแล้ว', in_progress: 'กำลังทำ' }
const WHY = ['ของไม่มา', 'คนไม่พอ', 'งานก่อนหน้าไม่เสร็จ', 'ฝนตก', 'แบบ/ข้อมูลไม่ชัด', 'อื่นๆ']
const MISS_PCT = [0, 25, 50, 75]

/** Type any 0-100 % and save it on Enter or when leaving the box. */
function PctInput({ value, disabled, onCommit }: { value: number; disabled?: boolean; onCommit: (v: number) => void }) {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const commit = () => {
    setEditing(false)
    if (text.trim() === '') return
    const n = Math.round(Number(text))
    if (!Number.isFinite(n)) return
    const v = Math.min(100, Math.max(0, n))
    if (v !== value) onCommit(v)
  }
  return (
    <label className="inline-flex items-center gap-1 text-slate-600">
      พิมพ์เอง
      <input
        type="number"
        min={0}
        max={100}
        inputMode="numeric"
        disabled={disabled}
        value={editing ? text : value}
        onFocus={() => {
          setText(String(value))
          setEditing(true)
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        aria-label="ความคืบหน้า (%)"
        className="w-16 rounded-lg border border-amber-300 bg-white px-2 py-0.5 text-xs tabular-nums"
      />
      %
    </label>
  )
}
const MISS = '✗'

type Mark = '' | 'y' | 'n'

/** ✓ = ticked done; ✗ = the note starts with "✗" (the reason follows it); otherwise not checked yet. */
function markOf(item: WeeklyPlanItem): Mark {
  if (item.status === 'done') return 'y'
  if (item.note?.startsWith(MISS)) return 'n'
  return ''
}

/** What the crew promised: the last PLAN value of the week, else the whole job. */
function targetOf(item: WeeklyPlanItem): number {
  for (let d = 6; d >= 0; d--) if (item.planPct[d] != null) return Math.round(item.planPct[d] as number)
  return 100
}

const plotSort = (a: WeeklyPlanItem, b: WeeklyPlanItem) => (a.plotName ?? '').localeCompare(b.plotName ?? '', 'th', { numeric: true })

export default function WeeklyPlanClient({ data, projectId }: { data: WeeklyPlanData; projectId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const { weekStart, canManage, userId } = data
  const weekItems = useMemo(
    () => data.items.filter((i) => i.projectId === projectId && i.weekStart === weekStart),
    [data.items, projectId, weekStart]
  )
  const [view, setView] = useState<'board' | 'week'>(weekItems.length > 0 ? 'week' : 'board')
  const [boardKey, setBoardKey] = useState(0)
  const [modal, setModal] = useState<{ open: boolean; item: WeeklyPlanItem | null }>({ open: false, item: null })
  const [materialItem, setMaterialItem] = useState<WeeklyPlanItem | null>(null)
  const [deleting, setDeleting] = useState<WeeklyPlanItem[] | null>(null)

  const today = todayInBangkok()
  const currentWeek = mondayOf(today)
  const project = data.projects.find((p) => p.id === projectId)
  const canEdit = (item: WeeklyPlanItem) => canManage || item.createdBy === userId
  const isAgreed = (week: string) => data.meetings.some((m) => m.projectId === projectId && m.weekStart === week)
  const meeting = data.meetings.find((m) => m.projectId === projectId && m.weekStart === weekStart)

  // Progress is written on today's column in the current week, the last column of a past week.
  const dayFor = (week: string) => dayIndexInWeek(week, today) ?? (week < today ? 6 : 0)
  const canCheck = weekStart <= today

  const salesRequests = data.salesRequests.filter((r) => r.projectId === projectId)
  const salesPlots = data.salesPlots.filter((p) => p.projectId === projectId)
  const hints = data.targetHints.filter((h) => h.projectId === projectId)

  const go = (week: string, nextProject: string = projectId) => {
    router.push(`/dashboard/weekly-plan?week=${week}&project=${nextProject}`)
  }

  const run = (fn: () => Promise<{ ok: true } | { error: string }>, success?: string) => {
    startTransition(async () => {
      const res = await fn()
      if ('error' in res) toast.error(res.error)
      else {
        if (success) toast.success(success)
        setBoardKey((k) => k + 1)
        router.refresh()
      }
    })
  }

  /** Clears every recorded day so the next reading is the only one (the latest day wins). */
  const clearActuals = async (item: WeeklyPlanItem): Promise<{ ok: true } | { error: string }> => {
    for (let d = 0; d < 7; d++) {
      if (item.actualPct[d] == null) continue
      const res = await recordWeeklyPlanActual(item.id, d, null)
      if ('error' in res) return res
    }
    return { ok: true }
  }

  // ✓ ← not checked ← ✗ ← ✓: one tap moves to the next state.
  const cycle = (item: WeeklyPlanItem) =>
    run(async () => {
      const mark = markOf(item)
      const day = dayFor(item.weekStart)
      const cleared = await clearActuals(item)
      if ('error' in cleared) return cleared
      if (mark === '') {
        const rec = await recordWeeklyPlanActual(item.id, day, targetOf(item))
        if ('error' in rec) return rec
        if (item.note?.startsWith(MISS)) {
          const n = await setWeeklyPlanItemNote(item.id, null)
          if ('error' in n) return n
        }
        return setWeeklyPlanItemStatus(item.id, 'done')
      }
      if (mark === 'y') {
        const st = await setWeeklyPlanItemStatus(item.id, 'planned')
        if ('error' in st) return st
        const rec = await recordWeeklyPlanActual(item.id, day, item.carryPct ?? 0)
        if ('error' in rec) return rec
        return setWeeklyPlanItemNote(item.id, MISS)
      }
      return setWeeklyPlanItemNote(item.id, null)
    })

  const setMissPct = (item: WeeklyPlanItem, value: number) =>
    run(async () => {
      const cleared = await clearActuals(item)
      if ('error' in cleared) return cleared
      return recordWeeklyPlanActual(item.id, dayFor(item.weekStart), value)
    })

  const setMissWhy = (item: WeeklyPlanItem, why: string) => run(() => setWeeklyPlanItemNote(item.id, `${MISS} ${why}`))

  // Groups by crew, then by job (one row per job, one chip per plot).
  const crews = useMemo(() => {
    const byCrew = new Map<string, WeeklyPlanItem[]>()
    for (const item of weekItems) {
      const key = !item.jobAssignmentId ? '~free' : item.contractorName || '~none'
      byCrew.set(key, [...(byCrew.get(key) || []), item])
    }
    const rank = (k: string) => (k === '~free' ? 2 : k === '~none' ? 1 : 0)
    return [...byCrew.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'th'))
      .map(([key, items]) => ({ key, groups: groupPlanItems(items).map((g) => [...g].sort(plotSort)) }))
  }, [weekItems])

  const kept = weekItems.filter((i) => markOf(i) === 'y').length
  const missed = weekItems.filter((i) => markOf(i) === 'n').length
  const unchecked = weekItems.length - kept - missed
  const toCarry = weekItems.filter((i) => i.jobAssignmentId && i.status !== 'done' && currentProgress(i) < 100).length
  const nextWeek = addDaysStr(weekStart, 7)

  const closeWeek = () =>
    run(async () => {
      const res = await rollOverWeeklyPlan(projectId, nextWeek)
      if ('error' in res) return res
      toast.success(`ปิดสัปดาห์แล้ว ยก ${res.created} รายการไปสัปดาห์ ${formatWeekRange(nextWeek)}`)
      return { ok: true as const }
    })

  return (
    <div className="space-y-5">
      <PageHeader
        title="แผนงาน"
        subtitle={project ? project.name : 'เลือกโครงการ'}
        actions={
          <Button
            variant="secondary"
            onClick={() => setModal({ open: true, item: null })}
            disabled={!project || !!meeting}
            title={meeting ? 'แผนสัปดาห์นี้ตกลงแล้ว ต้องเปิดแก้ไขแผนก่อนจึงจะเพิ่มงานได้' : 'งานซ่อม · DC · ตรวจบ้าน ที่ไม่อยู่ใน BOQ'}
          >
            <Plus className="h-4 w-4" /> งานนอก BOQ
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <select value={projectId} onChange={(e) => go(weekStart, e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" aria-label="โครงการ">
          {data.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => go(addDaysStr(weekStart, -7))} aria-label="สัปดาห์ก่อน">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[10rem] text-center text-sm font-medium text-slate-700">
            {formatWeekRange(weekStart)}
            {weekStart === currentWeek && <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">สัปดาห์นี้</span>}
          </span>
          <Button variant="secondary" size="sm" onClick={() => go(nextWeek)} aria-label="สัปดาห์ถัดไป">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm" role="group" aria-label="มุมมอง">
          {(
            [
              ['board', 'บอร์ดแปลง'],
              ['week', `สัปดาห์นี้ (${weekItems.length})`],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`rounded-md px-3 py-1.5 font-medium ${view === v ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'board' ? (
        project ? (
          <PlotBoard
            projectId={projectId}
            weekStart={weekStart}
            agreed={!!meeting}
            refreshKey={boardKey}
            onChanged={() => {
              setBoardKey((k) => k + 1)
              router.refresh()
              setView('week')
            }}
          />
        ) : null
      ) : (
        <>
          {weekItems.length === 0 ? (
            <Card className="p-8 text-center text-sm text-slate-600">
              <p className="font-medium text-slate-800">ยังไม่มีงานที่รับปากในสัปดาห์นี้</p>
              <p className="mt-1">เลือกช่องที่หน้า &quot;บอร์ดแปลง&quot; แล้วกด &quot;ใส่แผนสัปดาห์นี้&quot;</p>
              <Button className="mt-3" variant="secondary" onClick={() => setView('board')}>
                ไปที่บอร์ดแปลง
              </Button>
            </Card>
          ) : (
            <Card className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <div className="text-2xl font-bold tabular-nums leading-none">
                    {kept}/{weekItems.length}
                  </div>
                  <div className="text-xs text-slate-500">ทำได้ตามที่รับปาก</div>
                </div>
                <div className="flex h-2.5 min-w-[10rem] flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  <span className="bg-emerald-500" style={{ width: `${(kept / weekItems.length) * 100}%` }} />
                  <span className="bg-amber-500" style={{ width: `${(missed / weekItems.length) * 100}%` }} />
                </div>
                <div className="text-sm">
                  <span className="text-emerald-700">✓ {kept}</span> · <span className="text-amber-700">✗ {missed}</span> · <span className="text-slate-500">ยังไม่เช็ค {unchecked}</span>
                </div>
              </div>

              {crews.map((c) => {
                const items = c.groups.flat()
                const head = c.key === '~free' ? 'งานนอก BOQ' : c.key === '~none' ? 'ยังไม่มีช่าง' : c.key
                return (
                  <section key={c.key}>
                    <div className="flex items-baseline gap-2 border-b border-slate-200 pb-1.5">
                      <h3 className="text-sm font-semibold text-slate-800">{head}</h3>
                      <span className="ml-auto text-xs text-slate-500">
                        ทำได้ {items.filter((i) => markOf(i) === 'y').length}/{items.length}
                      </span>
                    </div>
                    {c.groups.map((group) => {
                      const first = group[0]
                      const over = group.reduce((n, i) => n + i.materialOverCount, 0)
                      const misses = group.filter((i) => markOf(i) === 'n')
                      const kindLabel = !first.jobAssignmentId ? WEEKLY_PLAN_KINDS.find((k) => k.value === first.kind)?.label : null
                      const target = targetOf(first)
                      const canDeleteAll = group.every(canEdit) && !isAgreed(first.weekStart)
                      return (
                        <div key={group.map((g) => g.id).join('|')} className="space-y-2 border-b border-slate-100 py-3 last:border-0">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-sm font-medium text-slate-800">
                              {first.title}
                              {kindLabel && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-600">{kindLabel}</span>}
                              {over > 0 && (
                                <span className="ml-2 inline-flex items-center gap-0.5 text-xs font-normal text-red-700" title={`วัสดุเกิน BOQ ${over} รายการ`}>
                                  <AlertTriangle className="h-3 w-3" aria-hidden /> วัสดุเกิน BOQ
                                </span>
                              )}
                            </span>
                            <span className="text-xs text-slate-500">เป้า: {target >= 100 ? 'เสร็จ' : `ถึง ${target}%`}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {group.map((item) => {
                              const m = markOf(item)
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  disabled={pending || !canCheck}
                                  onClick={() => cycle(item)}
                                  aria-label={`แปลง ${item.plotName ?? ''} ${m === 'y' ? 'ทำได้' : m === 'n' ? 'ทำไม่ได้' : 'ยังไม่เช็ค'}`}
                                  className={`min-w-[4.25rem] rounded-lg border-[1.5px] px-2.5 py-1 text-sm tabular-nums disabled:opacity-60 ${
                                    m === 'y'
                                      ? 'border-emerald-500 bg-emerald-50 font-semibold text-emerald-700'
                                      : m === 'n'
                                        ? 'border-amber-500 bg-amber-50 font-semibold text-amber-800'
                                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  {item.plotName ?? 'โครงการ'}
                                  {m === 'y' ? ' ✓' : m === 'n' ? ` ${MISS}` : ''}
                                </button>
                              )
                            })}
                          </div>
                          {misses.map((item) => {
                            const pct = Math.round(currentProgress(item))
                            const why = item.note?.slice(1).trim() ?? ''
                            return (
                              <div key={item.id} className="space-y-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-slate-800">
                                <div className="font-medium">แปลง {item.plotName} ไม่ได้ตามที่รับปาก · ตอนนี้ทำได้กี่ %</div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {MISS_PCT.map((v) => (
                                    <button
                                      key={v}
                                      type="button"
                                      disabled={pending}
                                      aria-pressed={pct === v}
                                      onClick={() => setMissPct(item, v)}
                                      className={`rounded-full border px-2.5 py-0.5 tabular-nums ${pct === v ? 'border-amber-600 bg-white font-semibold text-amber-800' : 'border-amber-200 bg-white/60 text-slate-600'}`}
                                    >
                                      {v}%
                                    </button>
                                  ))}
                                  <PctInput value={pct} disabled={pending} onCommit={(v) => setMissPct(item, v)} />
                                </div>
                                <div className="font-medium">เพราะ</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {WHY.map((w) => (
                                    <button
                                      key={w}
                                      type="button"
                                      disabled={pending}
                                      aria-pressed={why === w}
                                      onClick={() => setMissWhy(item, w)}
                                      className={`rounded-full border px-2.5 py-0.5 ${why === w ? 'border-amber-600 bg-white font-semibold text-amber-800' : 'border-amber-200 bg-white/60 text-slate-600'}`}
                                    >
                                      {w}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )
                          })}
                          {group.some((i) => markOf(i) === 'y') && (
                            <details className="text-xs text-slate-500">
                              <summary className="cursor-pointer select-none">ใส่ % จริงของแปลงที่ ✓ ({group.filter((i) => markOf(i) === 'y').length})</summary>
                              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                                {group
                                  .filter((i) => markOf(i) === 'y')
                                  .map((item) => (
                                    <span key={item.id} className="inline-flex items-center gap-1.5">
                                      แปลง {item.plotName}
                                      <PctInput value={Math.round(currentProgress(item))} disabled={pending} onCommit={(v) => setMissPct(item, v)} />
                                    </span>
                                  ))}
                              </div>
                            </details>
                          )}
                          {group.some((i) => i.note && !i.note.startsWith(MISS)) && (
                            <p className="text-xs text-slate-500">{group.filter((i) => i.note && !i.note.startsWith(MISS)).map((i) => `แปลง ${i.plotName}: ${i.note}`).join(' · ')}</p>
                          )}
                          <details className="text-xs text-slate-500">
                            <summary className="cursor-pointer select-none">
                              จัดการ · {first.ownerName ? `ผู้คุมงาน ${first.ownerName}` : 'ยังไม่มีผู้คุมงาน'}
                            </summary>
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                              {group.map((item) => (
                                <span key={item.id} className="inline-flex items-center gap-1.5">
                                  แปลง {item.plotName ?? ''}
                                  {canEdit(item) && (
                                    <button type="button" className="text-indigo-600 hover:underline" onClick={() => setModal({ open: true, item })}>
                                      แก้ไข
                                    </button>
                                  )}
                                  {canEdit(item) && !isAgreed(item.weekStart) && (
                                    <button type="button" className="text-red-600 hover:underline" onClick={() => setDeleting([item])}>
                                      ลบ
                                    </button>
                                  )}
                                  {item.materialOverCount > 0 && item.jobBoqItemId && item.plotId && (
                                    <button type="button" className="text-red-700 hover:underline" onClick={() => setMaterialItem(item)}>
                                      วัสดุเกิน {item.materialOverCount}
                                    </button>
                                  )}
                                </span>
                              ))}
                              {c.key === '~none' && canEdit(first) && (
                                <button type="button" className="font-medium text-indigo-600 hover:underline" onClick={() => setModal({ open: true, item: first })}>
                                  เลือกช่าง
                                </button>
                              )}
                              {canDeleteAll && group.length > 1 && (
                                <button type="button" className="ml-auto text-red-600 hover:underline" onClick={() => setDeleting(group)}>
                                  ลบทั้งงาน ({group.length} แปลง)
                                </button>
                              )}
                            </div>
                          </details>
                        </div>
                      )
                    })}
                  </section>
                )
              })}

              <p className="text-xs text-slate-500">
                {canCheck ? 'แตะเลขแปลงเพื่อสลับ: ยังไม่เช็ค → ✓ ทำได้ → ✗ ไม่ได้ → ยังไม่เช็ค · ✗ จะถามว่าตอนนี้ได้กี่ % และเพราะอะไร (เป็นคำเตือน ไม่ได้ปิดกั้น)' : 'ยังไม่ถึงสัปดาห์นี้ เช็คงานไม่ได้'}
              </p>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm">
                <span className="text-slate-600">
                  ปิดสัปดาห์: งานที่ยังไม่ ✓ ({toCarry} รายการ BOQ) ยกไปสัปดาห์ {formatWeekRange(nextWeek)} พร้อมเหตุผล
                </span>
                <Button variant="secondary" size="sm" disabled={pending || toCarry === 0} onClick={closeWeek}>
                  ปิดสัปดาห์
                </Button>
              </div>
            </Card>
          )}

          <Card className={`p-4 ${meeting ? 'border-emerald-200' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <CalendarCheck className={`h-5 w-5 shrink-0 ${meeting ? 'text-emerald-700' : 'text-slate-400'}`} aria-hidden />
                {meeting ? (
                  <span className="text-slate-700">
                    <b className="text-emerald-800">ตกลงแผนในที่ประชุมแล้ว</b>
                    <span className="ml-2 text-slate-500">
                      {meeting.agreedByName ? `โดย ${meeting.agreedByName} · ` : ''}
                      {new Date(meeting.agreedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                    </span>
                    <span className="block text-xs text-slate-500">เพิ่ม ลบ หรือเปลี่ยนงานไม่ได้ เช็คงานและแก้หมายเหตุได้ตามปกติ</span>
                  </span>
                ) : (
                  <span className="text-slate-600">ยังไม่ได้ตกลงแผนสัปดาห์นี้</span>
                )}
              </div>
              {canManage && project && (
                <div className="flex shrink-0 gap-2">
                  {meeting ? (
                    <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => unagreeWeeklyPlan(projectId, weekStart), 'เปิดแก้ไขแผนแล้ว')}>
                      เปิดแก้ไขแผน
                    </Button>
                  ) : (
                    <Button size="sm" disabled={pending} onClick={() => run(() => agreeWeeklyPlan(projectId, weekStart), 'บันทึกการตกลงแผนแล้ว')}>
                      ตกลงแผนในที่ประชุมแล้ว
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>

          {(salesRequests.length > 0 || salesPlots.length > 0 || hints.length > 0) && (
            <Card className="p-4">
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-slate-800">
                  งานจากฝ่ายขายและเป้าหมายของแปลง (ดูอย่างเดียว) · {salesRequests.length + salesPlots.length + hints.length} รายการ
                </summary>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
                  {salesRequests.map((r) => (
                    <li key={r.id}>
                      <span className="font-medium">คำขอ {r.requestNo || ''}</span> แปลง {r.plotName}: {r.title}
                      <span className="ml-2 text-xs text-slate-500">
                        {REQUEST_STATUS_LABEL[r.status] || r.status}
                        {r.neededBy ? ` · ต้องการภายใน ${formatThaiDay(r.neededBy)}` : ''}
                      </span>
                    </li>
                  ))}
                  {salesPlots.map((p) => (
                    <li key={p.plotId}>
                      <span className="font-medium">{p.statusLabel}</span> แปลง {p.plotName}
                    </li>
                  ))}
                  {hints.map((h, i) => (
                    <li key={`${h.plotId}-${i}`} className="text-slate-600">
                      {formatThaiDay(h.date)} · แปลง {h.plotName}: {h.text}
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          )}
        </>
      )}

      {modal.open && project && (
        <WeeklyPlanItemModal
          key={modal.item?.id ?? 'new'}
          data={data}
          projectId={projectId}
          weekStart={weekStart}
          item={modal.item}
          freeOnly
          onClose={() => setModal({ open: false, item: null })}
          onSaved={() => {
            setModal({ open: false, item: null })
            router.refresh()
            setView('week')
          }}
        />
      )}

      {materialItem && <JobMaterialDetailModal item={materialItem} onClose={() => setMaterialItem(null)} />}

      <ConfirmDialog
        isOpen={!!deleting}
        title="ลบรายการ"
        message={
          deleting && deleting.length > 1
            ? `ต้องการลบ "${deleting[0].title}" ทั้ง ${deleting.length} รายการ (ทุกแปลงในกลุ่ม) ใช่หรือไม่`
            : `ต้องการลบ "${deleting?.[0]?.title ?? ''}" ${deleting?.[0]?.plotName ? `แปลง ${deleting[0].plotName} ` : ''}ใช่หรือไม่`
        }
        confirmLabel="ลบ"
        cancelLabel="ยกเลิก"
        busy={pending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting
          setDeleting(null)
          if (target)
            run(async () => {
              for (const i of target) {
                const res = await deleteWeeklyPlanItem(i.id)
                if ('error' in res) return res
              }
              return { ok: true as const }
            }, target.length > 1 ? `ลบ ${target.length} รายการแล้ว` : 'ลบรายการแล้ว')
        }}
      />
    </div>
  )
}
