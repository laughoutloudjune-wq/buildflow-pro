'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { getPayoutReviewLines } from '@/actions/procurement/payout-review'
import { exceedsOrdered, outstandingOnPoLine, type PayoutReviewLine } from '@/lib/procurement/payoutReview'
import { formatCurrency } from '@/lib/currency'

const fmt = (n: number) => n.toLocaleString('th-TH')

/** PM's side-by-side for a payout: the PO's actual material, supplier and
 * ordered quantity next to what these receipts delivered, plus which
 * requests the line was bought for. Compare the supplier's bill to THIS, not
 * to the foreman's original request. */
export default function PayoutPoComparison({ receiptIds }: { receiptIds: string[] }) {
  const [lines, setLines] = useState<PayoutReviewLine[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const key = receiptIds.join(',')

  useEffect(() => {
    let cancelled = false
    getPayoutReviewLines(key ? key.split(',') : [])
      .then((r) => {
        if (!cancelled) {
          setLines(r)
          setFailed(false)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [key])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดรายการเทียบใบสั่งซื้อ...
      </div>
    )
  }
  if (failed) return <p className="text-sm text-red-600">โหลดรายการเทียบใบสั่งซื้อไม่สำเร็จ</p>
  if (lines.length === 0) return null

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="border-b bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
        เทียบกับใบสั่งซื้อ (วัสดุที่สั่งจริง) — ใช้ตรวจใบแจ้งหนี้/บิลของผู้จำหน่าย
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="px-3 py-1.5 font-medium">PO / ผู้จำหน่าย</th>
              <th className="px-3 py-1.5 font-medium">วัสดุตาม PO</th>
              <th className="px-3 py-1.5 text-right font-medium">สั่งใน PO</th>
              <th className="px-3 py-1.5 text-right font-medium">รับครั้งนี้</th>
              <th className="px-3 py-1.5 text-right font-medium">รับสะสม / ค้างรับ</th>
              <th className="px-3 py-1.5 text-right font-medium">ราคา/หน่วย</th>
              <th className="px-3 py-1.5 text-right font-medium">มูลค่า</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {lines.map((l) => (
              <tr key={l.receiptItemId} className="align-top">
                <td className="px-3 py-1.5">
                  <Link href={`/dashboard/procurement/orders/${l.poId}`} className="font-mono text-indigo-600 hover:underline">
                    {l.poNo}
                  </Link>
                  <div className="text-slate-500">{l.supplierName || '-'}</div>
                  <div className="font-mono text-slate-400">{l.riNo}</div>
                </td>
                <td className="px-3 py-1.5">
                  <div className="font-medium text-slate-800">{l.materialName}</div>
                  {l.allocations.map((a, i) => (
                    <div key={i} className="text-slate-400">
                      PR-{a.prNo ?? '?'}
                      {a.scopeLabel ? ` · ${a.scopeLabel}` : ''}: {fmt(a.quantity)} {l.unit}
                      {a.isSubstitute && a.requestedMaterialName ? ` (ขอไว้: ${a.requestedMaterialName})` : ''}
                    </div>
                  ))}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">
                  {fmt(l.orderedQty)} {l.unit}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium">
                  {fmt(l.receivedThisReceipt)} {l.unit}
                </td>
                <td className={`whitespace-nowrap px-3 py-1.5 text-right ${exceedsOrdered(l) ? 'font-medium text-red-600' : ''}`}>
                  {fmt(l.totalReceivedQty)} / {fmt(outstandingOnPoLine(l))}
                  {exceedsOrdered(l) && <div>เกินที่สั่ง</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">฿{formatCurrency(l.unitPrice)}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium">
                  ฿{formatCurrency(l.receivedThisReceipt * l.unitPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
