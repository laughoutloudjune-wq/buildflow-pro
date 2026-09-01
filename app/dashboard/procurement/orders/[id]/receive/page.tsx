'use client'

import { useEffect, useState, useTransition, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { createGoodsReceipt, getPurchaseOrderById } from '@/actions/procurement-actions'
import type { PurchaseOrder } from '@/lib/types/procurement'

export default function GoodsReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const toast = useToast()
  const [deliveryNoteNo, setDeliveryNoteNo] = useState('')
  const [note, setNote] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})

  useEffect(() => {
    void load()
  }, [id])

  async function load() {
    setIsLoading(true)
    try {
      const data = await getPurchaseOrderById(id)
      setOrder(data)
      const initial: Record<string, string> = {}
      for (const item of data?.purchase_order_items || []) {
        const remaining = Math.max(0, item.quantity_ordered - item.quantity_received)
        initial[item.id] = remaining > 0 ? String(remaining) : ''
      }
      setQuantities(initial)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดใบสั่งซื้อไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  function handleSubmit() {
    if (!order) return
    const items = (order.purchase_order_items || [])
      .map((item) => ({
        purchase_order_item_id: item.id,
        quantity_received: Number(quantities[item.id] || 0),
        unit_price_at_receipt: item.unit_price,
      }))
      .filter((i) => i.quantity_received > 0)

    if (items.length === 0) {
      toast.error('กรุณาระบุจำนวนที่รับอย่างน้อย 1 รายการ')
      return
    }

    startTransition(async () => {
      try {
        await createGoodsReceipt({ purchase_order_id: order.id, delivery_note_no: deliveryNoteNo, note, items })
        router.push(`/dashboard/procurement/orders/${order.id}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'บันทึกการรับของไม่สำเร็จ')
      }
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดข้อมูล...</p>
      </div>
    )
  }

  if (!order) {
    return <div className="py-16 text-center text-slate-400">ไม่พบใบสั่งซื้อนี้</div>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/dashboard/procurement/orders/${order.id}`}
          className="mb-2 flex w-fit items-center gap-1 text-sm text-slate-500 transition hover:text-indigo-600"
        >
          <ArrowLeft className="h-4 w-4" /> กลับไปใบสั่งซื้อ
        </Link>
        <PageHeader
          title={`รับของ - ${order.po_no}`}
          subtitle={`ผู้จำหน่าย: ${order.suppliers?.name || '-'} • ระบุจำนวนที่ได้รับจริง (รับได้หลายครั้งหากของมาไม่ครบ)`}
        />
      </div>


      <Card className="p-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">เลขที่ใบส่งของ</label>
            <input value={deliveryNoteNo} onChange={(e) => setDeliveryNoteNo(e.target.value)} className="w-full" />
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">รายการที่รับ</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">วัสดุ</th>
                <th className="px-4 py-2 text-right font-medium">สั่งซื้อ</th>
                <th className="px-4 py-2 text-right font-medium">รับแล้วก่อนหน้า</th>
                <th className="px-4 py-2 text-right font-medium">รับครั้งนี้</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(order.purchase_order_items || []).map((item) => {
                const remaining = Math.max(0, item.quantity_ordered - item.quantity_received)
                return (
                  <tr key={item.id}>
                    <td className="px-4 py-2.5 text-slate-800">{item.material_types?.name || '-'}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">
                      {item.quantity_ordered} {item.material_types?.unit}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{item.quantity_received}</td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        min="0"
                        max={remaining}
                        step="any"
                        value={quantities[item.id] || ''}
                        onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        disabled={remaining <= 0}
                        className="w-28 text-right"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5">
        <label className="mb-1 block text-sm font-medium text-slate-700">หมายเหตุ</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} className="w-full" rows={2} />
      </Card>

      <div className="flex justify-end gap-3">
        <Link href={`/dashboard/procurement/orders/${order.id}`}>
          <Button type="button" variant="secondary">
            ยกเลิก
          </Button>
        </Link>
        <Button type="button" onClick={handleSubmit} disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึกการรับของ'}
        </Button>
      </div>
    </div>
  )
}
