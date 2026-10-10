'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { type ForemanPurchaseRequestRow } from '@/actions/foreman-purchase-requests'

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
    <PageContainer width="standard">
      <PageHeader
        title="ขอซื้อวัสดุ"
        subtitle="ส่งคำขอซื้อวัสดุให้ฝ่ายจัดซื้อดำเนินการ"
        actions={
          <Button onClick={() => router.push('/dashboard/foreman/purchase-request/create')}>
            <Plus className="h-4 w-4" /> สร้างคำขอซื้อวัสดุ
          </Button>
        }
      />

      <Card className="p-4 bg-slate-50/60 border-slate-200">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">คำขอของฉัน</h2>
        {initialRequests.length === 0 ? (
          <EmptyState title="ยังไม่มีคำขอซื้อวัสดุ" description={'กด "สร้างคำขอซื้อวัสดุ" เพื่อส่งคำขอให้ฝ่ายจัดซื้อ'} />
        ) : (
          <div className="space-y-3">
            {initialRequests.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-700">
                        #{r.pr_no != null ? String(r.pr_no).padStart(4, '0') : '-'}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[r.status] || 'bg-slate-100 text-slate-500'}`}>
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
                      {/* What happens next, in words. */}
                      <span className="text-xs text-slate-500">
                        {({
                          pending_review: 'รอฝ่ายจัดซื้อตรวจสอบ',
                          approved: 'อนุมัติแล้ว รอสั่งซื้อ',
                          ordered: 'สั่งซื้อแล้ว รอของส่ง',
                          received: 'ได้รับของแล้ว',
                          rejected: 'ไม่อนุมัติ — สร้างคำขอใหม่ได้',
                          cancelled: 'ยกเลิกแล้ว',
                        } as Record<string, string>)[r.status] || ''}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{getScopeLabel(r)}</p>
                    {r.needed_by_date && (
                      <p className="text-xs text-slate-500">ต้องการภายใน {new Date(r.needed_by_date).toLocaleDateString('th-TH')}</p>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{new Date(r.created_at).toLocaleDateString('th-TH')}</p>
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

    </PageContainer>
  )
}
