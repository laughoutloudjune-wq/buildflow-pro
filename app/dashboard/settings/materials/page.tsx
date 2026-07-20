'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import NoticeBanner from '@/components/ui/NoticeBanner'
import { formatCurrency } from '@/lib/currency'
import {
  createMaterialType,
  deleteMaterialType,
  getMaterialTypes,
  updateMaterialPrice,
  updateMaterialType,
} from '@/actions/material-actions'
import type { MaterialType } from '@/lib/types/materials'

export default function MaterialTypesPage() {
  const [materials, setMaterials] = useState<MaterialType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingMaterial, setEditingMaterial] = useState<MaterialType | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [unitDraft, setUnitDraft] = useState('')
  const [priceDraft, setPriceDraft] = useState('0')

  useEffect(() => {
    void loadMaterials()
  }, [])

  async function loadMaterials() {
    setIsLoading(true)
    try {
      const data = await getMaterialTypes()
      setMaterials(data)
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'โหลดข้อมูลวัสดุไม่สำเร็จ' })
    } finally {
      setIsLoading(false)
    }
  }

  function openCreateModal() {
    setEditingMaterial(null)
    setNameDraft('')
    setUnitDraft('')
    setPriceDraft('0')
    setIsModalOpen(true)
  }

  function openEditModal(material: MaterialType) {
    setEditingMaterial(material)
    setNameDraft(material.name)
    setUnitDraft(material.unit)
    setPriceDraft(String(material.current_price))
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingMaterial(null)
  }

  function handleSubmit() {
    if (!nameDraft.trim()) {
      setNotice({ tone: 'error', message: 'กรุณาใส่ชื่อวัสดุ' })
      return
    }
    const price = parseFloat(priceDraft)
    if (!Number.isFinite(price) || price < 0) {
      setNotice({ tone: 'error', message: 'กรุณาใส่ราคาที่ถูกต้อง' })
      return
    }

    startTransition(async () => {
      setNotice(null)
      try {
        if (editingMaterial) {
          await updateMaterialType(editingMaterial.id, nameDraft, unitDraft)
          if (price !== editingMaterial.current_price) {
            await updateMaterialPrice(editingMaterial.id, price)
          }
        } else {
          await createMaterialType(nameDraft, unitDraft, price)
        }
        closeModal()
        await loadMaterials()
        setNotice({ tone: 'success', message: 'บันทึกข้อมูลวัสดุเรียบร้อยแล้ว' })
      } catch (error) {
        setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ' })
      }
    })
  }

  function handleDelete(material: MaterialType) {
    if (!confirm(`ยืนยันลบวัสดุ "${material.name}"?`)) return
    startTransition(async () => {
      setNotice(null)
      try {
        await deleteMaterialType(material.id)
        await loadMaterials()
      } catch (error) {
        setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'ลบไม่สำเร็จ' })
      }
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดข้อมูลวัสดุ...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/dashboard/settings"
          className="mb-2 flex w-fit items-center gap-1 text-sm text-slate-500 transition hover:text-indigo-600"
        >
          <ArrowLeft className="h-4 w-4" /> กลับไปตั้งค่า
        </Link>
        <PageHeader
          title="รายการวัสดุ (Material Catalog)"
          subtitle="จัดการชื่อวัสดุ หน่วย และราคาล่าสุดที่ใช้อ้างอิงเวลาบันทึกการใช้วัสดุในแต่ละงาน"
          actions={
            <Button onClick={openCreateModal}>
              <Plus className="h-4 w-4" />
              เพิ่มวัสดุใหม่
            </Button>
          }
        />
      </div>

      {notice ? <NoticeBanner tone={notice.tone} message={notice.message} onClose={() => setNotice(null)} /> : null}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">ชื่อวัสดุ</th>
                <th className="px-4 py-3 font-semibold">หน่วย</th>
                <th className="px-4 py-3 text-right font-semibold">ราคาล่าสุด</th>
                <th className="px-4 py-3 font-semibold">อัปเดตราคาล่าสุดเมื่อ</th>
                <th className="px-4 py-3 w-[100px] text-center font-semibold">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {materials.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center italic text-slate-400">
                    ยังไม่มีวัสดุในระบบ กดปุ่ม &quot;เพิ่มวัสดุใหม่&quot; เพื่อเริ่มต้น
                  </td>
                </tr>
              ) : (
                materials.map((material) => (
                  <tr key={material.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{material.name}</td>
                    <td className="px-4 py-3 text-slate-500">{material.unit}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-700">
                      ฿{formatCurrency(material.current_price)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {material.price_updated_at
                        ? new Date(material.price_updated_at).toLocaleString('th-TH')
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => openEditModal(material)}
                        disabled={isPending}
                        className="rounded p-1 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                        title="แก้ไข"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(material)}
                        disabled={isPending}
                        className="rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                        title="ลบ"
                      >
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingMaterial ? 'แก้ไขวัสดุ' : 'เพิ่มวัสดุใหม่'}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อวัสดุ</label>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="w-full"
              placeholder="เช่น สีรองพื้น, ปูนซีเมนต์"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">หน่วย</label>
              <input
                value={unitDraft}
                onChange={(e) => setUnitDraft(e.target.value)}
                className="w-full"
                placeholder="แกลลอน / ถุง / กก."
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ราคา/หน่วยล่าสุด (บาท)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={priceDraft}
                onChange={(e) => setPriceDraft(e.target.value)}
                className="w-full"
              />
            </div>
          </div>
          {editingMaterial && (
            <p className="text-xs text-slate-500">
              การแก้ไขราคาที่นี่จะปรับ &quot;ราคาอ้างอิงล่าสุด&quot; เท่านั้น
              ไม่กระทบยอดที่บันทึกไปแล้วในประวัติการใช้วัสดุของแต่ละงาน
            </p>
          )}
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={closeModal}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึก'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
