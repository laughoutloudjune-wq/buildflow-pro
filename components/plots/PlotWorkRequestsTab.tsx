'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { AlertTriangle, Loader2, Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { createWorkRequest, type WorkRequestRow } from '@/actions/sales-work-requests'

const CATEGORY_LABEL: Record<string, string> = {
  extra_work: 'งานเพิ่มลูกค้า',
  defect: 'แก้ Defect',
  expedite: 'เร่งงาน',
  handover_prep: 'เตรียมส่งมอบ',
  other: 'อื่นๆ',
}
const STATUS_LABEL: Record<string, string> = {
  new: 'ใหม่',
  accepted: 'รับเรื่องแล้ว',
  in_progress: 'กำลังทำ',
  done: 'เสร็จสิ้น',
  rejected: 'ปฏิเสธ',
}
const STATUS_TONE: Record<string, 'neutral' | 'warning' | 'success' | 'danger' | 'info'> = {
  new: 'info',
  accepted: 'warning',
  in_progress: 'warning',
  done: 'success',
  rejected: 'danger',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function PlotWorkRequestsTab({
  plotId,
  requests,
  canCreate,
}: {
  plotId: string
  requests: WorkRequestRow[]
  canCreate: boolean
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [localRequests, setLocalRequests] = useState(requests)

  function handleCreate(formData: FormData) {
    formData.set('plot_id', plotId)
    startTransition(async () => {
      const res = await createWorkRequest(formData)
      if (!res.success) {
        toast.error(res.error || 'ส่งคำขอไม่สำเร็จ')
        return
      }
      toast.success('ส่งคำขอแล้ว จะปรากฏในคิวของหน่วยงานก่อสร้าง')
      setIsCreateOpen(false)
      // The queue page is the source of truth for live status; this local
      // append just avoids the tab looking empty until the next full reload.
      setLocalRequests((prev) => [
        {
          id: `pending-${Date.now()}`,
          requestNo: null,
          plotId,
          plotName: '',
          projectId: '',
          projectName: '',
          category: String(formData.get('category') || 'other') as WorkRequestRow['category'],
          title: String(formData.get('title') || ''),
          detail: String(formData.get('detail') || '') || null,
          photoUrls: [],
          priority: String(formData.get('priority') || 'normal') as WorkRequestRow['priority'],
          neededBy: String(formData.get('needed_by') || '') || null,
          status: 'new',
          chargeTo: null,
          quotedAmount: null,
          assignedContractorId: null,
          assignedContractorName: null,
          billingId: null,
          requestedByName: null,
          acceptedByName: null,
          rejectReason: null,
          completedAt: null,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ])
    })
  }

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4" /> แจ้งคำขอใหม่
          </Button>
        </div>
      )}

      {localRequests.length === 0 ? (
        <Card className="p-8 text-center text-slate-400">ยังไม่มีคำขอจากฝ่ายขายสำหรับแปลงนี้</Card>
      ) : (
        <div className="space-y-3">
          {localRequests.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-800">{r.title}</div>
                  <div className="text-xs text-slate-400">
                    {CATEGORY_LABEL[r.category] || r.category}
                    {r.requestNo && ` · ${r.requestNo}`}
                  </div>
                </div>
                <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
              </div>
              {r.detail && <p className="mt-2 text-sm text-slate-600">{r.detail}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                {r.neededBy && (
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> ต้องเสร็จก่อน {formatDate(r.neededBy)}
                  </span>
                )}
                {r.assignedContractorName && <span>ผู้รับเหมา: {r.assignedContractorName}</span>}
                {r.requestedByName && <span>แจ้งโดย {r.requestedByName}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400">
        ดูและจัดการคำขอทั้งหมดของทุกแปลงได้ที่ <Link href="/dashboard/sales-requests" className="text-indigo-600 hover:underline">คำขอจากฝ่ายขาย</Link>
      </p>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="แจ้งคำขอใหม่">
        <form action={handleCreate} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">เรื่อง</label>
            <input name="title" required className="w-full" placeholder="เช่น ลูกค้าขอเพิ่มปลั๊ก 4 จุด" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ประเภท</label>
              <select name="category" required defaultValue="extra_work" className="w-full">
                {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ความสำคัญ</label>
              <select name="priority" defaultValue="normal" className="w-full">
                <option value="low">ต่ำ</option>
                <option value="normal">ปกติ</option>
                <option value="urgent">ด่วน</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">รายละเอียด</label>
            <textarea name="detail" rows={3} className="w-full" placeholder="รายละเอียดเพิ่มเติม" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ต้องเสร็จก่อนวันที่</label>
              <input type="date" name="needed_by" className="w-full" />
              <p className="mt-1 text-[11px] text-slate-400">เว้นว่างได้ - จะใช้วันนัดตรวจบ้านของดีลนี้แทน</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ผู้รับผิดชอบค่าใช้จ่าย</label>
              <select name="charge_to" defaultValue="" className="w-full">
                <option value="">ยังไม่ระบุ</option>
                <option value="customer">ลูกค้า</option>
                <option value="company">บริษัท</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ราคาประเมิน (ถ้ามี)</label>
            <input type="number" min="0" step="0.01" name="quoted_amount" className="w-full sm:w-48" />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setIsCreateOpen(false)}>ยกเลิก</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              ส่งคำขอ
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
