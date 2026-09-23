'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { createGoodsReceipt } from '@/actions/procurement-actions'
import { getBoqCheckForGoodsReceiptDraft } from '@/actions/procurement/boq-control'
import BoqCheckPanel, { type BoqCheckLine } from '@/components/procurement/BoqCheckPanel'
import type { PurchaseOrder } from '@/lib/types/procurement'

// Every line with anything left to receive starts pre-selected at its full
// remaining quantity - unchecking the couple of lines that didn't show up is
// less friction than checking every line that did, and a click-through with
// nothing unchecked is exactly the old one-click "mark whole PO received"
// shortcut, now going through the same accounting path (goods_receipt_create)
// as a partial receipt instead of bypassing it.
type Destination = 'store' | 'site'

const DESTINATION_LABEL: Record<Destination, string> = { store: 'เข้าสโตร์', site: 'ส่งตรงหน้างาน' }

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
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [boqLines, setBoqLines] = useState<BoqCheckLine[]>([])
  // Where the delivery unloaded - the fact goods_receipt_create actually
  // needs (see MATERIAL_FLOW_PLAN.md Phase 1). Defaults from whatever the PO
  // lines already agreed on at order time (intended_destination); falls back
  // to 'store' (today's behaviour) when they disagree or said nothing.
  const [defaultDestination, setDefaultDestination] = useState<Destination>('store')
  // Per-line override, keyed by purchase_order_item_id - '' means "inherit
  // the header default above", same NULL-means-inherit convention as the
  // destination column itself.
  const [destinations, setDestinations] = useState<Record<string, Destination | ''>>({})

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
    setReceivedAt(new Date().toISOString().slice(0, 10))

    // Header default: what every line agrees on, if they agree - otherwise
    // 'store', same as an order with no opinion at all.
    const intents = new Set(receivableItems.map(({ item }) => item.intended_destination).filter((d): d is Destination => !!d))
    const headerDefault: Destination = intents.size === 1 ? [...intents][0] : 'store'
    setDefaultDestination(headerDefault)
    // Only lines that actually disagree with the header start pre-filled -
    // everything else stays '' (inherit), so toggling the header later still
    // moves the common case with it.
    const initialDestinations: Record<string, Destination | ''> = {}
    for (const { item } of receivableItems) {
      initialDestinations[item.id] = item.intended_destination && item.intended_destination !== headerDefault ? item.intended_destination : ''
    }
    setDestinations(initialDestinations)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, order.id])

  const selectedCount = Object.values(selected).filter(Boolean).length

  // Stable key so the check below only re-fires when a checked quantity
  // actually changes, not on every unrelated re-render.
  const boqDraftKey = useMemo(
    () =>
      receivableItems
        .filter(({ item }) => selected[item.id] && Number(quantities[item.id]) > 0)
        .map(({ item }) => `${item.material_type_id}:${Number(quantities[item.id])}`)
        .sort()
        .join(','),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, quantities]
  )

  useEffect(() => {
    if (!isOpen || !boqDraftKey) {
      setBoqLines([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      const items = boqDraftKey.split(',').map((pair) => {
        const [materialTypeId, quantity] = pair.split(':').map(Number)
        return { materialTypeId, quantity }
      })
      getBoqCheckForGoodsReceiptDraft(order.id, items)
        .then((result) => {
          if (!cancelled) setBoqLines(result.isOutsideBoq ? [] : result.lines)
        })
        .catch(() => {
          // Best-effort early warning - never blocks receiving goods.
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isOpen, order.id, boqDraftKey])

  function handleSubmit() {
    const items = receivableItems
      .filter(({ item }) => selected[item.id])
      .map(({ item }) => ({
        purchase_order_item_id: item.id,
        quantity_received: Number(quantities[item.id]) || 0,
        unit_price_at_receipt: item.unit_price,
        destination: destinations[item.id] || null,
      }))
      .filter((i) => i.quantity_received > 0)

    if (items.length === 0) {
      toast.error('กรุณาเลือกอย่างน้อย 1 รายการ และระบุจำนวนที่รับ')
      return
    }

    startTransition(async () => {
      const result = await createGoodsReceipt({
        purchase_order_id: order.id,
        delivery_note_no: deliveryNoteNo,
        received_at: receivedAt,
        default_destination: defaultDestination,
        items,
      })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      onSuccess()
      onClose()
    })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="สร้างใบรับสินค้า" panelClassName="max-w-2xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500">เลือกสินค้าที่ได้รับหรือต้องการระบุในใบรับสินค้า</p>
          <span className="shrink-0 text-xs font-medium text-slate-400">เลือก {selectedCount} รายการ</span>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            ของครั้งนี้ไปที่ไหน (ค่าเริ่มต้นของทั้งใบ - แต่ละรายการเลือกต่างจากนี้ได้)
          </label>
          <div className="flex gap-2">
            {(Object.keys(DESTINATION_LABEL) as Destination[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDefaultDestination(d)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  defaultDestination === d ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {DESTINATION_LABEL[d]}
              </button>
            ))}
          </div>
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
                  <th className="w-32 px-3 py-2 text-xs font-medium">ปลายทาง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {receivableItems.map(({ item, remaining }, i) => {
                  const checked = !!selected[item.id]
                  const enteredQty = Number(quantities[item.id]) || 0
                  const overRemaining = checked && enteredQty > remaining
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
                          <>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={quantities[item.id] ?? ''}
                              onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))}
                              className={`w-24 text-right ${overRemaining ? 'border-amber-400 focus:border-amber-500' : ''}`}
                            />
                            {overRemaining && (
                              <div className="mt-1 text-[11px] font-medium text-amber-600">
                                มากกว่าจำนวนคงเหลือ {remaining.toLocaleString('th-TH')} {item.unit || item.material_types?.unit}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-400">
                            {remaining.toLocaleString('th-TH')} {item.unit || item.material_types?.unit}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={destinations[item.id] || ''}
                          onChange={(e) => setDestinations((prev) => ({ ...prev, [item.id]: e.target.value as Destination | '' }))}
                          disabled={!checked}
                          className="w-full text-xs"
                        >
                          <option value="">({DESTINATION_LABEL[defaultDestination]})</option>
                          <option value="store">{DESTINATION_LABEL.store}</option>
                          <option value="site">{DESTINATION_LABEL.site}</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {boqLines.length > 0 && <BoqCheckPanel lines={boqLines} scopeLabel="รับของครั้งนี้" />}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">วันที่รับของ</label>
            <input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className="w-full" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">เลขที่ใบส่งของ (ถ้ามี)</label>
            <input value={deliveryNoteNo} onChange={(e) => setDeliveryNoteNo(e.target.value)} className="w-full" />
          </div>
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
