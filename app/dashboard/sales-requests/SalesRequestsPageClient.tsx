'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { AlertTriangle, Check, Link2, Loader2, User, X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import {
  assignWorkRequestContractor,
  getUnlinkedDcBillingsForPlot,
  linkWorkRequestBilling,
  setWorkRequestStatus,
  type WorkRequestRow,
  type WorkRequestStatus,
} from '@/actions/sales-work-requests'

const CATEGORY_LABEL: Record<string, string> = {
  extra_work: 'งานเพิ่มลูกค้า',
  defect: 'แก้ Defect',
  expedite: 'เร่งงาน',
  handover_prep: 'เตรียมส่งมอบ',
  other: 'อื่นๆ',
}
const PRIORITY_LABEL: Record<string, string> = { low: 'ต่ำ', normal: 'ปกติ', urgent: 'ด่วน' }
const PRIORITY_TONE: Record<string, 'neutral' | 'warning' | 'danger'> = { low: 'neutral', normal: 'neutral', urgent: 'danger' }
const STATUS_LABEL: Record<WorkRequestStatus, string> = {
  new: 'ใหม่',
  accepted: 'รับเรื่องแล้ว',
  in_progress: 'กำลังทำ',
  done: 'เสร็จสิ้น',
  rejected: 'ปฏิเสธ',
}
const STATUS_TONE: Record<WorkRequestStatus, 'neutral' | 'warning' | 'success' | 'danger' | 'info'> = {
  new: 'info',
  accepted: 'warning',
  in_progress: 'warning',
  done: 'success',
  rejected: 'danger',
}

function daysOpen(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24))
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

function isOverdue(row: WorkRequestRow): boolean {
  if (!row.neededBy) return false
  if (row.status === 'done' || row.status === 'rejected') return false
  return new Date(row.neededBy).getTime() < Date.now()
}

