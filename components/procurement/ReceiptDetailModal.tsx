'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import { getBoqCheckForReceipts } from '@/actions/procurement/boq-control'
import BoqCheckPanel from '@/components/procurement/BoqCheckPanel'
import GoodsReceiptDocActions from '@/components/procurement/GoodsReceiptDocActions'
import type { GoodsReceipt } from '@/lib/types/procurement'

/** What a single ใบรับสินค้า actually contained, plus the same BOQ check
 * the payment-voucher modal shows - viewable any time, not just when
 * bundling this receipt into a payment. Opened by clicking the RI number
 * in the receipts list. */
export default function ReceiptDetailModal({ receipt, onClose }: { receipt: GoodsReceipt; onClose: () => void }) {
  const toast = useToast()
  const [boqPanels, setBoqPanels] = useState<{ poId: string; scopeLabel: string; lines: Awaited<ReturnType<typeof getBoqCheckForReceipts>>['perPo'][number]['lines'] }[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    getBoqCheckForReceipts([receipt.id])
      .then((result) => {
        if (!cancelled) setBoqPanels(result.perPo)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'โหลดข้อมูล BOQ ไม่สำเร็จ'))
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.id])

  const items = receipt.goods_receipt_items || []
  const total = items.reduce((sum, i) => sum + i.quantity_received * i.unit_price_at_receipt, 0)

  return (
    <Modal isOpen onClose={onClose} title={`ใบรับสินค้า ${receipt.ri_no}`} panelClassName="max-w-2xl">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <GoodsReceiptDocActions receiptId={receipt.id} riNo={receipt.ri_no} />
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="text-slate-500">ใบสั่งซื้อ</div>
          <div>
            <Link href={`/dashboard/procurement/orders/${receipt.purchase_order_id}`} className="font-mono text-indigo-600 hover:underline">
              {receipt.purchase_orders?.po_no || '-'}
            </Link>
          </div>
          <div className="text-slate-500">ผู้จำหน่าย</div>
          <div className="text-slate-800">{receipt.purchase_orders?.suppliers?.name || '-'}</div>
          <div className="text-slate-500">วันที่รับ</div>
          <div className="text-slate-800">{new Date(receipt.received_at).toLocaleDateString('th-TH')}</div>
          {receipt.delivery_note_no && (
            <>
              <div className="text-slate-500">เลขที่ใบส่งของ</div>
              <div className="text-slate-800">{receipt.delivery_note_no}</div>
            </>
          )}
          {receipt.note && (
            <>
              <div className="text-slate-500">หมายเหตุ</div>
              <div className="text-slate-800">{receipt.note}</div>
            </>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-3 py-2">วัสดุ</th>
                <th className="px-3 py-2 text-right">จำนวนที่รับ</th>
                <th className="px-3 py-2 text-right">ราคา/หน่วย</th>
                <th className="px-3 py-2 text-right">มูลค่า</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const material = item.purchase_order_items?.material_types
                return (
                  <tr key={item.id}>
                    <td className="px-3 py-2 font-medium text-slate-800">{material?.name || '-'}</td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {item.quantity_received.toLocaleString('th-TH')} {material?.unit || ''}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">฿{formatCurrency(item.unit_price_at_receipt)}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-800">
                      ฿{formatCurrency(item.quantity_received * item.unit_price_at_receipt)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t bg-slate-50">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right font-semibold text-slate-700">รวม</td>
                <td className="px-3 py-2 text-right font-semibold text-slate-800">฿{formatCurrency(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> กำลังตรวจสอบ BOQ...
          </div>
        ) : (
          boqPanels.map((po) => <BoqCheckPanel key={po.poId} lines={po.lines} scopeLabel={po.scopeLabel} />)
        )}
      </div>
    </Modal>
  )
}
