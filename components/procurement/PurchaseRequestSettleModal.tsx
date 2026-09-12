'use client'

import { useMemo, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { settlePurchaseRequestItems } from '@/actions/procurement-actions'
import type { PurchaseRequest, SettlementReason } from '@/lib/types/procurement'

const REASON_OPTIONS: { value: SettlementReason; label: string; hint: string }[] = [
  {
    value: 'ordered',
    label: 'สั่งซื้อแล้ว',
    hint: 'ซื้อของแล้ว แต่ไม่ได้ออกใบสั่งซื้อจากคำขอนี้ เช่น เปลี่ยนยี่ห้อ หรือออก PO แยกต่างหาก',
  },
  {
    value: 'cancelled',
    label: 'ไม่สั่งซื้อรายการนี้',
    hint: 'ตัดรายการนี้ออก ไม่ต้องซื้อแล้ว เพื่อให้คำขอปิดได้ ไม่ค้างอยู่กับของที่ไม่ได้สั่ง',
  },
]

/** Selecting which of a request's still-outstanding lines are actually
 * handled already, and how much of each. Exists because po_create only
 * settles a line when a PO raised *from this request* covers it - material
 * bought as a different brand, bought on a standalone PO, or dropped
 * entirely never settles on its own and leaves the request stuck at
 * 'approved' looking untouched.
 *
 * Mounted only while open (see PurchaseRequestDetail) so every opening starts
 * from the request's current outstanding quantities - they move underneath it
 * whenever a PO is placed. */
export default function PurchaseRequestSettleModal({
  request,
  onClose,
  onSaved,
}: {
  request: PurchaseRequest
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [reason, setReason] = useState<SettlementReason>('ordered')
  const [poRef, setPoRef] = useState('')
  const [note, setNote] = useState('')

  const outstanding = useMemo(
    () => (request.purchase_request_items || []).filter((item) => item.quantity_requested > 0),
    [request.purchase_request_items]
  )

  /** Keyed by request item id. A line is only submitted once ticked, so an
   * untouched modal can't settle anything by accident. */
  const [picked, setPicked] = useState<Record<string, { checked: boolean; quantity: string }>>(() =>
    Object.fromEntries(
      (request.purchase_request_items || [])
        .filter((item) => item.quantity_requested > 0)
        .map((item) => [item.id, { checked: false, quantity: String(item.quantity_requested) }])
    )
  )

  const selected = outstanding.filter((item) => picked[item.id]?.checked)

  const overSettled = selected.filter(
    (item) => Number(picked[item.id]?.quantity || 0) > item.quantity_requested
  )
  const invalidQuantity = selected.filter((item) => !(Number(picked[item.id]?.quantity || 0) > 0))
  const canSubmit = selected.length > 0 && overSettled.length === 0 && invalidQuantity.length === 0

  function toggle(itemId: string, checked: boolean) {
    setPicked((prev) => ({ ...prev, [itemId]: { ...prev[itemId], checked } }))
  }

  function setQuantity(itemId: string, quantity: string) {
    setPicked((prev) => ({ ...prev, [itemId]: { ...prev[itemId], quantity } }))
  }

  function toggleAll(checked: boolean) {
    setPicked((prev) =>
      Object.fromEntries(outstanding.map((item) => [item.id, { ...prev[item.id], checked }]))
    )
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await settlePurchaseRequestItems({
        purchase_request_id: request.id,
        reason,
        po_ref: reason === 'ordered' ? poRef : '',
        note,
        items: selected.map((item) => ({
          purchase_request_item_id: item.id,
          quantity: Number(picked[item.id]?.quantity || 0),
        })),
      })

      if ('error' in result) {
        toast.error(result.error)
        return
      }
      onSaved()
      toast.success(
        reason === 'ordered'
          ? `บันทึกว่าสั่งซื้อแล้ว ${result.settled} รายการ`
          : `ตัดออก ${result.settled} รายการ`
      )
    })
  }

  const allChecked = outstanding.length > 0 && selected.length === outstanding.length

  return (
    <Modal isOpen onClose={onClose} title="เลือกรายการที่จัดการแล้ว" panelClassName="max-w-2xl">
      <div className="space-y-5">
        <p className="text-sm text-slate-500">
          ใช้เมื่อซื้อของแล้วแต่ไม่ได้ออกใบสั่งซื้อจากคำขอนี้ หรือไม่ต้องการซื้อรายการนั้นแล้ว
          จำนวนที่เลือกจะถูกหักออกจากยอดคงเหลือเหมือนกับที่ออก PO ปกติ และย้อนกลับได้ภายหลัง
        </p>

        <div className="space-y-2">
          {REASON_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
                reason === option.value ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200'
              }`}
            >
              <input
                type="radio"
                name="settle-reason"
                className="mt-1 h-4 w-4 shrink-0"
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800">{option.label}</div>
                <div className="text-xs text-slate-500">{option.hint}</div>
              </div>
            </label>
          ))}
        </div>

        {outstanding.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">
            ไม่มีรายการคงเหลือให้จัดการแล้ว
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-slate-600">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={allChecked}
                      onChange={(e) => toggleAll(e.target.checked)}
                      aria-label="เลือกทั้งหมด"
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">วัสดุ</th>
                  <th className="px-3 py-2 text-right font-medium">คงเหลือ</th>
                  <th className="w-32 px-3 py-2 text-right font-medium">จำนวนที่จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {outstanding.map((item) => {
                  const row = picked[item.id] || { checked: false, quantity: '' }
                  const over = row.checked && Number(row.quantity || 0) > item.quantity_requested
                  return (
                    <tr key={item.id} className={row.checked ? 'bg-indigo-50/30' : undefined}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={row.checked}
                          onChange={(e) => toggle(item.id, e.target.checked)}
                          aria-label={item.material_types?.name || 'วัสดุ'}
                        />
                      </td>
                      <td className="min-w-0 break-words px-3 py-2 text-slate-800">
                        {item.material_types?.name || '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-slate-500">
                        {item.quantity_requested} {item.material_types?.unit || ''}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          max={item.quantity_requested}
                          step="any"
                          value={row.quantity}
                          disabled={!row.checked}
                          onChange={(e) => setQuantity(item.id, e.target.value)}
                          className={`w-full text-right ${over ? 'border-red-400' : ''}`}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {overSettled.length > 0 && (
          <p className="text-sm text-red-600">จำนวนที่จัดการต้องไม่เกินจำนวนคงเหลือของรายการ</p>
        )}

        {reason === 'ordered' && (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              เลขที่ใบสั่งซื้ออ้างอิง <span className="font-normal text-slate-400">(ถ้ามี)</span>
            </label>
            <input
              type="text"
              value={poRef}
              onChange={(e) => setPoRef(e.target.value)}
              placeholder="เช่น PO-20260910001 หรือเลขที่บิลของร้าน"
              className="w-full"
            />
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            หมายเหตุ <span className="font-normal text-slate-400">(ถ้ามี)</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={reason === 'ordered' ? 'เช่น สั่งยี่ห้ออื่นแทน' : 'เช่น หน้างานเปลี่ยนแบบ ไม่ต้องใช้แล้ว'}
            className="w-full"
          />
        </div>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isPending}>
            ยกเลิก
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit || isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `ยืนยัน (${selected.length} รายการ)`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
