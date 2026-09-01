'use client'

import { useEffect, useState, useTransition, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, ShoppingCart } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { approvePurchaseRequest, getPurchaseRequestById, rejectPurchaseRequest } from '@/actions/procurement-actions'
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

export default function PurchaseRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [request, setRequest] = useState<PurchaseRequest | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const toast = useToast()
  const [rejectNote, setRejectNote] = useState('')
  const [showRejectBox, setShowRejectBox] = useState(false)

  useEffect(() => {
    void load()
  }, [id])

  async function load() {
    setIsLoading(true)
    try {
      setRequest(await getPurchaseRequestById(id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดคำขอซื้อไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  function handleApprove() {
    startTransition(async () => {
      try {
        await approvePurchaseRequest(id)
        await load()
        toast.success('อนุมัติคำขอซื้อเรียบร้อยแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'อนุมัติไม่สำเร็จ')
      }
    })
  }

  function handleReject() {
    startTransition(async () => {
      try {
        await rejectPurchaseRequest(id, rejectNote)
        setShowRejectBox(false)
        await load()
        toast.success('ปฏิเสธคำขอซื้อแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ปฏิเสธไม่สำเร็จ')
      }
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดคำขอซื้อ...</p>
      </div>
    )
  }

  if (!request) {
    return <div className="py-16 text-center text-slate-400">ไม่พบคำขอซื้อนี้</div>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/dashboard/procurement/requests"
          className="mb-2 flex w-fit items-center gap-1 text-sm text-slate-500 transition hover:text-indigo-600"
        >
          <ArrowLeft className="h-4 w-4" /> กลับไปรายการคำขอซื้อ
        </Link>
        <PageHeader
          title={`คำขอซื้อ #${String(request.pr_no).padStart(4, '0')}`}
          subtitle={`${request.projects?.name || '-'}${request.plots?.name ? ' • แปลง ' + request.plots.name : ''}`}
          actions={
            <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_TONE[request.status]}`}>
              {STATUS_LABEL[request.status]}
            </span>
          }
        />
      </div>


      <Card className="p-5">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-slate-400">ผู้ขอซื้อ</div>
            <div className="font-medium text-slate-800">{request.requester?.full_name || request.requester?.email || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">ต้องการภายในวันที่</div>
            <div className="font-medium text-slate-800">
              {request.needed_by_date ? new Date(request.needed_by_date).toLocaleDateString('th-TH') : '-'}
            </div>
          </div>
          {request.note && (
            <div className="col-span-2">
              <div className="text-xs text-slate-400">หมายเหตุ</div>
              <div className="text-slate-700">{request.note}</div>
            </div>
          )}
          {request.review_note && (
            <div className="col-span-2">
              <div className="text-xs text-slate-400">เหตุผลที่ปฏิเสธ</div>
              <div className="text-slate-700">{request.review_note}</div>
            </div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">รายการวัสดุ</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">วัสดุ</th>
                <th className="px-4 py-2 text-right font-medium">จำนวน</th>
                <th className="px-4 py-2 font-medium">หน่วย</th>
                <th className="px-4 py-2 font-medium">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(request.purchase_request_items || []).map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2.5 text-slate-800">{item.material_types?.name || '-'}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-slate-700">{item.quantity_requested}</td>
                  <td className="px-4 py-2.5 text-slate-500">{item.material_types?.unit || '-'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{item.note || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {request.status === 'pending_review' && (
        <Card className="p-5">
          {showRejectBox ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-700">เหตุผลที่ปฏิเสธ</label>
              <textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} className="w-full" rows={2} />
              <div className="flex justify-end gap-3">
                <Button type="button" variant="secondary" onClick={() => setShowRejectBox(false)}>
                  ยกเลิก
                </Button>
                <Button type="button" variant="danger" onClick={handleReject} disabled={isPending}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยันปฏิเสธ'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-3">
              <Button type="button" variant="danger" onClick={() => setShowRejectBox(true)} disabled={isPending}>
                ปฏิเสธ
              </Button>
              <Button type="button" onClick={handleApprove} disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'อนุมัติ'}
              </Button>
            </div>
          )}
        </Card>
      )}

      {request.status === 'approved' && (
        <div className="flex justify-end">
          <Button type="button" onClick={() => router.push(`/dashboard/procurement/orders/create?fromRequest=${request.id}`)}>
            <ShoppingCart className="h-4 w-4" /> สร้างใบสั่งซื้อจากคำขอนี้
          </Button>
        </div>
      )}
    </div>
  )
}
