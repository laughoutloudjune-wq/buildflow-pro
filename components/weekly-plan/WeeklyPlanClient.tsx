'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useDepartment } from '@/components/layout/DepartmentContext'
import { useToast } from '@/components/ui/Toast'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import {
  agreeWeeklyPlan,
  deleteWeeklyPlanItem,
  setWeeklyPlanItemStatus,
  unagreeWeeklyPlan,
  type WeeklyPlanData,
  type WeeklyPlanItem,
} from '@/actions/weekly-plan-actions'
import {
  addDaysStr,
  compressPlotNames,
  dailyAverages,
  formatThaiDay,
  formatThaiMonth,
  formatWeekRange,
  groupPlanItems,
  isBehindPlan,
  latestPct,
  mondayOf,
  WEEKLY_PLAN_KINDS,
  WEEK_DAY_LABELS,
} from '@/lib/weekly-plan'
import ActionMenu from '@/components/ui/ActionMenu'
import WeeklyPlanItemModal from './WeeklyPlanItemModal'

/** Latest filled-in value of a Mon..Sun % row. */
function lastPct(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return values[i]
  return null
}

/** Task groups shown per week before "view all". */
const PREVIEW_GROUPS = 4

const REQUEST_STATUS_LABEL: Record<string, string> = { new: 'ใหม่', accepted: 'รับเรื่องแล้ว', in_progress: 'กำลังทำ' }

