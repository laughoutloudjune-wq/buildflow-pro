'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarCheck, ChevronLeft, ChevronRight, Pencil, Plus, RotateCw, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import ActionMenu from '@/components/ui/ActionMenu'
import {
  agreeWeeklyPlan,
  deleteWeeklyPlanItem,
  recordWeeklyPlanActual,
  rollOverWeeklyPlan,
  setWeeklyPlanItemStatus,
  unagreeWeeklyPlan,
  type WeeklyPlanData,
  type WeeklyPlanItem,
} from '@/actions/weekly-plan-actions'
import {
  addDaysStr,
  compressPlotNames,
  currentProgress,
  dayIndexInWeek,
  formatThaiDay,
  formatThaiMonth,
  formatWeekRange,
  groupPlanItems,
  mondayOf,
  plannedProgressAt,
  WEEKLY_PLAN_KINDS,
} from '@/lib/weekly-plan'
import { todayInBangkok } from '@/lib/utils'
import WeeklyPlanItemModal from './WeeklyPlanItemModal'
import JobMaterialDetailModal from './JobMaterialDetailModal'

const REQUEST_STATUS_LABEL: Record<string, string> = { new: 'ใหม่', accepted: 'รับเรื่องแล้ว', in_progress: 'กำลังทำ' }
const QUICK = [25, 50, 75, 100]
const BEHIND_MARGIN = 5

type LineState = 'done' | 'late' | 'idle' | 'ok'

/** How far a plan row is: BOQ and manual work alike, 100 when ticked done. */
function progressOf(item: WeeklyPlanItem): number {
  return item.status === 'done' ? 100 : Math.min(100, Math.round(currentProgress(item)))
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : Math.round(values.reduce((a, b) => a + b, 0) / values.length)
}

/** One bar: how far along, with a dark tick where the plan says it should be today. */
function Bar({ actual, plan, state }: { actual: number; plan: number | null; state: LineState }) {
  const color = state === 'done' ? 'bg-emerald-500' : state === 'late' ? 'bg-amber-500' : 'bg-indigo-500'
  return (
    <span className="relative block h-2 min-w-[60px] flex-1 rounded-full bg-slate-100" aria-hidden>
      <span className={`absolute inset-y-0 left-0 rounded-full ${color}`} style={{ width: `${Math.min(100, actual)}%` }} />
      {plan != null && <span className="absolute -inset-y-1 w-0.5 rounded bg-slate-600/60" style={{ left: `calc(${Math.min(100, plan)}% - 1px)` }} title={`ควรถึง ${Math.round(plan)}%`} />}
    </span>
  )
}

function Chip({ state, late }: { state: LineState; late?: number }) {
  if (state === 'done') return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">เสร็จ</span>
  if (state === 'late') return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">ช้ากว่าแผน{late && late > 1 ? ` ${late} แปลง` : ''}</span>
  if (state === 'idle') return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">ยังไม่เริ่ม</span>
  return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">ตามแผน</span>
}

