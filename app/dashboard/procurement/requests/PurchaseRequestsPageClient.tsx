'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PackageCheck, Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import PurchaseRequestForm from '@/components/procurement/PurchaseRequestForm'
import PurchaseRequestDetail, {
  isPartiallyOrdered,
  partiallyOrderedHint,
} from '@/components/procurement/PurchaseRequestDetail'
import type { PurchaseRequest, PurchaseRequestStatus } from '@/lib/types/procurement'

const STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  pending_review: 'รอตรวจสอบ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ปฏิเสธ',
  ordered: 'สั่งซื้อแล้ว',
  received: 'รับของครบ',
  cancelled: 'ยกเลิก',
}

const STATUS_TONE: Record<PurchaseRequestStatus, string> = {
  pending_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-indigo-50 text-indigo-700',
  rejected: 'bg-red-50 text-red-700',
  ordered: 'bg-violet-50 text-violet-700',
  received: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
}

/** First material line plus a count of how many more, for a quick "what's
 * in this request" glance without opening it - same convention as the PO
 * list's materialSummary(). */
function materialSummary(request: PurchaseRequest): { label: string; extra: number } {
  const items = request.purchase_request_items || []
  if (items.length === 0) return { label: '-', extra: 0 }
  return { label: items[0].material_types?.name || '-', extra: items.length - 1 }
}

const FILTERS: { key: PurchaseRequestStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'pending_review', label: 'รอตรวจสอบ' },
  { key: 'approved', label: 'อนุมัติแล้ว' },
  { key: 'ordered', label: 'สั่งซื้อแล้ว' },
  { key: 'received', label: 'รับของครบ' },
  { key: 'rejected', label: 'ปฏิเสธ' },
]

export default function PurchaseRequestsPageClient({
  requests,
  initialError,
}: {
  requests: PurchaseRequest[]
  initialError?: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [filter, setFilter] = useState<PurchaseRequestStatus | 'all'>('all')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  // Looked up from `requests` (not the status-filtered `filtered` list) so
  // an approve/reject inside the modal that moves the request out of the
  // current filter doesn't yank the modal's content out from under it.
  const selectedRequest = requests.find((r) => r.id === selectedRequestId) ?? null

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  const filtered = useMemo(
    () => (filter === 'all' ? requests : requests.filter((r) => r.status === filter)),
    [requests, filter]
  )

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="คำขอซื้อ (Purchase Requests)"
        subtitle="คำขอซื้อที่ส่งเข้ามา รอตรวจสอบและอนุมัติก่อนออกใบสั่งซื้อ"
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus className="h-4 w-4" /> สร้างคำขอซื้อ
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
              filter === f.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">เลขที่</th>
                <th className="px-4 py-3 font-semibold">โครงการ</th>
                <th className="px-4 py-3 font-semibold">ผู้ขอซื้อ</th>
                <th className="px-4 py-3 font-semibold">รายการ</th>
                <th className="px-4 py-3 font-semibold">สถานะ</th>
                <th className="px-4 py-3 font-semibold">วันที่</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center italic text-slate-400">
                    ไม่มีคำขอซื้อในสถานะนี้
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer transition-colors hover:bg-slate-50"
                    onClick={() => setSelectedRequestId(r.id)}
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono font-medium text-indigo-600 hover:underline">
                        #{String(r.pr_no).padStart(4, '0')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{r.projects?.name || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{r.requester?.full_name || r.requester?.email || '-'}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-slate-700">
                      {(() => {
                        const { label, extra } = materialSummary(r)
                        return (
                          <>
                            {label}
                            {extra > 0 && <span className="text-slate-400"> +{extra}</span>}
                          </>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      {isPartiallyOrdered(r) && (
                        <span
                          className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                          title={partiallyOrderedHint(r)}
                        >
                          <PackageCheck className="h-3 w-3" /> สั่งบางส่วนแล้ว
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{new Date(r.created_at).toLocaleDateString('th-TH')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="สร้างคำขอซื้อ" panelClassName="max-w-2xl">
        <PurchaseRequestForm
          mode="create"
          onCancel={() => setIsModalOpen(false)}
          onSaved={() => {
            setIsModalOpen(false)
            router.refresh()
          }}
        />
      </Modal>

      <Modal
        isOpen={selectedRequest != null}
        onClose={() => setSelectedRequestId(null)}
        title={selectedRequest ? `คำขอซื้อ #${String(selectedRequest.pr_no).padStart(4, '0')}` : undefined}
        panelClassName="max-w-3xl"
      >
        {selectedRequest && <PurchaseRequestDetail request={selectedRequest} onChanged={() => router.refresh()} />}
      </Modal>
    </div>
  )
}