export default function WeeklyPlanClient({ data, projectId }: { data: WeeklyPlanData; projectId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const [view, setView] = useState<'week' | 'month'>('week')
  const [modal, setModal] = useState<{ open: boolean; item: WeeklyPlanItem | null }>({ open: false, item: null })
  const [deleting, setDeleting] = useState<WeeklyPlanItem[] | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [monthExpanded, setMonthExpanded] = useState<Set<string>>(new Set())
  const { theme } = useDepartment()
  // Monday of today's week in Bangkok time, to mark the current week in the month view.
  const currentWeek = mondayOf(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()))

  const { weekStart, canManage, userId } = data
  const project = data.projects.find((p) => p.id === projectId)
  const canEdit = (item: WeeklyPlanItem) => canManage || item.createdBy === userId
  const isAgreed = (week: string) => data.meetings.some((m) => m.projectId === projectId && m.weekStart === week)

  const go = (week: string, project: string = projectId) => {
    router.push(`/dashboard/weekly-plan?week=${week}&project=${project}`)
  }

  const weekItems = useMemo(
    () => data.items.filter((i) => i.projectId === projectId && i.weekStart === weekStart),
    [data.items, projectId, weekStart]
  )
  const meeting = data.meetings.find((m) => m.projectId === projectId && m.weekStart === weekStart)
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

  const toggleDone = (item: WeeklyPlanItem) =>
    run(() => setWeeklyPlanItemStatus(item.id, item.status === 'done' ? 'planned' : 'done'))

  const renderItem = (item: WeeklyPlanItem) => (
    <li key={item.id} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2">
      <input
        type="checkbox"
        checked={item.status === 'done'}
        disabled={pending}
        onChange={() => toggleDone(item)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600"
        aria-label="ทำเสร็จแล้ว"
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${item.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
          {item.jobAssignmentId && (
            <span className="mr-1.5 rounded-lg bg-indigo-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-indigo-700">BOQ</span>
          )}
          {item.title}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {item.plotName ? `แปลง ${item.plotName} · ` : ''}
          {item.jobAssignmentId && item.jobQuantity != null
            ? `${item.jobQuantity.toLocaleString('th-TH', { maximumFractionDigits: 2 })}${item.jobUnit ? ` ${item.jobUnit}` : ''} · `
            : ''}
          {item.contractorName ? `${item.contractorName} · ` : ''}
          {item.ownerName ? `ผู้รับผิดชอบ: ${item.ownerName}` : <span className="text-amber-600">ยังไม่มีผู้รับผิดชอบ</span>}
        </p>
        {(item.carryPct != null || lastPct(item.planPct) != null || lastPct(item.actualPct) != null) && (
          <p className="mt-0.5 text-xs text-slate-500">
            {item.carryPct != null && <>ยกมา {item.carryPct}% · </>}
            PLAN {lastPct(item.planPct) ?? '-'}% · ACTUAL {lastPct(item.actualPct) ?? '-'}%
          </p>
        )}
        {item.note && <p className="mt-0.5 text-xs text-slate-500">{item.note}</p>}
      </div>
      {canEdit(item) && (
        <ActionMenu
          label={`ตัวเลือก: ${item.title}`}
          items={[
            { label: 'แก้ไขรายการ', icon: <Pencil />, onClick: () => setModal({ open: true, item }) },
            ...(!isAgreed(item.weekStart) ? [{ label: 'ลบรายการ', icon: <Trash2 />, danger: true, onClick: () => setDeleting([item]) }] : []),
          ]}
        />
      )}
    </li>
  )

  const average = (values: (number | null)[]) => {
    const present = values.filter((v): v is number => v != null)
    return present.length === 0 ? null : Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 10) / 10
  }

  // A batch (same task on several plots) shows as one row with a plot range;
  // "ดูรายแปลง" opens the normal per-plot rows for editing one plot.
  const renderGroup = (group: WeeklyPlanItem[]) => {
    if (group.length === 1) return renderItem(group[0])
    const first = group[0]
    const key = `${first.kind}|${first.title}|${first.contractorId ?? ''}|${first.ownerId ?? ''}|${first.weekStart}|${first.jobAssignmentId ? 'boq' : 'm'}`
    const doneCount = group.filter((i) => i.status === 'done').length
    const allDone = doneCount === group.length
    const open = expanded.has(key)
    const names = group.map((i) => i.plotName).filter((n): n is string => !!n)
    const plan = average(group.map((i) => latestPct(i.planPct)?.value ?? null))
    const actual = average(group.map((i) => latestPct(i.actualPct)?.value ?? null))
    const canDeleteAll = group.every((i) => canEdit(i)) && !isAgreed(first.weekStart)
    const toggleAll = () =>
      run(async () => {
        const next = allDone ? 'planned' : 'done'
        for (const i of group) {
          if (i.status === next) continue
          const res = await setWeeklyPlanItemStatus(i.id, next)
          if ('error' in res) return res
        }
        return { ok: true as const }
      })
    return (
      <li key={key} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            ref={(el) => {
              if (el) el.indeterminate = doneCount > 0 && !allDone
            }}
            checked={allDone}
            disabled={pending}
            onChange={toggleAll}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600"
            aria-label="ทำเสร็จแล้วทั้งกลุ่ม"
          />
          <div className="min-w-0 flex-1">
            <p className={`text-sm ${allDone ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
              {first.jobAssignmentId && (
                <span className="mr-1.5 rounded-lg bg-indigo-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-indigo-700">BOQ</span>
              )}
              {first.title}
              <span className="ml-2 text-xs font-normal text-slate-500">
                {names.length > 0 ? `แปลง ${compressPlotNames(names)}` : ''} ({group.length} รายการ · เสร็จ {doneCount}/{group.length})
              </span>
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {first.contractorName ? `${first.contractorName} · ` : ''}
              {first.ownerName ? `ผู้รับผิดชอบ: ${first.ownerName}` : <span className="text-amber-700">ยังไม่มีผู้รับผิดชอบ</span>}
            </p>
            {(plan != null || actual != null) && (
              <p className="mt-0.5 text-xs text-slate-500">
                เฉลี่ย PLAN {plan ?? '-'}% · ACTUAL {actual ?? '-'}%
              </p>
            )}
            <button
              type="button"
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev)
                  if (next.has(key)) next.delete(key)
                  else next.add(key)
                  return next
                })
              }
              aria-expanded={open}
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-[180ms] ${open ? 'rotate-180' : ''}`} />
              {open ? 'ซ่อนรายแปลง' : `ดูรายแปลง (${group.length})`}
            </button>
          </div>
          {canDeleteAll && (
            <button
              type="button"
              onClick={() => setDeleting(group)}
              className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label={`ลบทั้งกลุ่ม ${group.length} รายการ`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
        {open && <ul className="mt-2 space-y-2 border-t border-slate-100 pt-2">{group.map(renderItem)}</ul>}
      </li>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={view === 'week' ? 'แผนงานประจำสัปดาห์' : 'แผนงานประจำเดือน'}
        subtitle={project ? project.name : 'เลือกโครงการ'}
        actions={
          <Button
            onClick={() => setModal({ open: true, item: null })}
            disabled={!project || (view === 'week' && !!meeting)}
            title={view === 'week' && meeting ? 'แผนสัปดาห์นี้ตกลงแล้ว — ยกเลิกการตกลงแผนก่อนจึงจะเพิ่มงานได้' : undefined}
          >
            <Plus className="h-4 w-4" /> เพิ่มรายการ
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
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {(['week', 'month'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 font-medium ${view === v ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'}`}
            >
              {v === 'week' ? 'รายสัปดาห์' : 'รายเดือน'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => go(addDaysStr(weekStart, view === 'week' ? -7 : -28))} aria-label="ก่อนหน้า">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[10rem] text-center text-sm font-medium text-slate-700">
            {view === 'week' ? formatWeekRange(weekStart) : formatThaiMonth(weekStart)}
          </span>
          <Button variant="secondary" size="sm" onClick={() => go(addDaysStr(weekStart, view === 'week' ? 7 : 28))} aria-label="ถัดไป">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {view === 'week' ? (
        <>
          <Card className={`p-4 ${meeting ? 'border-emerald-200' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${meeting ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  <CalendarCheck className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 space-y-1.5 text-sm">
                  {meeting ? (
                    <>
                      <p className="font-semibold text-emerald-800">
                        ตกลงแผนในที่ประชุมแล้ว
                        <span className="ml-2 font-normal text-slate-500">
                          {meeting.agreedByName ? `โดย ${meeting.agreedByName} · ` : ''}
                          {new Date(meeting.agreedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                        </span>
                      </p>
                      <p className="text-slate-600">
                        <span className="font-medium text-slate-700">ล็อกอยู่:</span> เพิ่ม ลบ หรือย้ายงาน · งานที่เลือก · ผู้รับเหมา · ผู้รับผิดชอบ · PLAN รายวัน
                      </p>
                      <p className="text-slate-600">
                        <span className="font-medium text-slate-700">ยังแก้ได้:</span> ยอดยกมา · ACTUAL รายวัน · หมายเหตุ · ติ๊กว่าเสร็จแล้ว
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-slate-800">ยังไม่ได้ตกลงแผนสัปดาห์นี้</p>
                      <p className="text-slate-600">
                        เมื่อตกลงแผนในที่ประชุมแล้ว ระบบจะล็อกตัวแผน (เพิ่ม/ลบ/ย้ายงาน ผู้รับเหมา PLAN) โดยยังกรอก ACTUAL และหมายเหตุได้
                      </p>
                    </>
                  )}
                </div>
              </div>
              {canManage && project && (
                <div className="flex shrink-0 gap-2">
                  {meeting && (
                    <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => unagreeWeeklyPlan(projectId, weekStart), 'เปิดแก้ไขแผนแล้ว')}>
                      เปิดแก้ไขแผน
                    </Button>
                  )}
                  {!meeting && (
                    <Button size="sm" disabled={pending} onClick={() => run(() => agreeWeeklyPlan(projectId, weekStart), 'บันทึกการตกลงแผนแล้ว')}>
                      ตกลงแผนในที่ประชุมแล้ว
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>

          {weekItems.some((i) => i.planPct.some((v) => v != null) || i.actualPct.some((v) => v != null)) && (
            <Card className="p-4">
              {(() => {
                const avg = dailyAverages(weekItems)
                const behind = weekItems.filter(isBehindPlan).length
                return (
                  <>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-800">สรุปความคืบหน้าสัปดาห์ (เฉลี่ยทุกรายการ)</h3>
                      {behind > 0 && <span className="text-xs font-medium text-amber-700">⚠ ล่าช้ากว่าแผน {behind} รายการ</span>}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[28rem] text-center text-sm">
                        <thead>
                          <tr className="text-xs text-slate-500">
                            <th className="w-20 py-1 text-left font-medium"> </th>
                            {WEEK_DAY_LABELS.map((d) => (
                              <th key={d} className="py-1 font-medium">{d}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {([['PLAN', avg.plan], ['ACTUAL', avg.actual]] as const).map(([label, row]) => (
                            <tr key={label} className="border-t border-slate-100">
                              <td className="py-1.5 text-left text-xs font-semibold text-slate-600">{label}</td>
                              {row.map((v, i) => (
                                <td key={i} className="py-1.5 text-slate-700">{v == null ? '-' : `${v}%`}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )
              })()}
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {WEEKLY_PLAN_KINDS.map((k) => {
              const list = weekItems.filter((i) => i.kind === k.value)
              return (
                <Card key={k.value} className="p-4">
                  <h3 className="mb-3 flex items-center justify-between text-sm font-semibold text-slate-800">
                    {k.label}
                    <span className="text-xs font-normal text-slate-500">
                      {list.filter((i) => i.status === 'done').length}/{list.length}
                    </span>
                  </h3>
                  {list.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรายการ</p> : <ul className="space-y-2">{groupPlanItems(list).map(renderGroup)}</ul>}
                </Card>
              )
            })}
          </div>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">งานจากฝ่ายขายที่ต้องใช้ฝ่ายก่อสร้าง (ดูอย่างเดียว)</h3>
            {salesRequests.length === 0 && salesPlots.length === 0 ? (
              <p className="text-sm text-slate-500">ไม่มีรายการ</p>
            ) : (
              <ul className="space-y-1.5 text-sm text-slate-700">
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
              </ul>
            )}
          </Card>

          {hints.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-800">เป้าหมายตามแผนงานแต่ละแปลงในสัปดาห์นี้ (ดูอย่างเดียว)</h3>
              <ul className="space-y-1 text-sm text-slate-600">
                {hints.map((h, i) => (
                  <li key={`${h.plotId}-${i}`}>
                    {formatThaiDay(h.date)} · แปลง {h.plotName}: {h.text}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : (
        <div className="space-y-3">
          {(() => {
            const monthItems = data.items.filter((i) => i.projectId === projectId)
            const done = monthItems.filter((i) => i.status === 'done').length
            const behind = monthItems.filter(isBehindPlan).length
            const noOwner = monthItems.filter((i) => !i.ownerId && i.status === 'planned').length
            return (
              <Card className="flex flex-wrap items-center gap-x-6 gap-y-1 p-4 text-sm">
                <span className="font-semibold text-slate-800">ทั้งเดือน {monthItems.length} รายการ</span>
                <span className="text-slate-600">เสร็จแล้ว {done}</span>
                <span className={behind > 0 ? 'font-medium text-amber-700' : 'text-slate-600'}>ล่าช้ากว่าแผน {behind}</span>
                <span className={noOwner > 0 ? 'font-medium text-amber-700' : 'text-slate-600'}>ยังไม่มีผู้รับผิดชอบ {noOwner}</span>
              </Card>
            )
          })()}
          {data.weeks.map((w) => {
            const items = data.items.filter((i) => i.projectId === projectId && i.weekStart === w)
            const agreed = data.meetings.some((m) => m.projectId === projectId && m.weekStart === w)
            const unassigned = items.filter((i) => !i.ownerId && i.status === 'planned').length
            const noContractor = items.filter((i) => i.jobAssignmentId && !i.contractorId && i.status === 'planned').length
            const behindCount = items.filter(isBehindPlan).length
            // Workload by trade (BOQ work) so a week's load is visible at a glance.
            const trades = new Map<string, number>()
            for (const i of items) {
              const key = i.jobAssignmentId ? i.jobTrade || 'BOQ' : WEEKLY_PLAN_KINDS.find((k) => k.value === i.kind)?.label || i.kind
              trades.set(key, (trades.get(key) || 0) + 1)
            }
            const groups = groupPlanItems(items)
            const doneCount = items.filter((i) => i.status === 'done').length
            const isCurrent = w === currentWeek
            const showAll = monthExpanded.has(w)
            const visibleGroups = showAll ? groups : groups.slice(0, PREVIEW_GROUPS)
            const exceptions = [
              ...(unassigned > 0 ? [`ยังไม่มีผู้รับผิดชอบ ${unassigned}`] : []),
              ...(noContractor > 0 ? [`ยังไม่มีผู้รับเหมา ${noContractor}`] : []),
              ...(behindCount > 0 ? [`ล่าช้ากว่าแผน ${behindCount}`] : []),
            ]
            return (
              <Card key={w} className="relative overflow-hidden p-0">
                {/* Current week: department accent on the left edge. */}
                {isCurrent && <div aria-hidden className={`absolute inset-y-0 left-0 w-1 ${theme.solid}`} />}

                {/* 1. Header: week (click to open), current/agreed cues */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={`text-base font-semibold hover:underline ${isCurrent ? theme.text : 'text-slate-900'}`}
                      onClick={() => {
                        setView('week')
                        go(w)
                      }}
                    >
                      {formatWeekRange(w)}
                    </button>
                    {isCurrent && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${theme.chip}`}>สัปดาห์นี้</span>}
                  </div>
                  {agreed ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      <CalendarCheck className="h-3.5 w-3.5" aria-hidden /> ตกลงแผนแล้ว
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">ยังไม่ตกลงแผน</span>
                  )}
                </div>

                {items.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-slate-500">ยังไม่มีรายการในสัปดาห์นี้</p>
                ) : (
                  <div className="space-y-3 px-5 py-4">
                    {/* 2. Metrics + exceptions */}
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                      <div>
                        <p className="text-xs text-slate-500">รายการทั้งหมด</p>
                        <p className="text-base font-semibold tabular-nums text-slate-900">{items.length}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">เสร็จแล้ว</p>
                        <p className="text-base font-semibold tabular-nums text-slate-900">
                          {doneCount}
                          <span className="font-normal text-slate-500">/{items.length}</span>
                        </p>
                      </div>
                      {exceptions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {exceptions.map((e) => (
                            <span key={e} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                              <AlertTriangle className="h-3 w-3" aria-hidden /> {e}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 3. Trade / category chips */}
                    {trades.size > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {[...trades.entries()].map(([name, n]) => (
                          <span key={name} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">
                            {name} <span className="tabular-nums font-medium">{n}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 4. Task preview */}
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                      {visibleGroups.map((g) => {
                        const i = g[0]
                        const names = g.map((x) => x.plotName).filter((n): n is string => !!n)
                        const allDone = g.every((x) => x.status === 'done')
                        const meta = [
                          names.length > 0 ? `แปลง ${compressPlotNames(names)}` : null,
                          g.length > 1 ? `${g.length} รายการ` : null,
                          i.contractorName,
                        ].filter(Boolean)
                        return (
                          <li key={i.id} className="flex items-start gap-3 px-3 py-2">
                            <span
                              className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                                i.jobAssignmentId ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {i.jobAssignmentId ? 'BOQ' : WEEKLY_PLAN_KINDS.find((k) => k.value === i.kind)?.label}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm ${allDone ? 'text-slate-500 line-through' : 'text-slate-800'}`}>{i.title}</p>
                              {meta.length > 0 && <p className="mt-0.5 text-xs text-slate-500">{meta.join(' · ')}</p>}
                            </div>
                            {g.some(isBehindPlan) && (
                              <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">ล่าช้า</span>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                    {groups.length > PREVIEW_GROUPS && (
                      <button
                        type="button"
                        onClick={() =>
                          setMonthExpanded((prev) => {
                            const next = new Set(prev)
                            if (next.has(w)) next.delete(w)
                            else next.add(w)
                            return next
                          })
                        }
                        aria-expanded={showAll}
                        className={`inline-flex items-center gap-1 text-xs font-medium hover:underline ${theme.text}`}
                      >
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-[180ms] ${showAll ? 'rotate-180' : ''}`} />
                        {showAll ? 'ย่อรายการ' : `ดูทั้งหมด ${groups.length} งาน (${items.length} รายการ)`}
                      </button>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
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
