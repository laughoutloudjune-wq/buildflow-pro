'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import WorkRequestFormModal from '@/components/sales/WorkRequestFormModal'
import { WORK_REQUEST_CATEGORY_LABEL as CATEGORY_LABEL } from '@/lib/sales/workRequestCategories'
import type { WorkRequestRow } from '@/actions/sales-work-requests'
import { EmptyState } from '@/components/ui/EmptyState'

const STATUS_LABEL: Record<string, string> = {
  pending_approval: 'รออนุมัติ (ฝ่ายขาย)',
  new: 'ใหม่',
  accepted: 'รับเรื่องแล้ว',
  in_progress: 'กำลังทำ',
  done: 'เสร็จสิ้น',
  rejected: 'ปฏิเสธ',
}
const STATUS_TONE: Record<string, 'neutral' | 'warning' | 'success' | 'danger' | 'info'> = {
  pending_approval: 'neutral',
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
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [localRequests, setLocalRequests] = useState(requests)

  // The queue page is the source of truth for live status; this local append
  // just avoids the tab looking empty until the next full reload.
  function handleCreated(formData: FormData) {
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
        status: 'pending_approval',
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
        rejectedAtApproval: false,
      },
      ...prev,
    ])
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
        <Card><EmptyState title="ยังไม่มีคำขอจากฝ่ายขายสำหรับแปลงนี้" /></Card>
      ) : (
        <div className="space-y-3">
          {localRequests.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-800">{r.title}</div>
                  <div className="text-xs text-slate-500">
                    {CATEGORY_LABEL[r.category] || r.category}
                    {r.requestNo && ` · ${r.requestNo}`}
                  </div>
                </div>
                <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
              </div>
              {r.detail && <p className="mt-2 text-sm text-slate-600">{r.detail}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
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

      <p className="text-xs text-slate-500">
        ดูและจัดการคำขอทั้งหมดของทุกแปลงได้ที่ <Link href="/dashboard/sales-requests" className="text-indigo-600 hover:underline">คำขอจากฝ่ายขาย</Link>
      </p>

      <WorkRequestFormModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        plotId={plotId}
        onCreated={handleCreated}
      />
    </div>
  )
}
