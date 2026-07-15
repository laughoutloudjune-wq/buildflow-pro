'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { formatCurrency } from '@/lib/currency'
import {
  addBoqMaterialItem,
  createMaterialType,
  deleteBoqMaterialItem,
  getBoqMaterialItems,
  getMaterialTypes,
  updateBoqMaterialItem,
} from '@/actions/material-actions'
import type { BoqMaterialItem, MaterialType } from '@/lib/types/materials'

type Props = {
  isOpen: boolean
  onClose: () => void
  boqId: string
  boqItemName: string
}

export default function BoqMaterialItemsModal({ isOpen, onClose, boqId, boqItemName }: Props) {
  const [items, setItems] = useState<BoqMaterialItem[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [selectedMaterialId, setSelectedMaterialId] = useState('')
  const [plannedQuantity, setPlannedQuantity] = useState('1')
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({})

  const [showNewMaterial, setShowNewMaterial] = useState(false)
  const [newMaterialName, setNewMaterialName] = useState('')
  const [newMaterialUnit, setNewMaterialUnit] = useState('')
  const [newMaterialPrice, setNewMaterialPrice] = useState('0')

  useEffect(() => {
    if (!isOpen) return
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, boqId])

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const [boqItems, types] = await Promise.all([getBoqMaterialItems(boqId), getMaterialTypes()])
      setItems(boqItems)
      setMaterialTypes(types)
      setQuantityDrafts(
        boqItems.reduce((acc: Record<string, string>, item) => {
          acc[item.id] = String(item.planned_quantity)
          return acc
        }, {})
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลวัสดุไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  const availableMaterialTypes = materialTypes.filter(
    (mt) => !items.some((item) => item.material_type_id === mt.id)
  )

  async function handleAddItem() {
    if (!selectedMaterialId) {
      setError('กรุณาเลือกวัสดุ')
      return
    }
    const qty = parseFloat(plannedQuantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('กรุณาใส่ปริมาณที่ถูกต้อง')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await addBoqMaterialItem(boqId, Number(selectedMaterialId), qty)
      setSelectedMaterialId('')
      setPlannedQuantity('1')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เพิ่มรายการวัสดุไม่สำเร็จ')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSaveQuantity(itemId: string) {
    const qty = parseFloat(quantityDrafts[itemId] ?? '')
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('กรุณาใส่ปริมาณที่ถูกต้อง')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await updateBoqMaterialItem(itemId, boqId, qty)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกปริมาณไม่สำเร็จ')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!confirm('ยืนยันลบรายการวัสดุนี้?')) return
    setIsSaving(true)
    setError(null)
    try {
      await deleteBoqMaterialItem(itemId, boqId)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ลบรายการไม่สำเร็จ')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleCreateMaterial() {
    if (!newMaterialName.trim()) {
      setError('กรุณาใส่ชื่อวัสดุ')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await createMaterialType(newMaterialName, newMaterialUnit || 'unit', parseFloat(newMaterialPrice) || 0)
      setNewMaterialName('')
      setNewMaterialUnit('')
      setNewMaterialPrice('0')
      setShowNewMaterial(false)
      const types = await getMaterialTypes()
      setMaterialTypes(types)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เพิ่มวัสดุใหม่ไม่สำเร็จ')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`วัสดุที่ใช้ในงาน: ${boqItemName}`} panelClassName="max-w-2xl">
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">วัสดุ</th>
                  <th className="px-3 py-2 text-right font-semibold">ปริมาณที่ตั้งงบ</th>
                  <th className="px-3 py-2 text-left font-semibold">หน่วย</th>
                  <th className="px-3 py-2 text-right font-semibold">ราคา/หน่วยล่าสุด</th>
                  <th className="px-3 py-2 text-right font-semibold">งบประมาณ</th>
                  <th className="px-3 py-2 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                      ยังไม่มีรายการวัสดุสำหรับงานนี้
                    </td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const price = item.material_types?.current_price || 0
                    const budget = (parseFloat(quantityDrafts[item.id] ?? '0') || 0) * price
                    return (
                      <tr key={item.id}>
                        <td className="px-3 py-2 font-medium text-slate-800">{item.material_types?.name || '-'}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={quantityDrafts[item.id] ?? ''}
                            onChange={(e) => setQuantityDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            onBlur={() => handleSaveQuantity(item.id)}
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                          />
                        </td>
                        <td className="px-3 py-2 text-slate-500">{item.material_types?.unit || '-'}</td>
                        <td className="px-3 py-2 text-right text-slate-600">฿{formatCurrency(price)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-700">฿{formatCurrency(budget)}</td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteItem(item.id)}
                            disabled={isSaving}
                            className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-700">เพิ่มวัสดุในงานนี้</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[180px] flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-600">วัสดุ</label>
                <SearchableSelect
                  value={selectedMaterialId}
                  onChange={setSelectedMaterialId}
                  placeholder="-- เลือกวัสดุ --"
                  options={availableMaterialTypes.map((mt) => ({
                    value: String(mt.id),
                    label: `${mt.name} (${mt.unit})`,
                  }))}
                />
              </div>
              <div className="w-28">
                <label className="mb-1 block text-xs font-medium text-slate-600">ปริมาณ</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={plannedQuantity}
                  onChange={(e) => setPlannedQuantity(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={handleAddItem}
                disabled={isSaving}
                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" /> เพิ่ม
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowNewMaterial((v) => !v)}
              className="mt-2 text-xs font-medium text-indigo-600 hover:underline"
            >
              {showNewMaterial ? 'ยกเลิกเพิ่มวัสดุใหม่' : '+ ไม่พบวัสดุที่ต้องการ? เพิ่มวัสดุใหม่'}
            </button>

            {showNewMaterial && (
              <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-2">
                <div className="min-w-[140px] flex-1">
                  <label className="mb-1 block text-xs font-medium text-slate-600">ชื่อวัสดุใหม่</label>
                  <input
                    type="text"
                    value={newMaterialName}
                    onChange={(e) => setNewMaterialName(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    placeholder="เช่น สีรองพื้น"
                  />
                </div>
                <div className="w-24">
                  <label className="mb-1 block text-xs font-medium text-slate-600">หน่วย</label>
                  <input
                    type="text"
                    value={newMaterialUnit}
                    onChange={(e) => setNewMaterialUnit(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    placeholder="แกลลอน"
                  />
                </div>
                <div className="w-28">
                  <label className="mb-1 block text-xs font-medium text-slate-600">ราคา/หน่วย</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newMaterialPrice}
                    onChange={(e) => setNewMaterialPrice(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCreateMaterial}
                  disabled={isSaving}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  บันทึกวัสดุใหม่
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
