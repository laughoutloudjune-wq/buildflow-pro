'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarCheck, ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
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
  type WeeklyPlanSalesRequest,
} from '@/actions/weekly-plan-actions'
import { addDaysStr, currentProgress, dayIndexInWeek, formatThaiDay, formatWeekRange, mondayOf } from '@/lib/weekly-plan'
import { todayInBangkok } from '@/lib/utils'
import FreeItemEditor from './FreeItemEditor'
import SalesRequestPlanModal from './SalesRequestPlanModal'
import AddWorkSheet from './AddWorkSheet'

const REQUEST_STATUS_LABEL: Record<string, string> = { new: 'ใหม่', accepted: 'รับเรื่องแล้ว', in_progress: 'กำลังทำ' }

const KIND_CHIP: Partial<Record<WeeklyPlanItem['kind'], string>> = { repair: 'ซ่อม', dc: 'DC', inspect: 'ตรวจบ้าน', other: 'อื่นๆ' }

/** Free items made from a sales request carry its number in the title (see addSalesRequestToPlan). */
const isSalesRequestItem = (item: WeeklyPlanItem) => !item.jobAssignmentId && item.title.startsWith('คำขอ')

const salesRequestTitle = (requestNo: string | null, title: string) => `คำขอ ${requestNo || ''}: ${title}`.replace('คำขอ :', 'คำขอ:')

const plotSort = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true })

type Result = { ok: true } | { error: string }

/** Grid for one row: plot · job · crew · start % · % box · finish · menu. On phones it is two lines. */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto_auto_28px] [grid-template-areas:"nm_pc_fin_wm""cw_pc_fin_wm"] items-center gap-x-2 sm:grid-cols-[64px_minmax(0,1fr)_130px_70px_132px_64px_28px] sm:[grid-template-areas:none]'

