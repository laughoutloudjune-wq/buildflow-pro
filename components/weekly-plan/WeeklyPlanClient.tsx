'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarCheck, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
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
import { addDaysStr, formatThaiDay, formatThaiMonth, formatWeekRange, WEEKLY_PLAN_KINDS } from '@/lib/weekly-plan'
import WeeklyPlanItemModal from './WeeklyPlanItemModal'

const REQUEST_STATUS_LABEL: Record<string, string> = { new: 'ใหม่', accepted: 'รับเรื่องแล้ว', in_progress: 'กำลังทำ' }

export default function WeeklyPlanClient({ data, projectId }: { data: WeeklyPlanData; projectId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const [view, setView] = useState<'week' | 'month'>('week')
  const [modal, setModal] = useState<{ open: boolean; item: WeeklyPlanItem | null }>({ open: false, item: null })
  const [deleting, setDeleting] = useState<WeeklyPlanItem | null>(null)

  const { weekStart, canManage, userId } = data
  const project = data.projects.find((p) => p.id === projectId)
  const canEdit = (item: WeeklyPlanItem) => canManage || item.createdBy === userId

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
        <p className={`text-sm ${item.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{item.title}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {item.plotName ? `แปลง ${item.plotName} · ` : ''}
          {item.ownerName ? `ผู้รับผิดชอบ: ${item.ownerName}` : <span className="text-amber-600">ยังไม่มีผู้รับผิดชอบ</span>}
        </p>
      </div>
      {canEdit(item) && (
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setModal({ open: true, item })}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="แก้ไข"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setDeleting(item)}
            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
            aria-label="ลบ"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </li>
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="แผนงานประจำสัปดาห์"
        subtitle={project ? project.name : 'เลือกโครงการ'}
        actions={
          <Button onClick={() => setModal({ open: true, item: null })} disabled={!project}>
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
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-2 text-sm">
              <CalendarCheck className={`h-5 w-5 ${meeting ? 'text-emerald-600' : 'text-slate-400'}`} />
              {meeting ? (
                <span className="text-emerald-700">
                  ตกลงแผนในที่ประชุมแล้ว{meeting.agreedByName ? ` โดย ${meeting.agreedByName}` : ''} ·{' '}
                  {new Date(meeting.agreedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                </span>
              ) : (
                <span className="text-slate-500">ยังไม่ได้ตกลงแผนสัปดาห์นี้</span>
              )}
            </div>
            {canManage && project && (
              <div className="flex gap-2">
                {meeting && (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => unagreeWeeklyPlan(projectId, weekStart))}>
                    ยกเลิก
                  </Button>
                )}
                <Button
                  variant={meeting ? 'secondary' : 'primary'}
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => agreeWeeklyPlan(projectId, weekStart), 'บันทึกการตกลงแผนแล้ว')}
                >
                  {meeting ? 'ตกลงแผนอีกครั้ง' : 'ตกลงแผนในที่ประชุมแล้ว'}
                </Button>
              </div>
            )}
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {WEEKLY_PLAN_KINDS.map((k) => {
              const list = weekItems.filter((i) => i.kind === k.value)
              return (
                <Card key={k.value} className="p-4">
                  <h3 className="mb-3 flex items-center justify-between text-sm font-semibold text-slate-800">
                    {k.label}
                    <span className="text-xs font-normal text-slate-400">
                      {list.filter((i) => i.status === 'done').length}/{list.length}
                    </span>
                  </h3>
                  {list.length === 0 ? <p className="text-sm text-slate-400">ยังไม่มีรายการ</p> : <ul className="space-y-2">{list.map(renderItem)}</ul>}
                </Card>
              )
            })}
          </div>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">งานจากฝ่ายขายที่ต้องใช้ฝ่ายก่อสร้าง (ดูอย่างเดียว)</h3>
            {salesRequests.length === 0 && salesPlots.length === 0 ? (
              <p className="text-sm text-slate-400">ไม่มีรายการ</p>
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
          {data.weeks.map((w) => {
            const items = data.items.filter((i) => i.projectId === projectId && i.weekStart === w)
            const agreed = data.meetings.some((m) => m.projectId === projectId && m.weekStart === w)
            const unassigned = items.filter((i) => !i.ownerId && i.status === 'planned').length
            return (
              <Card key={w} className={`p-4 ${w === weekStart ? 'ring-2 ring-indigo-200' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" className="text-sm font-semibold text-indigo-700 hover:underline" onClick={() => { setView('week'); go(w) }}>
                    {formatWeekRange(w)}
                  </button>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    {WEEKLY_PLAN_KINDS.map((k) => (
                      <span key={k.value}>
                        {k.label} {items.filter((i) => i.kind === k.value).length}
                      </span>
                    ))}
                    {unassigned > 0 && <span className="text-amber-600">ไม่มีผู้รับผิดชอบ {unassigned}</span>}
                    {agreed && <span className="text-emerald-600">ตกลงแผนแล้ว</span>}
                  </div>
                </div>
                {items.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-sm text-slate-600">
                    {items.map((i) => (
                      <li key={i.id} className={i.status === 'done' ? 'text-slate-400 line-through' : ''}>
                        [{WEEKLY_PLAN_KINDS.find((k) => k.value === i.kind)?.label}] {i.title}
                        {i.plotName ? ` (แปลง ${i.plotName})` : ''}
                      </li>
                    ))}
                  </ul>
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
        message={`ต้องการลบ "${deleting?.title ?? ''}" ใช่หรือไม่`}
        confirmLabel="ลบ"
        cancelLabel="ยกเลิก"
        busy={pending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting
          setDeleting(null)
          if (target) run(() => deleteWeeklyPlanItem(target.id), 'ลบรายการแล้ว')
        }}
      />
    </div>
  )
}