export default function WeeklyPlanClient({ data, projectId }: { data: WeeklyPlanData; projectId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const [view, setView] = useState<'week' | 'month'>('week')
  const [filter, setFilter] = useState<'all' | 'late' | 'done' | 'nocrew'>('all')
  const [modal, setModal] = useState<{ open: boolean; item: WeeklyPlanItem | null }>({ open: false, item: null })
  const [materialItem, setMaterialItem] = useState<WeeklyPlanItem | null>(null)
  const [deleting, setDeleting] = useState<WeeklyPlanItem[] | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const today = todayInBangkok()
  // Monday of today's week in Bangkok time, to mark the current week.
  const currentWeek = mondayOf(today)

  const { weekStart, canManage, userId } = data
  const project = data.projects.find((p) => p.id === projectId)
  const canEdit = (item: WeeklyPlanItem) => canManage || item.createdBy === userId
  const isAgreed = (week: string) => data.meetings.some((m) => m.projectId === projectId && m.weekStart === week)
  const meeting = data.meetings.find((m) => m.projectId === projectId && m.weekStart === weekStart)

  // "Should be at" is read for today in the current week, the end of a past week, the start of a future one.
  const dayFor = (week: string) => dayIndexInWeek(week, today) ?? (week < today ? 6 : 0)
  const canRecord = weekStart <= today

  const go = (week: string, nextProject: string = projectId) => {
    router.push(`/dashboard/weekly-plan?week=${week}&project=${nextProject}`)
  }

  const weekItems = useMemo(
    () => data.items.filter((i) => i.projectId === projectId && i.weekStart === weekStart),
    [data.items, projectId, weekStart]
  )
  const salesRequests = data.salesRequests.filter((r) => r.projectId === projectId)
  const salesPlots = data.salesPlots.filter((p) => p.projectId === projectId)
  const hints = data.targetHints.filter((h) => h.projectId === projectId)

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

  // Progress is entered here and only here: a tap writes today's ACTUAL, 100 ticks the job done, lower reopens it.
  const record = (item: WeeklyPlanItem, value: number) =>
    run(async () => {
      const res = await recordWeeklyPlanActual(item.id, dayFor(item.weekStart), value)
      if ('error' in res) return res
      if (value >= 100 && item.status !== 'done') return setWeeklyPlanItemStatus(item.id, 'done')
      if (value < 100 && item.status === 'done') return setWeeklyPlanItemStatus(item.id, 'planned')
      return { ok: true as const }
    }, `บันทึกแปลง ${item.plotName ?? ''} ${value}%`)

  const submitDraft = (item: WeeklyPlanItem) => {
    const raw = drafts[item.id] ?? ''
    const n = Number(raw)
    if (raw.trim() === '' || Number.isNaN(n) || n < 0 || n > 100) return
    setDrafts((prev) => ({ ...prev, [item.id]: '' }))
    record(item, Math.round(n))
  }

  const itemState = (item: WeeklyPlanItem): LineState => {
    const actual = progressOf(item)
    if (actual >= 100) return 'done'
    const plan = plannedProgressAt(item, dayFor(item.weekStart))
    if (plan != null && actual + BEHIND_MARGIN < plan) return 'late'
    if (actual === 0 && (plan == null || plan === 0)) return 'idle'
    return 'ok'
  }

  const lineState = (group: WeeklyPlanItem[]): { state: LineState; late: number } => {
    const states = group.map(itemState)
    if (states.every((s) => s === 'done')) return { state: 'done', late: 0 }
    const late = states.filter((s) => s === 'late').length
    if (late > 0) return { state: 'late', late }
    if (states.every((s) => s === 'idle' || s === 'done')) return { state: 'idle', late: 0 }
    return { state: 'ok', late: 0 }
  }

  // Jobs by crew; unassigned BOQ jobs next, non-BOQ work last.
  const crews = useMemo(() => {
    const byCrew = new Map<string, WeeklyPlanItem[]>()
    for (const item of weekItems) {
      const key = !item.jobAssignmentId ? '~free' : item.contractorName || '~none'
      byCrew.set(key, [...(byCrew.get(key) || []), item])
    }
    const rank = (k: string) => (k === '~free' ? 2 : k === '~none' ? 1 : 0)
    return [...byCrew.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'th'))
      .map(([key, items]) => ({ key, groups: groupPlanItems(items) }))
  }, [weekItems])

  const allGroups = crews.flatMap((c) => c.groups.map((g) => ({ crew: c.key, group: g })))
  const counts = {
    all: allGroups.length,
    late: allGroups.filter((x) => lineState(x.group).state === 'late').length,
    done: allGroups.filter((x) => lineState(x.group).state === 'done').length,
    nocrew: allGroups.filter((x) => x.crew === '~none').length,
  }
  const matches = (crew: string, group: WeeklyPlanItem[]) => {
    if (filter === 'all') return true
    if (filter === 'late') return lineState(group).state === 'late'
    if (filter === 'done') return lineState(group).state === 'done'
    return crew === '~none'
  }

  // Last week's unfinished BOQ jobs that are not in this week yet.
  const prevWeek = addDaysStr(weekStart, -7)
  const prevKnown = data.weeks.includes(prevWeek)
  const carryCount = useMemo(() => {
    if (!prevKnown) return null
    const planned = new Set(weekItems.map((i) => i.jobAssignmentId).filter(Boolean))
    return data.items.filter(
      (i) => i.projectId === projectId && i.weekStart === prevWeek && i.jobAssignmentId && i.status !== 'done' && currentProgress(i) < 100 && !planned.has(i.jobAssignmentId)
    ).length
  }, [prevKnown, data.items, projectId, prevWeek, weekItems])
  const showCarry = !meeting && (carryCount == null ? weekItems.length === 0 : carryCount > 0)

  const rollOver = () =>
    run(async () => {
      const res = await rollOverWeeklyPlan(projectId, weekStart)
      if ('error' in res) return res
      toast.success(`ต่องานค้างจากสัปดาห์ก่อน ${res.created} รายการ`)
      return { ok: true as const }
    })

  const toggleOpen = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const renderLine = (crew: string, group: WeeklyPlanItem[]) => {
    const first = group[0]
    const key = group.map((g) => g.id).join('|')
    const isOpen = open.has(key)
    const { state, late } = lineState(group)
    const actual = avg(group.map(progressOf))
    const plans = group.map((i) => plannedProgressAt(i, dayFor(i.weekStart))).filter((v): v is number => v != null)
    const plan = plans.length > 0 ? avg(plans) : null
    const names = group.map((i) => i.plotName).filter((n): n is string => !!n)
    const over = group.reduce((n, i) => n + i.materialOverCount, 0)
    const canDeleteAll = group.every((i) => canEdit(i)) && !isAgreed(first.weekStart)
    const kindLabel = !first.jobAssignmentId ? WEEKLY_PLAN_KINDS.find((k) => k.value === first.kind)?.label : null

    return (
      <li key={key} className="border-b border-slate-100 last:border-0">
        <button type="button" onClick={() => toggleOpen(key)} aria-expanded={isOpen} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 text-left">
          <span className="min-w-0 text-sm font-medium text-slate-800">
            {first.title}
            <span className="ml-2 text-xs font-normal text-slate-500">{names.length > 0 ? `แปลง ${compressPlotNames(names)}` : 'โครงการ'}</span>
            {kindLabel && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-600">{kindLabel}</span>}
            {over > 0 && (
              <span className="ml-2 inline-flex items-center gap-0.5 text-xs font-normal text-red-700" title={`วัสดุเกิน BOQ ${over} รายการ`}>
                <AlertTriangle className="h-3 w-3" aria-hidden /> วัสดุเกิน BOQ
              </span>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <Chip state={state} late={late} />
            <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform duration-[150ms] ${isOpen ? 'rotate-90' : ''}`} aria-hidden />
          </span>
          <span className="col-span-2 flex items-center gap-3">
            <Bar actual={actual} plan={plan} state={state} />
            <span className="w-11 text-right text-sm font-semibold tabular-nums text-slate-800">{actual}%</span>
          </span>
        </button>

        {isOpen && (
          <div className="mb-3 ml-1 space-y-3 border-l-2 border-slate-100 pl-3">
            {group.map((item) => {
              const itemActual = progressOf(item)
              const itemPlan = plannedProgressAt(item, dayFor(item.weekStart))
              const st = itemState(item)
              return (
                <div key={item.id} className="space-y-1.5">
                  <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.75rem_auto] items-center gap-2">
                    <span className="truncate text-sm text-slate-600">{item.plotName ? `แปลง ${item.plotName}` : 'โครงการ'}</span>
                    <Bar actual={itemActual} plan={itemPlan} state={st} />
                    <span className="text-right text-sm font-semibold tabular-nums">{itemActual}%</span>
                    {canEdit(item) ? (
                      <ActionMenu
                        label={`ตัวเลือก: ${item.title}`}
                        items={[
                          { label: 'แก้ไขรายการ', icon: <Pencil />, onClick: () => setModal({ open: true, item }) },
                          ...(!isAgreed(item.weekStart) ? [{ label: 'ลบรายการ', icon: <Trash2 />, danger: true, onClick: () => setDeleting([item]) }] : []),
                        ]}
                      />
                    ) : (
                      <span className="w-8" />
                    )}
                  </div>
                  {canRecord ? (
                    <div className="flex flex-wrap items-center gap-1.5 pl-[4.75rem]">
                      {QUICK.map((q) => (
                        <button
                          key={q}
                          type="button"
                          disabled={pending}
                          aria-pressed={itemActual === q}
                          onClick={() => record(item, q)}
                          className={`rounded-md border px-2.5 py-0.5 text-xs tabular-nums disabled:opacity-60 ${
                            itemActual === q ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {q}
                        </button>
                      ))}
                      <input
                        type="number"
                        min={0}
                        max={100}
                        inputMode="numeric"
                        value={drafts[item.id] ?? ''}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && submitDraft(item)}
                        placeholder="อื่นๆ"
                        aria-label={`ความคืบหน้า แปลง ${item.plotName ?? ''}`}
                        className="w-16 rounded-md border border-slate-200 px-1.5 py-0.5 text-xs"
                      />
                    </div>
                  ) : (
                    <p className="pl-[4.75rem] text-xs text-slate-500">ยังไม่ถึงสัปดาห์นี้ กรอกความคืบหน้าไม่ได้</p>
                  )}
                  {item.materialOverCount > 0 && item.jobBoqItemId && item.plotId && (
                    <p className="pl-[4.75rem] text-xs text-red-700">
                      วัสดุเกิน BOQ {item.materialOverCount} รายการ
                      <button type="button" onClick={() => setMaterialItem(item)} className="ml-2 font-medium text-indigo-600 hover:underline">
                        ดู
                      </button>
                    </p>
                  )}
                  {item.note && <p className="pl-[4.75rem] text-xs text-slate-500">{item.note}</p>}
                </div>
              )
            })}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-[4.75rem] text-xs">
              {crew === '~none' && canEdit(first) && (
                <button type="button" className="font-medium text-indigo-600 hover:underline" onClick={() => setModal({ open: true, item: first })}>
                  เลือกช่าง
                </button>
              )}
              {first.ownerName ? <span className="text-slate-500">ผู้คุมงาน {first.ownerName}</span> : <span className="text-amber-700">ยังไม่มีผู้คุมงาน</span>}
              {canDeleteAll && group.length > 1 && (
                <button type="button" className="ml-auto text-red-600 hover:underline" onClick={() => setDeleting(group)}>
                  ลบทั้งงาน ({group.length} แปลง)
                </button>
              )}
            </div>
          </div>
        )}
      </li>
    )
  }

  const crewHeading = (key: string, groups: WeeklyPlanItem[][]) => {
    if (key === '~free') return { title: 'งานนอก BOQ', sub: 'ซ่อม · DC · ตรวจบ้าน · อื่นๆ' }
    if (key === '~none') return { title: 'ยังไม่มีช่าง', sub: 'แตะงานแล้วเลือกช่าง' }
    const trades = [...new Set(groups.map((g) => g[0].jobTrade).filter((t): t is string => !!t))]
    return { title: key, sub: trades.join(' · ') }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="แผนงาน"
        subtitle={project ? project.name : 'เลือกโครงการ'}
        actions={
          <Button
            onClick={() => setModal({ open: true, item: null })}
            disabled={!project || (view === 'week' && !!meeting)}
            title={view === 'week' && meeting ? 'แผนสัปดาห์นี้ตกลงแล้ว ต้องเปิดแก้ไขแผนก่อนจึงจะเพิ่มงานได้' : undefined}
          >
            <Plus className="h-4 w-4" /> เพิ่มงาน
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={projectId}
          onChange={(e) => go(weekStart, e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          aria-label="โครงการ"
        >
          {data.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => go(addDaysStr(weekStart, view === 'week' ? -7 : -28))} aria-label="ก่อนหน้า">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[10rem] text-center text-sm font-medium text-slate-700">
            {view === 'week' ? formatWeekRange(weekStart) : formatThaiMonth(weekStart)}
            {view === 'week' && weekStart === currentWeek && <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">สัปดาห์นี้</span>}
          </span>
          <Button variant="secondary" size="sm" onClick={() => go(addDaysStr(weekStart, view === 'week' ? 7 : 28))} aria-label="ถัดไป">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {(['week', 'month'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`rounded-md px-3 py-1.5 font-medium ${view === v ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'}`}
            >
              {v === 'week' ? 'สัปดาห์' : 'เดือน'}
            </button>
          ))}
        </div>
      </div>

      {view === 'week' ? (
        <>
          {showCarry && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm">
              <span className="text-slate-800">
                {carryCount != null ? (
                  <>
                    งานค้างจากสัปดาห์ก่อน <b>{carryCount} รายการ</b> ยังไม่อยู่ในสัปดาห์นี้
                  </>
                ) : (
                  'สัปดาห์นี้ยังไม่มีงาน ดึงงานที่ค้างจากสัปดาห์ก่อนมาต่อได้'
                )}
              </span>
              <Button size="sm" disabled={pending} onClick={rollOver}>
                <RotateCw className="h-4 w-4" /> ต่องานค้างจากสัปดาห์ก่อน
              </Button>
            </div>
          )}

          {weekItems.length === 0 ? (
            <Card className="p-8 text-center text-sm text-slate-600">
              <p className="font-medium text-slate-800">ยังไม่มีงานในสัปดาห์นี้</p>
              <p className="mt-1">กด &quot;เพิ่มงาน&quot; เพื่อเลือกแปลง งาน และสัปดาห์ในหน้าเดียว</p>
            </Card>
          ) : (
            <Card className="space-y-4 p-4">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['all', `ทั้งหมด ${counts.all} งาน`],
                    ['late', `ช้ากว่าแผน ${counts.late}`],
                    ['done', `เสร็จ ${counts.done}`],
                    ['nocrew', `ยังไม่มีช่าง ${counts.nocrew}`],
                  ] as const
                ).map(([f, label]) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                    className={`rounded-full border px-3 py-1 text-xs ${filter === f ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {crews.map((c) => {
                const visible = c.groups.filter((g) => matches(c.key, g))
                if (visible.length === 0) return null
                const head = crewHeading(c.key, visible)
                return (
                  <section key={c.key}>
                    <div className="flex flex-wrap items-baseline gap-2 border-b border-slate-200 pb-1.5">
                      <h3 className="text-sm font-semibold text-slate-800">{head.title}</h3>
                      <span className="text-xs text-slate-500">{head.sub}</span>
                      <span className="ml-auto text-xs text-slate-500">{visible.length} งาน</span>
                    </div>
                    <ul>{visible.map((g) => renderLine(c.key, g))}</ul>
                  </section>
                )
              })}
              <p className="text-xs text-slate-500">แถบ = ทำได้ · ขีดเข้ม = ควรถึงวันนี้ตามเป้าสิ้นสัปดาห์ · แตะงานเพื่อดูรายแปลงและกดความคืบหน้า</p>
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
                    <span className="block text-xs text-slate-500">เพิ่ม ลบ หรือเปลี่ยนงานไม่ได้ กดความคืบหน้าและแก้หมายเหตุได้ตามปกติ</span>
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
      ) : (
        <MonthTable
          data={data}
          projectId={projectId}
          currentWeek={currentWeek}
          itemState={itemState}
          onOpenWeek={(w) => {
            setView('week')
            go(w)
          }}
        />
      )}

      {modal.open && project && (
        <WeeklyPlanItemModal
          key={modal.item?.id ?? 'new'}
          data={data}
          projectId={projectId}
          weekStart={weekStart}
          item={modal.item}
          onClose={() => setModal({ open: false, item: null })}
          onSaved={() => {
            setModal({ open: false, item: null })
            router.refresh()
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
            : `ต้องการลบ "${deleting?.[0]?.title ?? ''}" ใช่หรือไม่`
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

/** Jobs down the side, weeks across: which jobs run long, and where each stands per week. */
function MonthTable({
  data,
  projectId,
  currentWeek,
  itemState,
  onOpenWeek,
}: {
  data: WeeklyPlanData
  projectId: string
  currentWeek: string
  itemState: (item: WeeklyPlanItem) => LineState
  onOpenWeek: (week: string) => void
}) {
  const items = data.items.filter((i) => i.projectId === projectId)
  const rows = useMemo(() => {
    const by = new Map<string, WeeklyPlanItem[]>()
    for (const i of items) {
      const key = `${i.jobAssignmentId ? 'b' : 'm'}|${i.title}`
      by.set(key, [...(by.get(key) || []), i])
    }
    return [...by.values()].sort((a, b) => a[0].title.localeCompare(b[0].title, 'th'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.items, projectId])

  const done = items.filter((i) => i.status === 'done').length
  const late = items.filter((i) => itemState(i) === 'late').length
  const noCrew = items.filter((i) => i.jobAssignmentId && !i.contractorId && i.status === 'planned').length

  const cell = (list: WeeklyPlanItem[]) => {
    if (list.length === 0) return null
    if (list.every((i) => i.status === 'done')) return { cls: 'bg-emerald-50 text-emerald-700', text: '100%' }
    const touched = list.some((i) => i.actualPct.some((v) => v != null) || i.status === 'done')
    if (!touched) return { cls: 'border border-dashed border-slate-300 text-slate-500', text: 'แผน' }
    const pct = avg(list.map(progressOf))
    return list.some((i) => itemState(i) === 'late') ? { cls: 'bg-amber-50 text-amber-800', text: `${pct}%` } : { cls: 'bg-slate-100 text-slate-800', text: `${pct}%` }
  }

  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm text-slate-600">
        <span className="font-semibold text-slate-800">{formatThaiMonth(data.weekStart)} · {items.length} รายการ</span> · เสร็จ {done}
        {late > 0 && <span className="ml-3 font-medium text-amber-700">ช้ากว่าแผน {late}</span>}
        {noCrew > 0 && <span className="ml-3 font-medium text-amber-700">ยังไม่มีช่าง {noCrew}</span>}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">ยังไม่มีรายการในเดือนนี้</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="w-[38%] border-b border-slate-100 py-2 text-left font-medium">งาน</th>
                {data.weeks.map((w) => (
                  <th key={w} className={`border-b border-slate-100 px-1 py-2 text-center font-medium ${w === currentWeek ? 'text-indigo-700' : ''}`}>
                    <button type="button" onClick={() => onOpenWeek(w)} className="hover:underline">
                      {formatThaiDay(w)}
                      {data.meetings.some((m) => m.projectId === projectId && m.weekStart === w) ? ' 🔒' : ''}
                      {w === currentWeek && <span className="block text-[10px]">(นี้)</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((list) => {
                const names = [...new Set(list.map((i) => i.plotName).filter((n): n is string => !!n))]
                return (
                  <tr key={`${list[0].jobAssignmentId ? 'b' : 'm'}|${list[0].title}`}>
                    <td className="border-b border-slate-100 py-2 pr-2">
                      {list[0].title} {names.length > 0 && <span className="text-xs text-slate-500">{compressPlotNames(names)}</span>}
                    </td>
                    {data.weeks.map((w) => {
                      const c = cell(list.filter((i) => i.weekStart === w))
                      return (
                        <td key={w} className={`border-b border-slate-100 px-1 py-2 text-center ${w === currentWeek ? 'bg-indigo-50/40' : ''}`}>
                          {c && <span className={`inline-block min-w-[46px] rounded px-1.5 py-0.5 text-xs tabular-nums ${c.cls}`}>{c.text}</span>}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">ตัวเลข = ทำได้ ณ สิ้นสัปดาห์ · เส้นประ = วางแผนไว้ ยังไม่มีความคืบหน้า · เหลือง = ช้ากว่าแผน · แตะวันที่เพื่อเปิดสัปดาห์นั้น</p>
    </Card>
  )
}
