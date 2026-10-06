'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Check, Loader2, Search, X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import ReasonDialog from '@/components/ui/ReasonDialog'
import CommissionSettingsCard from '@/components/sales/CommissionSettingsCard'
import { formatCurrency } from '@/lib/currency'
import { TR_STATUS_LABEL, TR_STATUS_TONE } from '@/lib/sales/transferRequestLabels'
import {
  setTransferRequestStatus,
  type TransferRequestRow,
  type TransferRequestStatus,
} from '@/actions/transfer-requests'
import type { ProjectCommission } from '@/actions/commission-actions'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function TransferRequestsPageClient({
  initialRows,
  canApprove,
  commissionProjects,
  canManageCommission,
  initialError,
}: {
  initialRows: TransferRequestRow[]
  canApprove: boolean
  commissionProjects: ProjectCommission[]
  canManageCommission: boolean
  initialError?: string | null
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [rows, setRows] = useState(initialRows)
  const [statusFilter, setStatusFilter] = useState<'open' | 'all' | TransferRequestStatus>('open')
  const [search, setSearch] = useState('')
  const [rejectTarget, setRejectTarget] = useState<TransferRequestRow | null>(null)

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter === 'open' && !['draft', 'submitted', 'approved'].includes(r.status)) return false
      if (statusFilter !== 'open' && statusFilter !== 'all' && r.status !== statusFilter) return false
      if (q && !`${r.requestNo || ''} ${r.plotName} ${r.customerName || ''} ${r.projectName}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, statusFilter, search])

  function transition(row: TransferRequestRow, status: TransferRequestStatus, reason?: string) {
    startTransition(async () => {
      const res = await setTransferRequestStatus(row.id, status, reason)
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, status, rejectReason: status === 'rejected' ? reason || null : r.rejectReason }
            : r
        )
      )
      toast.success(`อัปเดตใบขอโอน ${row.requestNo || ''} แล้ว`)
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader title="ใบขอโอน (TR)" subtitle="ใบขอโอนของแต่ละแปลง: ส่งขออนุมัติ แล้วหัวหน้าฝ่ายขายอนุมัติ จากนั้นบันทึกเมื่อโอนเสร็จ" />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[160px]">
          <label className="mb-1 block text-xs font-medium text-slate-500">สถานะ</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="w-full">
            <option value="open">ยังไม่เสร็จ (ค่าเริ่มต้น)</option>
            <option value="all">ทั้งหมด</option>
            {(Object.keys(TR_STATUS_LABEL) as TransferRequestStatus[]).map((s) => (
              <option key={s} value={s}>{TR_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[220px]">
          <label className="mb-1 block text-xs font-medium text-slate-500">ค้นหา</label>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9" placeholder="เลขที่ / แปลง / ลูกค้า" />
          </div>
        </div>
        <span className="ml-auto pb-2 text-xs text-slate-400">{filtered.length} รายการ</span>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">เลขที่</th>
                <th className="px-4 py-3 font-semibold">แปลง / ลูกค้า</th>
                <th className="px-4 py-3 text-right font-semibold">ราคา</th>
                <th className="px-4 py-3 text-right font-semibold">ส่วนลด</th>
                <th className="px-4 py-3 text-right font-semibold">โปรโมชั่น</th>
                <th className="px-4 py-3 text-right font-semibold">ค่าคอม</th>
                <th className="px-4 py-3 font-semibold">สถานะ</th>
                <th className="px-4 py-3 font-semibold">ส่งเมื่อ</th>
                {canApprove && <th className="w-[180px] px-4 py-3 font-semibold">การดำเนินการ</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{row.requestNo}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/projects/${row.projectId}/${row.plotId}`}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      {row.plotName}
                    </Link>
                    <div className="text-xs text-slate-400">{row.projectName}{row.customerName ? ` · ${row.customerName}` : ''}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.price)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.discount)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.promotionTotal)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.commissionAmount)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={TR_STATUS_TONE[row.status]}>{TR_STATUS_LABEL[row.status]}</Badge>
                    {row.status === 'rejected' && row.rejectReason && (
                      <div className="mt-0.5 text-[11px] text-slate-400">{row.rejectReason}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(row.submittedAt)}</td>
                  {canApprove && (
                    <td className="px-4 py-3">
                      {row.status === 'submitted' && (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => transition(row, 'approved')}
                            disabled={isPending}
                            className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            <Check className="inline h-3 w-3" /> อนุมัติ
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectTarget(row)}
                            disabled={isPending}
                            className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60"
                          >
                            <X className="inline h-3 w-3" /> ไม่อนุมัติ
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-slate-400">
              ไม่มีใบขอโอนตามตัวกรองนี้ สร้างใบขอโอนได้ที่แท็บ &quot;การขาย&quot; ของแต่ละแปลง
            </div>
          )}
        </div>
      </Card>

      {isPending && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังบันทึก...
        </div>
      )}

      <CommissionSettingsCard initialProjects={commissionProjects} canManage={canManageCommission} />

      <ReasonDialog
        isOpen={rejectTarget !== null}
        title="ไม่อนุมัติใบขอโอน"
        label="เหตุผลที่ไม่อนุมัติ"
        required
        confirmLabel="ไม่อนุมัติ"
        busy={isPending}
        onCancel={() => setRejectTarget(null)}
        onConfirm={(reason) => {
          const row = rejectTarget
          setRejectTarget(null)
          if (row) transition(row, 'rejected', reason)
        }}
      />
    </div>
  )
}
