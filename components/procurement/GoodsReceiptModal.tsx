'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { createGoodsReceipt } from '@/actions/procurement-actions'
import type { PurchaseOrder } from '@/lib/types/procurement'

// Every line with anything left to receive starts pre-selected at its full
// remaining quantity - unchecking the couple of lines that didn't show up is
// less friction than checking every line that did, and a click-through with
// nothing unchecked is exactly the old one-click "mark whole PO received"
// shortcut, now going through the same accounting path (goods_receipt_create)
// as a partial receipt instead of bypassing it.
export default function GoodsReceiptModal({
  isOpen,
  onClose,
  order,
  onSuccess,
}: {
  isOpen: boolean
  onClose: () => void
  order: PurchaseOrder
  onSuccess: () => void
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [deliveryNoteNo, setDeliveryNoteNo] = useState('')

  const receivableItems = (order.purchase_order_items || [])
    .map((item) => ({ item, remaining: Math.max(0, item.quantity_ordered - item.quantity_received) }))
    .filter(({ remaining }) => remaining > 0)

  useEffect(() => {
    if (!isOpen) return
    const initialSelected: Record<string, boolean> = {}
    const initialQty: Record<string, string> = {}
    for (const { item, remaining } of receivableItems) {
      initialSelected[item.id] = true
      initialQty[item.id] = String(remaining)
    }
    setSelected(initialSelected)
    setQuantities(initialQty)
    setDeliveryNoteNo('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, order.id])

  const selectedCount = Object.values(selected).filter(Boolean).length

  function handleSubmit() {
    const items = receivableItems
      .filter(({ item }) => selected[item.id])
      .map(({ item }) => ({
        purchase_order_item_id: item.id,
        quantity_received: Number(quantities[item.id]) || 0,
        unit_price_at_receipt: item.unit_price,
      }))
      .filter((i) => i.quantity_received > 0)

    if (items.length === 0) {
      toast.error('กรุณาเลือกอย่างน้อย 1 รายการ และระบุจำนวนที่รับ')
      return
    }

    startTransition(async () => {
      try {
        await createGoodsReceipt({ purchase_order_id: order.id, delivery_note_no: deliveryNoteNo, items })
        onSuccess()
        onClose()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'บันทึกการรับของไม่สำเร็จ')
      }
    })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="สร้างใบรับสินค้า" panelClassName="max-w-lg">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500">เลือกสินค้าที่ได้รับหรือต้องการระบุในใบรับสินค้า</p>
          <span className="shrink-0 text-xs font-medium text-slate-400">เลือก {selectedCount} รายการ</span>
        </div>

        {receivableItems.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
            ไม่มีรายการที่รอรับของแล้ว
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="w-8 px-1 py-2 text-xs font-medium">#</th>
                  <th className="px-2 py-2 text-xs font-medium">รายการสินค้า</th>
                  <th className="w-32 px-3 py-2 text-right text-xs font-medium">จำนวนสินค้า</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {receivableItems.map(({ item, remaining }, i) => {
                  const checked = !!selected[item.id]
                  return (
                    <tr key={item.id}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => setSelected((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="px-1 py-2 text-slate-400">{i + 1}</td>
                      <td className="px-2 py-2 text-slate-800">{item.material_types?.name || '-'}</td>
                      <td className="px-3 py-2 text-right">
                        {checked ? (
                          <input
                            type="number"
                            min="0"
                            max={remaining}
                            step="any"
                            value={quantities[item.id] ?? ''}
                            onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            className="w-24 text-right"
                          />
                        ) : (
                          <span className="text-slate-400">
                            {remaining.toLocaleString('th-TH')} {item.material_types?.unit}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">เลขที่ใบส่งของ (ถ้ามี)</label>
          <input value={deliveryNoteNo} onChange={(e) => setDeliveryNoteNo(e.target.value)} className="w-full" />
        </div>

        <div className="flex justify-end gap-3 border-t pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isPending || receivableItems.length === 0}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ตกลง'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
