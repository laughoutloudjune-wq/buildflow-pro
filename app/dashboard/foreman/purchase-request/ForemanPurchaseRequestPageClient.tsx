'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import PurchaseRequestForm from '@/components/procurement/PurchaseRequestForm'
import { createForemanPurchaseRequest, type ForemanPurchaseRequestRow } from '@/actions/foreman-purchase-requests'

const STATUS_LABEL: Record<string, string> = {
  pending_review: 'รอตรวจสอบ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
  ordered: 'สั่งซื้อแล้ว',
  received: 'รับของแล้ว',
  cancelled: 'ยกเลิก',
}

const STATUS_TONE: Record<string, string> = {
  pending_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-indigo-50 text-indigo-700',
  rejected: 'bg-red-50 text-red-700',
  ordered: 'bg-violet-50 text-violet-700',
  received: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
}

export default function ForemanPurchaseRequestPageClient({
  initialRequests,
  initialError,
}: {
  initialRequests: ForemanPurchaseRequestRow[]
  initialError?: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [isModalOpen, setIsModalOpen] = useState(false)

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  const getScopeLabel = (r: ForemanPurchaseRequestRow) => {
    if (r.plot_name) return `แปลง ${r.plot_name}`
    if (r.plot_group_name) return `กลุ่ม ${r.plot_group_name}`
    return r.project_name || '-'
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="ขอซื้อวัสดุ"
        subtitle="ส่งคำขอซื้อวัสดุให้ฝ่ายจัดซื้อดำเนินการ"
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus className="h-4 w-4" /> สร้างคำขอซื้อวัสดุ
          </Button>
        }
      />

      <Card className="p-4 bg-slate-50/60 border-slate-200">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">คำขอของฉัน</h2>
        {initialRequests.length === 0 ? (
          <div className="p-8 text-center text-slate-400">ยังไม่มีคำขอซื้อวัสดุ</div>
        ) : (
          <div className="space-y-3">
            {initialRequests.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md text-xs">
                        #{r.pr_no != null ? String(r.pr_no).padStart(4, '0') : '-'}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[r.status] || 'bg-slate-100 text-slate-500'}`}>
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{getScopeLabel(r)}</p>
                    {r.needed_by_date && (
                      <p className="text-xs text-slate-400">ต้องการภายใน {new Date(r.needed_by_date).toLocaleDateString('th-TH')}</p>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{new Date(r.created_at).toLocaleDateString('th-TH')}</p>
                </div>

                <div className="mt-2 space-y-0.5 text-sm text-slate-700">
                  {r.items.map((item, idx) => (
                    <div key={idx}>
                      {item.material_name} — {item.quantity_requested.toLocaleString('th-TH')} {item.unit || ''}
                    </div>
                  ))}
                </div>

                {r.status === 'rejected' && r.review_note && (
                  <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    เหตุผลที่ไม่อนุมัติ: {r.review_note}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="สร้างคำขอซื้อวัสดุ" panelClassName="max-w-2xl">
        <PurchaseRequestForm
          mode="create"
          createAction={createForemanPurchaseRequest}
          onCancel={() => setIsModalOpen(false)}
          onSaved={() => {
            setIsModalOpen(false)
            toast.success('ส่งคำขอซื้อวัสดุเรียบร้อยแล้ว')
            router.refresh()
          }}
        />
      </Modal>
    </div>
  )
}
