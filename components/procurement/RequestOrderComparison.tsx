'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { pmReviewPurchaseRequest } from '@/actions/procurement-actions'
import { requestLineUnit } from '@/lib/procurement/requestQuantities'
import type { PurchaseRequest, PurchaseRequestItem } from '@/lib/types/procurement'

type LineFlags = {
  item: PurchaseRequestItem
  substituted: boolean
  different: boolean
  late: boolean
  open: boolean
}

/** How one request line compares with what was ordered against it. Flags are
 * information for the PM: none of them blocks anything. */
function compareLine(request: PurchaseRequest, item: PurchaseRequestItem, now: number): LineFlags {
  const links = (item.fulfillment?.links || []).filter((l) => !l.cancelled)
  const unit = requestLineUnit(item)
  const asked = Number(item.quantity_requested) || 0
  const substituted = links.some((l) => l.isSubstitute)
  const different = links.some((l) => l.unit !== unit || (l.unit === unit && Math.abs(l.allocated - asked) > 1e-9))
  const open = item.line_status === 'open'
  const late = open && !!request.needed_by_date && new Date(request.needed_by_date).getTime() < now
  return { item, substituted, different: links.length > 0 && different, late, open }
}

/** One-glance comparison of a request against its orders, with the PM's
 * "reviewed" mark. Shown once the request is approved. */
export default function RequestOrderComparison({
  request,
  canReview,
  onChanged,
}: {
  request: PurchaseRequest
  canReview: boolean
  onChanged: () => void
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [comment, setComment] = useState(request.pm_review_comment || '')
  const [now] = useState(() => Date.now())

  const items = request.purchase_request_items || []
  const rows = items.map((item) => compareLine(request, item, now))
  const asRequested = rows.filter((r) => !r.open && !r.substituted && !r.different && r.item.line_status !== 'closed').length
  const substituted = rows.filter((r) => r.substituted).length
  const different = rows.filter((r) => r.different && !r.substituted).length
  const open = rows.filter((r) => r.open).length
  const late = rows.filter((r) => r.late).length
  const closed = rows.filter((r) => r.item.line_status === 'closed').length

  const parts = [
    `${items.length} รายการ`,
    `${asRequested} ตามที่ขอ`,
    substituted > 0 ? `${substituted} เปลี่ยนยี่ห้อ/รุ่น` : null,
    different > 0 ? `${different} จำนวนหรือหน่วยต่างจากที่ขอ` : null,
    closed > 0 ? `${closed} ปิดรายการเอง` : null,
    open > 0 ? `${open} ยังไม่ได้สั่ง` : null,
    late > 0 ? `${late} เลยวันที่ต้องการ` : null,
  ].filter(Boolean)

  function handleReview() {
    startTransition(async () => {
      const result = await pmReviewPurchaseRequest(request.id, comment)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      onChanged()
      toast.success('บันทึกการตรวจเทียบคำขอซื้อกับใบสั่งซื้อแล้ว')
    })
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">เทียบคำขอซื้อกับใบสั่งซื้อ</div>
          <p className="mt-1 text-sm text-slate-600">{parts.join(' · ')}</p>
          <p className="mt-1 text-xs text-slate-500">
            ดูรายละเอียดแต่ละรายการในตารางด้านล่าง เมื่อ PM ดูความต่างแล้วกด &quot;ตรวจเทียบแล้ว&quot; (เป็นเครื่องหมายบันทึกเท่านั้น ไม่ใช่การอนุมัติ และไม่ขัดขวางการสั่งซื้อ)
          </p>
        </div>
        {request.pm_reviewed_at ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> PM ตรวจแล้ว {new Date(request.pm_reviewed_at).toLocaleDateString('th-TH')}
          </span>
        ) : null}
      </div>
      {canReview && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="หมายเหตุการตรวจ (ถ้ามี)"
            className="min-w-0 flex-1"
          />
          <Button type="button" variant="secondary" onClick={handleReview} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : request.pm_reviewed_at ? 'ตรวจอีกครั้ง' : 'ตรวจเทียบแล้ว'}
          </Button>
        </div>
      )}
      {request.pm_review_comment && !canReview ? (
        <p className="mt-2 text-sm text-slate-600">หมายเหตุ PM: {request.pm_review_comment}</p>
      ) : null}
    </Card>
  )
}
