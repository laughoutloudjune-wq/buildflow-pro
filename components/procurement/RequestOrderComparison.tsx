'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { pmReviewPurchaseRequest } from '@/actions/procurement-actions'
import { compareRequestLine, type RequestLineFlag } from '@/lib/procurement/requestFlags'
import type { PurchaseRequest } from '@/lib/types/procurement'

/** One-glance comparison of a request against its orders, with the PM's
 * "reviewed" mark. Shown once the request is approved. */
export default function RequestOrderComparison({
  request,
  canReview,
  onChanged,
  activeFlag,
  onFlagChange,
}: {
  request: PurchaseRequest
  canReview: boolean
  onChanged: () => void
  /** The flag the line table below is currently filtered to, if any. */
  activeFlag: RequestLineFlag | null
  onFlagChange: (flag: RequestLineFlag | null) => void
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [comment, setComment] = useState(request.pm_review_comment || '')
  const [now] = useState(() => Date.now())

  const items = request.purchase_request_items || []
  const rows = items.map((item) => compareRequestLine(request, item, now))
  const asRequested = rows.filter((r) => !r.open && !r.substituted && !r.different && r.item.line_status !== 'closed').length
  const substituted = rows.filter((r) => r.substituted).length
  const different = rows.filter((r) => r.different).length
  const open = rows.filter((r) => r.open).length
  const late = rows.filter((r) => r.late).length
  const closed = rows.filter((r) => r.item.line_status === 'closed').length

  const parts: { key: RequestLineFlag | null; label: string; tone: string }[] = [
    { key: null, label: `${items.length} รายการ`, tone: '' },
    { key: null, label: `${asRequested} ตามที่ขอ`, tone: '' },
    ...(substituted > 0 ? [{ key: 'substituted' as const, label: `${substituted} เปลี่ยนยี่ห้อ/รุ่น`, tone: 'bg-indigo-50 text-indigo-700' }] : []),
    ...(different > 0 ? [{ key: 'different' as const, label: `${different} จำนวนหรือหน่วยต่างจากที่ขอ`, tone: 'bg-amber-50 text-amber-700' }] : []),
    ...(closed > 0 ? [{ key: 'closed' as const, label: `${closed} ปิดรายการเอง`, tone: 'bg-slate-100 text-slate-700' }] : []),
    ...(open > 0 ? [{ key: 'open' as const, label: `${open} ยังไม่ได้สั่ง`, tone: 'bg-slate-100 text-slate-700' }] : []),
    ...(late > 0 ? [{ key: 'late' as const, label: `${late} เลยวันที่ต้องการ`, tone: 'bg-rose-50 text-rose-700' }] : []),
  ]

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
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
            {parts.map((p) =>
              p.key ? (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={activeFlag === p.key}
                  onClick={() => onFlagChange(activeFlag === p.key ? null : p.key)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${p.tone} ${
                    activeFlag === p.key ? 'ring-slate-500' : 'ring-transparent hover:ring-slate-300'
                  }`}
                >
                  {p.label}
                </button>
              ) : (
                <span key={p.label}>{p.label}</span>
              )
            )}
            {activeFlag && (
              <button type="button" onClick={() => onFlagChange(null)} className="text-xs text-indigo-600 hover:underline">
                แสดงทุกรายการ
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            กดที่ป้ายเพื่อกรองเฉพาะรายการนั้นในตารางด้านล่าง เมื่อ PM ดูความต่างแล้วกด &quot;ตรวจเทียบแล้ว&quot; (เป็นเครื่องหมายบันทึกเท่านั้น ไม่ใช่การอนุมัติ และไม่ขัดขวางการสั่งซื้อ)
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