/** One planned item as a single row. Note, rename and remove sit behind the ⋯ button. */
function JobRow({
  item,
  data,
  canCheck,
  editable,
  afterMeeting,
  busy,
  failRev,
  plotCell,
  dashed,
  onSavePct,
  onNote,
  onCrew,
  onDelete,
  onEditFree,
}: {
  item: WeeklyPlanItem
  data: WeeklyPlanData
  canCheck: boolean
  editable: boolean
  afterMeeting: boolean
  busy: boolean
  failRev: number
  /** Shown in the first column of the first job of a plot only */
  plotCell: ReactNode
  /** Dashed top border between jobs of the same plot */
  dashed: boolean
  onSavePct: (item: WeeklyPlanItem, v: number) => void
  onNote: (item: WeeklyPlanItem, note: string) => void
  onCrew: (item: WeeklyPlanItem, contractorId: string) => void
  onDelete: (item: WeeklyPlanItem) => void
  onEditFree: (item: WeeklyPlanItem) => void
}) {
  const server = item.status === 'done' ? 100 : currentProgress(item)
  const [localState, setLocal] = useState<{ base: number; v: number; rev: number } | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [picking, setPicking] = useState(false)
  const [noteText, setNoteText] = useState<string | null>(null)
  // What was just typed shows at once; it is dropped when the saved value changes or a save fails.
  const value = localState && localState.base === server && localState.rev === failRev ? localState.v : server
  const from = item.carryPct ?? 0
  const done = value >= 100
  const isJob = !!item.jobAssignmentId
  // A day was chosen when the item was planned (100% planned on that day only).
  const plannedDay = !isJob && item.planPct.filter((v) => v != null).length === 1 && item.planPct.indexOf(100) >= 0 ? item.planPct.indexOf(100) : null
  const kindChip = isSalesRequestItem(item) ? 'คำขอขาย' : isJob ? null : KIND_CHIP[item.kind]
  const gain = Math.round(value - from)

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
  const commitNote = () => {
    const t = noteText
    setNoteText(null)
    if (t != null && t.trim() !== (item.note ?? '')) onNote(item, t)
  }
  const disabledReason = canCheck ? undefined : 'ยังไม่ถึงสัปดาห์นี้ ใส่ % ได้ตั้งแต่วันจันทร์'

  return (
    <div className={`border-t py-1.5 ${dashed ? 'border-dashed border-slate-200' : 'border-slate-300'}`}>
      <div className={ROW_GRID}>
        <div className="hidden min-w-0 leading-tight sm:block">{plotCell}</div>

        <div className="min-w-0 [grid-area:nm] sm:[grid-area:auto]">
          <div className={`flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm ${done ? 'text-slate-500' : 'text-slate-800'}`}>
            <span className="min-w-0 break-words font-medium sm:truncate" title={item.title}>
              {item.title}
            </span>
            {kindChip && <span className="rounded-full bg-slate-100 px-1.5 py-0 text-[11px] text-slate-700">{kindChip}</span>}
            {afterMeeting && <span className="rounded-full bg-amber-50 px-1.5 py-0 text-[11px] text-amber-800">เพิ่มหลังประชุม</span>}
            {item.ownerName && <span className="text-xs text-slate-500">ดูแล: {item.ownerName}</span>}
            {plannedDay != null && <span className="text-xs text-slate-500">ทำ {formatThaiDay(addDaysStr(item.weekStart, plannedDay))}</span>}
            {item.note && <span className="min-w-0 truncate text-xs text-slate-500" title={item.note}>{item.note}</span>}
          </div>
        </div>

        <div className="relative min-w-0 [grid-area:cw] sm:[grid-area:auto]">
          <button
            type="button"
            disabled={!editable}
            onClick={() => setPicking((o) => !o)}
            aria-expanded={picking}
            className={`max-w-full truncate text-left text-xs sm:rounded-full sm:border sm:px-2.5 sm:py-0.5 ${
              item.contractorName ? 'text-slate-500 sm:border-slate-300 sm:text-slate-700 sm:hover:border-indigo-400' : 'text-amber-700 sm:border-dashed sm:border-amber-400'
            }`}
          >
            {item.contractorName || '+ ช่าง'}
          </button>
          {picking && (
            <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg">
              <button type="button" onClick={() => { setPicking(false); onCrew(item, '') }} className="block w-full rounded px-2 py-1.5 text-left text-slate-500 hover:bg-slate-50">
                ยังไม่เลือกช่าง
              </button>
              {data.contractors.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setPicking(false); onCrew(item, c.id) }}
                  className={`block w-full rounded px-2 py-1.5 text-left hover:bg-indigo-50 ${c.id === item.contractorId ? 'bg-indigo-50 font-medium' : ''}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="hidden text-right text-xs tabular-nums text-slate-500 sm:block">{isJob ? `${Math.round(from)}%` : ''}</div>

        <div className="flex items-center justify-end gap-1 [grid-area:pc] sm:[grid-area:auto]">
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
            aria-label={`ทำไปแล้วกี่ % ${item.title}`}
            className="w-14 rounded-md border border-slate-300 bg-white px-1.5 py-1 text-right text-sm tabular-nums disabled:bg-slate-50"
          />
          <span className="text-sm text-slate-500">%</span>
          <span className="hidden w-9 text-xs font-semibold tabular-nums text-emerald-700 sm:inline">{isJob && gain > 0 ? `+${gain}` : ''}</span>
        </div>

        <div className="[grid-area:fin] sm:[grid-area:auto]">
          <button
            type="button"
            disabled={!canCheck || busy}
            title={disabledReason}
            onClick={() => save(done ? from : 100)}
            className={`rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50 ${done ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
          >
            {done ? '✓ เสร็จ' : 'เสร็จ'}
          </button>
        </div>

        <div className="[grid-area:wm] sm:[grid-area:auto]">
          <button type="button" onClick={() => setMenu((o) => !o)} aria-expanded={menu} aria-label="เพิ่มเติม" className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {menu && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-1.5 text-xs sm:ml-16">
          {editable && noteText == null && (
            <button type="button" onClick={() => setNoteText(item.note ?? '')} className="font-medium text-indigo-600 hover:underline">
              {item.note ? 'แก้หมายเหตุ' : '+ หมายเหตุ'}
            </button>
          )}
          {noteText != null && (
            <input
              autoFocus
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onBlur={commitNote}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              placeholder="หมายเหตุ"
              aria-label="หมายเหตุ"
              className="min-w-0 flex-1 basis-48 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
            />
          )}
          {!isJob && editable && (
            <button type="button" onClick={() => { setMenu(false); onEditFree(item) }} className="font-medium text-indigo-600 hover:underline">
              แก้ชื่องาน
            </button>
          )}
          {editable ? (
            <button type="button" onClick={() => { setMenu(false); onDelete(item) }} className="font-medium text-red-600 hover:underline">
              เอาออกจากแผน
            </button>
          ) : (
            <span className="text-slate-500">แก้หรือเอาออกได้เฉพาะผู้สร้างหรือ PM</span>
          )}
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
  const [editing, setEditing] = useState<WeeklyPlanItem | null>(null)
  const [planningRequest, setPlanningRequest] = useState<WeeklyPlanSalesRequest | null>(null)
  const [adding, setAdding] = useState(false)
  const [failRev, setFailRev] = useState(0)
  const [deleting, setDeleting] = useState<WeeklyPlanItem[] | null>(null)

  const today = todayInBangkok()
  const currentWeek = mondayOf(today)
  const project = data.projects.find((p) => p.id === projectId)
  const canEdit = (item: WeeklyPlanItem) => canManage || item.createdBy === userId
  const meeting = data.meetings.find((m) => m.projectId === projectId && m.weekStart === weekStart)

  // Progress is written on today's column in the current week, the last column of a past week.
  const dayFor = (week: string) => dayIndexInWeek(week, today) ?? (week < today ? 6 : 0)
  const canCheck = weekStart <= today
  const nextWeek = addDaysStr(weekStart, 7)

  const salesRequests = data.salesRequests.filter((r) => r.projectId === projectId)
  const salesPlots = data.salesPlots.filter((p) => p.projectId === projectId)
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

  const salesStatusByPlot = new Map(salesPlots.map((p) => [p.plotId, p.statusLabel]))
  const groups = useMemo(() => {
    const map = new Map<string, { plotId: string | null; name: string | null; items: WeeklyPlanItem[] }>()
    for (const i of weekItems) {
      const key = i.plotId ?? ''
      const g = map.get(key) ?? { plotId: i.plotId, name: i.plotName, items: [] }
      g.items.push(i)
      map.set(key, g)
    }
    // BOQ jobs first within a plot; work with no plot goes last.
    for (const g of map.values()) g.items.sort((a, b) => Number(!!b.jobAssignmentId) - Number(!!a.jobAssignmentId))
    return [...map.values()].sort((a, b) => (a.name == null ? 1 : b.name == null ? -1 : plotSort(a.name, b.name)))
  }, [weekItems])
  const finished = weekItems.filter((i) => (i.status === 'done' ? 100 : currentProgress(i)) >= 100).length

  // Sales requests not yet planned this week wait in the box at the top.
  const waitingRequests = salesRequests.filter(
    (r) => !weekItems.some((i) => i.plotId === r.plotId && i.title === salesRequestTitle(r.requestNo, r.title))
  )
  const hasWaiting = carryOver.length > 0 || waitingRequests.length > 0

  const rowProps = {
    data,
    canCheck,
    busy: pending,
    failRev,
    onSavePct: savePct,
    onNote: (item: WeeklyPlanItem, note: string) => run(() => setWeeklyPlanItemNote(item.id, note.trim() || null)),
    onCrew: setCrew,
    onDelete: (item: WeeklyPlanItem) => setDeleting([item]),
    onEditFree: (item: WeeklyPlanItem) => setEditing(item),
  }

  const [waitOpen, setWaitOpen] = useState(false)
  const waitingCount = carryOver.length + waitingRequests.length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="mr-1 text-xl font-semibold text-slate-900">แผนงาน</h1>
        <select value={projectId} onChange={(e) => go(weekStart, e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm" aria-label="โครงการ">
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
          <span className="min-w-[9rem] text-center text-sm font-medium text-slate-700">
            {formatWeekRange(weekStart)}
            {weekStart === currentWeek && <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">สัปดาห์นี้</span>}
          </span>
          <Button variant="secondary" size="sm" onClick={() => go(nextWeek)} aria-label="สัปดาห์ถัดไป">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {weekItems.length > 0 && (
          <span className="text-sm text-slate-600">
            เสร็จ {finished}/{weekItems.length} งาน
          </span>
        )}
        <div className="ml-auto">
          <Button onClick={() => setAdding(true)} disabled={!project}>
            <Plus className="h-4 w-4" /> เพิ่มงาน
          </Button>
        </div>
      </div>

      {!canCheck && <p className="rounded-md bg-slate-100 px-3 py-1 text-xs text-slate-600">สัปดาห์หน้า: เพิ่มงานล่วงหน้าได้ · ใส่ % ได้ตั้งแต่วันจันทร์</p>}

      {hasWaiting && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 text-sm">
          <button type="button" onClick={() => setWaitOpen((o) => !o)} aria-expanded={waitOpen} className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left">
            <span>
              <b className="font-semibold text-slate-800">รอใส่แผน {waitingCount}</b>
              <span className="text-slate-600">
                {carryOver.length > 0 ? ` · ค้างจากสัปดาห์ก่อน ${carryOver.length}` : ''}
                {waitingRequests.length > 0 ? ` · ฝ่ายขายขอ ${waitingRequests.length}` : ''}
              </span>
            </span>
            <span className="shrink-0 text-xs text-indigo-600">ดู {waitOpen ? '▴' : '▾'}</span>
          </button>
          {waitOpen && (
            <div className="space-y-1.5 border-t border-amber-200 px-3 py-2">
              {carryOver.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-medium text-slate-800">ค้างจากสัปดาห์ก่อน {carryOver.length} งาน</span>
                    <span className="block text-xs text-slate-600">
                      {carryOver
                        .slice(0, 6)
                        .map((c) => `${c.plotName ? `แปลง ${c.plotName} ` : ''}${c.title} ${c.percent}%`)
                        .join(' · ')}
                      {carryOver.length > 6 ? ' ...' : ''}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
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
                    ยกมาทั้งหมด
                  </Button>
                </div>
              )}
              {waitingRequests.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-medium text-slate-800">ฝ่ายขายขอ: {r.title}</span>
                    <span className="block text-xs text-slate-600">
                      แปลง {r.plotName}
                      {r.requestNo ? ` · ${r.requestNo}` : ''}
                      {r.neededBy ? ` · ต้องการภายใน ${formatThaiDay(r.neededBy)}` : ''}
                      {` · ${REQUEST_STATUS_LABEL[r.status] || r.status}`}
                    </span>
                  </div>
                  <Button variant="secondary" size="sm" disabled={pending} onClick={() => setPlanningRequest(r)}>
                    + ใส่ในแผน
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {weekItems.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-600">
          <p className="font-medium text-slate-800">ยังไม่มีงานในสัปดาห์นี้</p>
          <p className="mt-1">กด &quot;เพิ่มงาน&quot; พิมพ์เลขแปลง แล้วติ๊กงานที่จะทำ</p>
        </Card>
      ) : (
        <Card className="p-3">
          <div className="hidden grid-cols-[64px_minmax(0,1fr)_130px_70px_132px_64px_28px] items-center gap-x-2 pb-1 text-xs text-slate-500 sm:grid">
            <span>แปลง</span>
            <span>งาน</span>
            <span>ช่าง</span>
            <span className="text-right">ต้นสัปดาห์</span>
            <span className="text-right">ทำไปแล้ว % (ทั้งงาน)</span>
            <span />
            <span />
          </div>
          {groups.map((g) => {
            const status = g.plotId ? salesStatusByPlot.get(g.plotId) : null
            return (
              <section key={g.plotId ?? 'none'}>
                <h3 className="pt-2 text-sm font-semibold text-slate-800 sm:hidden">
                  {g.name ? `แปลง ${g.name}` : 'ไม่ระบุแปลง'}
                  {status && <span className="ml-2 text-xs font-normal text-slate-500">{status}</span>}
                </h3>
                {g.items.map((item, idx) => (
                  <JobRow
                    key={item.id}
                    item={item}
                    editable={canEdit(item)}
                    afterMeeting={!!meeting && item.createdAt > meeting.agreedAt}
                    dashed={idx > 0}
                    plotCell={
                      idx === 0 ? (
                        <>
                          <span className="block text-sm font-semibold text-slate-800">{g.name ?? 'ไม่ระบุ'}</span>
                          {status && <span className="block text-[11px] text-slate-500">{status}</span>}
                        </>
                      ) : null
                    }
                    {...rowProps}
                  />
                ))}
              </section>
            )
          })}
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <button type="button" onClick={() => setAdding(true)} disabled={!project} className="font-medium text-indigo-600 hover:underline disabled:opacity-50">
          + เพิ่มงาน
        </button>
        <div className="flex flex-wrap items-center gap-2 text-slate-600">
          <CalendarCheck className={`h-4 w-4 shrink-0 ${meeting ? 'text-emerald-700' : 'text-slate-400'}`} aria-hidden />
          {meeting ? (
            <span>
              <b className="text-emerald-800">ตกลงแผนแล้ว</b>
              <span className="text-slate-500">
                {' '}
                {meeting.agreedByName ? `โดย ${meeting.agreedByName} · ` : ''}
                {new Date(meeting.agreedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} · เพิ่มหลังนี้จะมีป้าย &quot;เพิ่มหลังประชุม&quot;
              </span>
            </span>
          ) : (
            <span>PM: หลังประชุมกับช่าง</span>
          )}
          {canManage && project && (
            <>
              {meeting ? (
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => unagreeWeeklyPlan(projectId, weekStart), 'ยกเลิกการตกลงแผนแล้ว')}>
                  ยกเลิก
                </Button>
              ) : (
                <Button size="sm" disabled={pending} onClick={() => run(() => agreeWeeklyPlan(projectId, weekStart), 'บันทึกการตกลงแผนแล้ว')}>
                  ประชุมตกลงแผนแล้ว
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {editing && (
        <FreeItemEditor
          key={editing.id}
          data={data}
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            router.refresh()
          }}
        />
      )}

      {planningRequest && (
        <SalesRequestPlanModal
          key={planningRequest.id}
          data={data}
          request={planningRequest}
          weekStart={weekStart}
          today={today}
          onClose={() => setPlanningRequest(null)}
          onAdded={() => {
            setPlanningRequest(null)
            toast.success('เพิ่มเข้าแผนแล้ว')
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
            toast.success(`เพิ่มงาน ${n} รายการเข้าแผน`)
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
