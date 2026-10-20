'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarCheck, ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react'
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
  updateWeeklyPlanItem,
  type WeeklyPlanData,
  type WeeklyPlanItem,
} from '@/actions/weekly-plan-actions'
import { addDaysStr, currentProgress, dayIndexInWeek, formatThaiDay, formatWeekRange, mondayOf, WEEKLY_PLAN_KINDS } from '@/lib/weekly-plan'
import { todayInBangkok } from '@/lib/utils'
import WeeklyPlanItemModal from './WeeklyPlanItemModal'
import AddWorkSheet from './AddWorkSheet'

const REQUEST_STATUS_LABEL: Record<string, string> = { new: 'ใหม่', accepted: 'รับเรื่องแล้ว', in_progress: 'กำลังทำ' }

const plotSort = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true })

type Result = { ok: true } | { error: string }

/** One job on one plot: a % box that saves as you type, a "เสร็จ" button and a ⋯ menu. */
function JobRow({
  item,
  label,
  data,
  canCheck,
  agreed,
  editable,
  busy,
  failRev,
  onSavePct,
  onNote,
  onCrew,
  onDelete,
  onEditFree,
}: {
  item: WeeklyPlanItem
  label?: string
  data: WeeklyPlanData
  canCheck: boolean
  agreed: boolean
  editable: boolean
  busy: boolean
  failRev: number
  onSavePct: (item: WeeklyPlanItem, v: number) => void
  onNote: (item: WeeklyPlanItem, note: string) => void
  onCrew: (item: WeeklyPlanItem, contractorId: string) => void
  onDelete: (item: WeeklyPlanItem) => void
  onEditFree: (item: WeeklyPlanItem) => void
}) {
  const server = item.status === 'done' ? 100 : currentProgress(item)
  const [localState, setLocal] = useState<{ base: number; v: number; rev: number } | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(item.note ?? '')
  // What was just typed shows at once; it is dropped when the saved value changes or a save fails.
  const value = localState && localState.base === server && localState.rev === failRev ? localState.v : server
  const from = item.carryPct ?? 0
  const done = value >= 100

  const save = (v: number) => {
    const n = Math.min(100, Math.max(0, Math.round(v)))
    setLocal({ base: server, v: n, rev: failRev })
    if (n !== server) onSavePct(item, n)
  }
  const commit = () => {
    const t = text
    setText(null)
    if (t == null || t.trim() === '') return
    const n = Number(t)
    if (Number.isFinite(n)) save(n)
  }
  const disabledReason = canCheck ? undefined : 'ยังไม่ถึงสัปดาห์นี้ บันทึกความคืบหน้าไม่ได้'

  return (
    <div className="border-b border-slate-100 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-48">
          <div className="truncate text-sm font-medium text-slate-800">{label ?? item.title}</div>
          <div className="truncate text-xs text-slate-500">
            {item.jobAssignmentId ? item.contractorName || <span className="text-amber-700">ยังไม่มีช่าง</span> : WEEKLY_PLAN_KINDS.find((k) => k.value === item.kind)?.label}
            {value !== from && item.jobAssignmentId ? ` · จาก ${Math.round(from)}%` : ''}
            {item.note ? ` · ${item.note}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            disabled={!canCheck || busy}
            title={disabledReason}
            value={text ?? value}
            onFocus={(e) => {
              setText(String(value))
              e.target.select()
            }}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            aria-label={`ความคืบหน้า ${label ?? item.title} (%)`}
            className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right text-sm tabular-nums disabled:bg-slate-50"
          />
          <span className="text-sm text-slate-500">%</span>
          <button
            type="button"
            disabled={!canCheck || busy}
            title={disabledReason}
            onClick={() => save(done ? from : 100)}
            className={`rounded-lg border px-2.5 py-1 text-sm font-medium disabled:opacity-50 ${done ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
          >
            {done ? '✓ เสร็จ' : 'เสร็จ'}
          </button>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="เพิ่มเติม" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2.5 text-sm">
          <label className="block">
            <span className="mb-0.5 block text-xs text-slate-500">หมายเหตุ (ไม่บังคับ)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note.trim() !== (item.note ?? '') && onNote(item, note)}
              disabled={!editable}
              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
            />
          </label>
          {item.jobAssignmentId && (
            <label className="block">
              <span className="mb-0.5 block text-xs text-slate-500">ช่าง</span>
              <select
                value={item.contractorId ?? ''}
                disabled={!editable || agreed}
                onChange={(e) => onCrew(item, e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">ยังไม่เลือกช่าง</option>
                {data.contractors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex gap-4 text-xs">
            {!item.jobAssignmentId && editable && !agreed && (
              <button type="button" className="font-medium text-indigo-600 hover:underline" onClick={() => onEditFree(item)}>
                แก้ไขงาน
              </button>
            )}
            {editable && !agreed && (
              <button type="button" className="font-medium text-red-600 hover:underline" onClick={() => onDelete(item)}>
                เอาออกจากแผน
              </button>
            )}
            {agreed && <span className="text-slate-500">แผนตกลงแล้ว เปลี่ยนช่างหรือเอางานออกไม่ได้</span>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function WeeklyPlanClient({ data, projectId }: { data: WeeklyPlanData; projectId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const { weekStart, canManage, userId } = data
  const weekItems = useMemo(
    () => data.items.filter((i) => i.projectId === projectId && i.weekStart === weekStart),
    [data.items, projectId, weekStart]
  )
  const [modal, setModal] = useState<{ open: boolean; item: WeeklyPlanItem | null }>({ open: false, item: null })
  const [adding, setAdding] = useState(false)
  const [failRev, setFailRev] = useState(0)
  const [deleting, setDeleting] = useState<WeeklyPlanItem[] | null>(null)

  const today = todayInBangkok()
  const currentWeek = mondayOf(today)
  const project = data.projects.find((p) => p.id === projectId)
  const canEdit = (item: WeeklyPlanItem) => canManage || item.createdBy === userId
  const meeting = data.meetings.find((m) => m.projectId === projectId && m.weekStart === weekStart)
  const agreed = !!meeting

  // Progress is written on today's column in the current week, the last column of a past week.
  const dayFor = (week: string) => dayIndexInWeek(week, today) ?? (week < today ? 6 : 0)
  const canCheck = weekStart <= today
  const nextWeek = addDaysStr(weekStart, 7)

  const salesRequests = data.salesRequests.filter((r) => r.projectId === projectId)
  const salesPlots = data.salesPlots.filter((p) => p.projectId === projectId)
  const hints = data.targetHints.filter((h) => h.projectId === projectId)
  const carryOver = data.carryOver.filter((c) => c.projectId === projectId)

  const go = (week: string, nextProject: string = projectId) => {
    router.push(`/dashboard/weekly-plan?week=${week}&project=${nextProject}`)
  }

  const run = (fn: () => Promise<Result>, success?: string) => {
    startTransition(async () => {
      const res = await fn()
      if ('error' in res) {
        toast.error(res.error)
        setFailRev((r) => r + 1)
      } else {
        if (success) toast.success(success)
        router.refresh()
      }
    })
  }

  /** Clears every recorded day so the typed number is the only reading (the latest day wins). */
  const clearActuals = async (item: WeeklyPlanItem): Promise<Result> => {
    for (let d = 0; d < 7; d++) {
      if (item.actualPct[d] == null) continue
      const res = await recordWeeklyPlanActual(item.id, d, null)
      if ('error' in res) return res
    }
    return { ok: true }
  }

  const savePct = (item: WeeklyPlanItem, v: number) => {
    const before = item.status === 'done' ? 100 : currentProgress(item)
    if (v < before) toast.info(`ลดจาก ${Math.round(before)}% เป็น ${v}%`)
    run(async () => {
      const cleared = await clearActuals(item)
      if ('error' in cleared) return cleared
      const rec = await recordWeeklyPlanActual(item.id, dayFor(item.weekStart), v)
      if ('error' in rec) return rec
      if (v >= 100 && item.status !== 'done') return setWeeklyPlanItemStatus(item.id, 'done')
      if (v < 100 && item.status === 'done') return setWeeklyPlanItemStatus(item.id, 'planned')
      return { ok: true as const }
    })
  }

  const setCrew = (item: WeeklyPlanItem, contractorId: string) =>
    run(() =>
      updateWeeklyPlanItem(item.id, {
        projectId: item.projectId,
        plotId: item.plotId,
        weekStart: item.weekStart,
        kind: item.kind,
        title: item.title,
        jobAssignmentId: item.jobAssignmentId,
        ownerId: item.ownerId,
        contractorId: contractorId || null,
        carryPct: item.carryPct,
        planPct: item.planPct,
        actualPct: item.actualPct,
        note: item.note,
      })
    )

  const byPlot = useMemo(() => {
    const map = new Map<string, WeeklyPlanItem[]>()
    for (const i of weekItems) {
      if (!i.jobAssignmentId) continue
      const key = i.plotName ?? '-'
      map.set(key, [...(map.get(key) || []), i])
    }
    return [...map.entries()].sort((a, b) => plotSort(a[0], b[0]))
  }, [weekItems])
  const freeItems = weekItems.filter((i) => !i.jobAssignmentId)
  const finished = weekItems.filter((i) => (i.status === 'done' ? 100 : currentProgress(i)) >= 100).length

  const rowProps = {
    data,
    canCheck,
    agreed,
    busy: pending,
    failRev,
    onSavePct: savePct,
    onNote: (item: WeeklyPlanItem, note: string) => run(() => setWeeklyPlanItemNote(item.id, note.trim() || null)),
    onCrew: setCrew,
    onDelete: (item: WeeklyPlanItem) => setDeleting([item]),
    onEditFree: (item: WeeklyPlanItem) => setModal({ open: true, item }),
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="แผนงาน"
        subtitle={project ? project.name : 'เลือกโครงการ'}
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => setModal({ open: true, item: null })}
              disabled={!project || agreed}
              title={agreed ? 'แผนสัปดาห์นี้ตกลงแล้ว ต้องเปิดแก้ไขแผนก่อนจึงจะเพิ่มงานได้' : 'งานซ่อม · DC · ตรวจบ้าน ที่ไม่อยู่ใน BOQ'}
            >
              งานนอก BOQ
            </Button>
            <Button onClick={() => setAdding(true)} disabled={!project || agreed} title={agreed ? 'แผนสัปดาห์นี้ตกลงแล้ว ต้องเปิดแก้ไขแผนก่อนจึงจะเพิ่มงานได้' : undefined}>
              <Plus className="h-4 w-4" /> เพิ่มงานสัปดาห์นี้
            </Button>
          </div>
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
        {weekItems.length > 0 && (
          <span className="text-sm text-slate-600">
            เสร็จแล้ว {finished}/{weekItems.length} งาน
          </span>
        )}
      </div>

      {carryOver.length > 0 && !agreed && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          <span className="flex items-start gap-2 text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              สัปดาห์ก่อนมีงานค้าง {carryOver.length} รายการ
              <span className="block text-xs text-amber-800">
                {[...new Set(carryOver.map((c) => c.title))].slice(0, 4).join(', ')}
                {new Set(carryOver.map((c) => c.title)).size > 4 ? ' ...' : ''}
              </span>
            </span>
          </span>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await rollOverWeeklyPlan(projectId, weekStart)
                if ('error' in res) return res
                toast.success(`ยกงานค้างมา ${res.created} รายการ`)
                return { ok: true as const }
              })
            }
          >
            ยกมาสัปดาห์นี้
          </Button>
        </div>
      )}

      {weekItems.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-600">
          <p className="font-medium text-slate-800">ยังไม่มีงานในสัปดาห์นี้</p>
          <p className="mt-1">กด &quot;เพิ่มงานสัปดาห์นี้&quot; พิมพ์เลขแปลง แล้วติ๊กงานที่จะทำ</p>
        </Card>
      ) : (
        <Card className="space-y-4 p-4">
          {byPlot.map(([plotName, items]) => (
            <section key={plotName}>
              <h3 className="border-b border-slate-200 pb-1 text-sm font-semibold text-slate-800">
                แปลง {plotName}
                {items[0]?.plotId && <span className="ml-2 text-xs font-normal text-slate-500">{data.plots.find((p) => p.id === items[0].plotId)?.houseType}</span>}
              </h3>
              {items.map((item) => (
                <JobRow key={item.id} item={item} editable={canEdit(item)} {...rowProps} />
              ))}
            </section>
          ))}
          {freeItems.length > 0 && (
            <section>
              <h3 className="border-b border-slate-200 pb-1 text-sm font-semibold text-slate-800">งานนอก BOQ</h3>
              {freeItems.map((item) => (
                <JobRow key={item.id} item={item} label={`${item.plotName ? `แปลง ${item.plotName} · ` : ''}${item.title}`} editable={canEdit(item)} {...rowProps} />
              ))}
            </section>
          )}
          {!canCheck && <p className="text-xs text-slate-500">ยังไม่ถึงสัปดาห์นี้ บันทึกความคืบหน้าไม่ได้ เพิ่มงานล่วงหน้าได้</p>}
        </Card>
      )}

          <Card className={`p-3 ${meeting ? 'border-emerald-200' : ''}`}>
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
          }}
        />
      )}

      {adding && project && (
        <AddWorkSheet
          projectId={projectId}
          weekStart={weekStart}
          contractors={data.contractors}
          onClose={() => setAdding(false)}
          onAdded={(n) => {
            setAdding(false)
            toast.success(`เพิ่มงาน ${n} รายการเข้าแผนสัปดาห์นี้`)
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
