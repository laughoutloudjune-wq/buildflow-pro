'use client'

import { useState, useTransition } from 'react'
import { Gift, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import { updateSalePrice } from '@/actions/sales-actions'
import {
  addPlotSalePromotionItem,
  applyPromotionBundle,
  deletePlotSalePromotionItem,
  updatePlotSalePromotionItem,
  type PlotSalePromotionItem,
} from '@/actions/plot-sale-promotion-items'
import type { Promotion } from '@/actions/promotions-actions'

export default function PlotPromotionItemsSection({
  plotSaleId,
  items,
  bundles,
  listPrice,
  salePrice,
  canEdit,
  onRefresh,
}: {
  plotSaleId: string
  items: PlotSalePromotionItem[]
  bundles: Promotion[]
  listPrice: number | null
  salePrice: number | null
  canEdit: boolean
  onRefresh: () => void
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [selectedBundleId, setSelectedBundleId] = useState('')
  const [isItemModalOpen, setIsItemModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<PlotSalePromotionItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PlotSalePromotionItem | null>(null)

  const totalItemsValue = items.reduce((sum, i) => sum + i.value, 0)
  const afterPromotionPrice = listPrice != null ? Math.max(0, listPrice - totalItemsValue) : null
  const matchesSalePrice = salePrice != null && afterPromotionPrice != null && Math.abs(salePrice - afterPromotionPrice) < 0.01

  function handleApplyBundle() {
    if (!selectedBundleId) return
    startTransition(async () => {
      const res = await applyPromotionBundle(plotSaleId, selectedBundleId)
      if (!res.success) {
        toast.error(res.error || 'นำโปรโมชั่นไปใช้ไม่สำเร็จ')
        return
      }
      toast.success(`เพิ่มรายการของแถม ${res.count} รายการแล้ว`)
      setSelectedBundleId('')
      onRefresh()
    })
  }

  function openAddItem() {
    setEditingItem(null)
    setIsItemModalOpen(true)
  }

  function openEditItem(item: PlotSalePromotionItem) {
    setEditingItem(item)
    setIsItemModalOpen(true)
  }

  function handleSaveItem(formData: FormData) {
    startTransition(async () => {
      const res = editingItem
        ? await updatePlotSalePromotionItem(editingItem.id, formData)
        : await addPlotSalePromotionItem(plotSaleId, formData)
      if (!res.success) {
        toast.error(res.error || 'บันทึกไม่สำเร็จ')
        return
      }
      toast.success('บันทึกรายการแล้ว')
      setIsItemModalOpen(false)
      setEditingItem(null)
      onRefresh()
    })
  }

  function handleDelete() {
    if (!deleteTarget) return
    const target = deleteTarget
    startTransition(async () => {
      const res = await deletePlotSalePromotionItem(target.id)
      if (!res.success) {
        toast.error(res.error || 'ลบไม่สำเร็จ')
        return
      }
      setDeleteTarget(null)
      onRefresh()
    })
  }

  function handleUseAsSalePrice() {
    if (afterPromotionPrice == null) return
    startTransition(async () => {
      const res = await updateSalePrice(plotSaleId, afterPromotionPrice)
      if (!res.success) {
        toast.error(res.error || 'บันทึกไม่สำเร็จ')
        return
      }
      toast.success('ตั้งราคาขายจริงตามส่วนลดโปรโมชั่นแล้ว')
      onRefresh()
    })
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Gift className="h-4 w-4 text-indigo-400" /> โปรโมชั่นและของแถม
        </h3>
        {canEdit && (
          <Button type="button" size="sm" onClick={openAddItem}>
            <Plus className="h-3.5 w-3.5" /> เพิ่มรายการเอง
          </Button>
        )}
      </div>

      {canEdit && bundles.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2.5">
          <select value={selectedBundleId} onChange={(e) => setSelectedBundleId(e.target.value)} className="min-w-[220px] flex-1">
            <option value="">-- เลือกชุดโปรโมชั่นเพื่อนำไปใช้ --</option>
            {bundles.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.items.length} รายการ - มูลค่ารวม {formatCurrency(b.items.reduce((s, i) => s + i.value, 0))} บาท)
              </option>
            ))}
          </select>
          <Button type="button" size="sm" variant="secondary" onClick={handleApplyBundle} disabled={!selectedBundleId || isPending}>
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            นำไปใช้
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">ยังไม่มีรายการของแถม/ส่วนลด</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-2 font-medium">รายการ</th>
                <th className="py-2 pr-2 text-right font-medium">มูลค่า</th>
                {canEdit && <th className="py-2 pr-2 font-medium">การดำเนินการ</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="py-2 pr-2 text-slate-700">{item.name}</td>
                  <td className="py-2 pr-2 text-right font-medium text-slate-700">฿{formatCurrency(item.value)}</td>
                  {canEdit && (
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => openEditItem(item)} className="text-slate-300 hover:text-indigo-600">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => setDeleteTarget(item)} className="text-slate-300 hover:text-red-500">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span>ราคาตั้งขาย</span>
            <span>{listPrice != null ? `฿${formatCurrency(listPrice)}` : '— ยังไม่ระบุ —'}</span>
          </div>
          <div className="flex items-center justify-between text-slate-500">
            <span>หักมูลค่าของแถม/โปรโมชั่น</span>
            <span>-฿{formatCurrency(totalItemsValue)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 pt-1.5 font-semibold text-slate-800">
            <span>ราคาหลังโปรโมชั่น</span>
            <span>{afterPromotionPrice != null ? `฿${formatCurrency(afterPromotionPrice)}` : '—'}</span>
          </div>
          {canEdit && afterPromotionPrice != null && (
            <div className="flex justify-end pt-1">
              {matchesSalePrice ? (
                <span className="text-xs text-emerald-600">ตรงกับราคาขายจริงแล้ว</span>
              ) : (
                <Button type="button" size="sm" variant="secondary" onClick={handleUseAsSalePrice} disabled={isPending}>
                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  ใช้เป็นราคาขายจริง
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <Modal
        isOpen={isItemModalOpen}
        onClose={() => {
          setIsItemModalOpen(false)
          setEditingItem(null)
        }}
        title={editingItem ? 'แก้ไขรายการของแถม' : 'เพิ่มรายการของแถม'}
      >
        <form key={editingItem?.id || 'new'} action={handleSaveItem} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อรายการ</label>
            <input
              name="name"
              required
              placeholder="เช่น แถมแอร์ 12,000 BTU 1 เครื่อง"
              className="w-full"
              defaultValue={editingItem?.name}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">มูลค่า (บาท)</label>
            <input type="number" min="0" step="0.01" name="value" required className="w-full" defaultValue={editingItem?.value} />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => { setIsItemModalOpen(false); setEditingItem(null) }}>ยกเลิก</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              บันทึก
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="ลบรายการ"
        message={deleteTarget ? `ลบรายการ "${deleteTarget.name}" ใช่ไหม?` : ''}
        confirmLabel={isPending ? 'กำลังลบ...' : 'ลบ'}
        cancelLabel="ยกเลิก"
        tone="danger"
        busy={isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </Card>
  )
}