export default function SalesRequestsPageClient({
  initialRequests,
  contractors,
  projects,
  canManage,
  initialError,
}: {
  initialRequests: WorkRequestRow[]
  contractors: { id: string; name: string }[]
  projects: { id: string; name: string }[]
  canManage: boolean
  initialError?: string | null
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [requests, setRequests] = useState(initialRequests)
  const [statusFilter, setStatusFilter] = useState<'open' | WorkRequestStatus>('open')
  const [projectFilter, setProjectFilter] = useState('')
  const [dcOptionsFor, setDcOptionsFor] = useState<string | null>(null)
  const [dcOptions, setDcOptions] = useState<{ id: string; docNo: number | string | null; billingDate: string | null; netAmount: number | null }[]>([])

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter === 'open' ? !['new', 'accepted', 'in_progress'].includes(r.status) : r.status !== statusFilter) return false
      if (projectFilter && r.projectId !== projectFilter) return false
      return true
    })
  }, [requests, statusFilter, projectFilter])

  function applyLocal(id: string, patch: Partial<WorkRequestRow>) {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function handleSetStatus(row: WorkRequestRow, status: 'accepted' | 'in_progress' | 'done' | 'rejected') {
    let reason: string | undefined
    if (status === 'rejected') {
      reason = window.prompt('เหตุผลที่ปฏิเสธ:') || ''
      if (!reason.trim()) {
        toast.error('กรุณาระบุเหตุผล')
        return
      }
    }
    startTransition(async () => {
      const res = await setWorkRequestStatus(row.id, status, reason)
      if (!res.success) {
        toast.error(res.error || 'บันทึกไม่สำเร็จ')
        return
      }
      applyLocal(row.id, {
        status,
        rejectReason: status === 'rejected' ? reason || null : row.rejectReason,
        completedAt: status === 'done' ? new Date().toISOString() : row.completedAt,
      })
      toast.success(`อัปเดตคำขอ ${row.requestNo || ''} แล้ว`)
    })
  }

  function handleAssignContractor(row: WorkRequestRow, contractorId: string) {
    applyLocal(row.id, {
      assignedContractorId: contractorId || null,
      assignedContractorName: contractors.find((c) => c.id === contractorId)?.name || null,
    })
    startTransition(async () => {
      const res = await assignWorkRequestContractor(row.id, contractorId || null)
      if (!res.success) toast.error(res.error || 'มอบหมายไม่สำเร็จ')
    })
  }

  async function handleOpenDcPicker(row: WorkRequestRow) {
    setDcOptionsFor(row.id)
    setDcOptions([])
    try {
      setDcOptions(await getUnlinkedDcBillingsForPlot(row.plotId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดรายการ DC ไม่สำเร็จ')
    }
  }

  function handleLinkDc(row: WorkRequestRow, billingId: string) {
    applyLocal(row.id, { billingId })
    setDcOptionsFor(null)
    startTransition(async () => {
      const res = await linkWorkRequestBilling(row.id, billingId)
      if (!res.success) toast.error(res.error || 'ผูก DC ไม่สำเร็จ')
      else toast.success('ผูกกับใบ DC แล้ว')
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader title="คำขอจากฝ่ายขาย" subtitle="คำขอจากฝ่ายขายที่รอหน่วยงานก่อสร้างดำเนินการ" />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[160px]">
          <label className="mb-1 block text-xs font-medium text-slate-500">สถานะ</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="w-full">
            <option value="open">ยังไม่เสร็จ (ค่าเริ่มต้น)</option>
            {(Object.keys(STATUS_LABEL) as WorkRequestStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[200px]">
          <label className="mb-1 block text-xs font-medium text-slate-500">โครงการ</label>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="w-full">
            <option value="">ทั้งหมด</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <span className="ml-auto pb-2 text-xs text-slate-400">{filtered.length} รายการ</span>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">แปลง</th>
                <th className="px-4 py-3 font-semibold">เรื่อง</th>
                <th className="px-4 py-3 font-semibold">ประเภท</th>
                <th className="px-4 py-3 font-semibold">ความสำคัญ</th>
                <th className="px-4 py-3 font-semibold">ต้องเสร็จก่อน</th>
                <th className="px-4 py-3 font-semibold text-right">เปิดมา</th>
                <th className="px-4 py-3 font-semibold">ผู้แจ้ง</th>
                <th className="px-4 py-3 font-semibold">สถานะ</th>
                {canManage && <th className="px-4 py-3 font-semibold">ผู้รับเหมา</th>}
                {canManage && <th className="px-4 py-3 font-semibold w-[220px]">การดำเนินการ</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.map((row) => {
                const overdue = isOverdue(row)
                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{row.plotName}</div>
                      <div className="text-xs text-slate-400">{row.projectName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{row.title}</div>
                      {row.detail && <div className="max-w-[220px] truncate text-xs text-slate-400" title={row.detail}>{row.detail}</div>}
                      {row.requestNo && <div className="text-[11px] text-slate-400">{row.requestNo}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{CATEGORY_LABEL[row.category] || row.category}</td>
                    <td className="px-4 py-3">
                      <Badge tone={PRIORITY_TONE[row.priority]}>{PRIORITY_LABEL[row.priority] || row.priority}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className={overdue ? 'flex items-center gap-1 font-medium text-red-600' : 'text-slate-600'}>
                        {overdue && <AlertTriangle className="h-3.5 w-3.5" />}
                        {formatDate(row.neededBy)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">{daysOpen(row.createdAt)} วัน</td>
                    <td className="px-4 py-3 text-slate-600">{row.requestedByName || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                      {row.status === 'rejected' && row.rejectReason && (
                        <div className="mt-0.5 text-[11px] text-slate-400">{row.rejectReason}</div>
                      )}
                      {row.billingId && (
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-600">
                          <Link2 className="h-3 w-3" /> ผูกกับ DC แล้ว
                        </div>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="relative">
                          <User className="absolute left-2 top-2.5 h-3 w-3 text-slate-400" />
                          <select
                            value={row.assignedContractorId || ''}
                            onChange={(e) => handleAssignContractor(row, e.target.value)}
                            disabled={isPending}
                            className="w-full pl-7 pr-2 py-1.5 rounded border border-slate-200 text-xs"
                          >
                            <option value="">-- ว่าง --</option>
                            {contractors.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                    )}
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {row.status === 'new' && (
                            <button
                              type="button"
                              onClick={() => handleSetStatus(row, 'accepted')}
                              disabled={isPending}
                              className="rounded-lg bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                            >
                              รับเรื่อง
                            </button>
                          )}
                          {(row.status === 'new' || row.status === 'accepted') && (
                            <button
                              type="button"
                              onClick={() => handleSetStatus(row, 'in_progress')}
                              disabled={isPending}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                            >
                              กำลังทำ
                            </button>
                          )}
                          {row.status !== 'done' && row.status !== 'rejected' && (
                            <button
                              type="button"
                              onClick={() => handleSetStatus(row, 'done')}
                              disabled={isPending}
                              className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                            >
                              <Check className="inline h-3 w-3" /> เสร็จ
                            </button>
                          )}
                          {row.status !== 'done' && row.status !== 'rejected' && (
                            <button
                              type="button"
                              onClick={() => handleSetStatus(row, 'rejected')}
                              disabled={isPending}
                              className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60"
                            >
                              <X className="inline h-3 w-3" /> ปฏิเสธ
                            </button>
                          )}
                          {row.category === 'extra_work' && !row.billingId && (
                            <button
                              type="button"
                              onClick={() => handleOpenDcPicker(row)}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                            >
                              <Link2 className="inline h-3 w-3" /> ผูก DC
                            </button>
                          )}
                        </div>
                        {dcOptionsFor === row.id && (
                          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-[11px] font-medium text-slate-500">เลือกใบ DC ของแปลงนี้</span>
                              <button type="button" onClick={() => setDcOptionsFor(null)} className="text-slate-400 hover:text-slate-600">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                            {dcOptions.length === 0 ? (
                              <p className="text-[11px] text-slate-400">
                                ไม่พบใบ DC ที่ยังไม่ได้ผูก — ออกใบ DC ที่หน้า
                                <a href="/dashboard/foreman/create-dc" className="ml-1 text-indigo-600 hover:underline">สร้างงานเพิ่ม/DC</a>
                                แล้วกลับมาผูกที่นี่
                              </p>
                            ) : (
                              <div className="space-y-1">
                                {dcOptions.map((dc) => (
                                  <button
                                    key={dc.id}
                                    type="button"
                                    onClick={() => handleLinkDc(row, dc.id)}
                                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] hover:bg-white"
                                  >
                                    <span>#{dc.docNo ?? '-'} · {formatDate(dc.billingDate)}</span>
                                    <span className="font-medium">{dc.netAmount != null ? dc.netAmount.toLocaleString('th-TH') : '-'}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="py-12 text-center text-slate-400">ไม่มีคำขอตามตัวกรองนี้</div>}
        </div>
      </Card>
      {isPending && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังบันทึก...
        </div>
      )}
    </div>
  )
}
