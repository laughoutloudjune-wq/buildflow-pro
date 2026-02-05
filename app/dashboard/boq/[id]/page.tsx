'use client'

import { useState, useEffect, useTransition } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Plus, Trash2, ArrowLeft, Loader2, Coins, Layers, AlertCircle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import { getHouseModelById, getBOQItems, createBOQItem, deleteBOQItem } from '@/actions/boq-actions'
import { getContractorTypes } from '@/actions/contractor-type-actions';

export default function BOQDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()

  // State
  const [model, setModel] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [types, setTypes] = useState<any[]>([])
  
  // Loading State (สำคัญมาก)
  const [isLoading, setIsLoading] = useState(true)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  // โหลดข้อมูลเมื่อเข้าหน้าเว็บ
  useEffect(() => {
    if (id) loadData()
  }, [id])

  const loadData = async () => {
    try {
      setIsLoading(true)
      console.log("Fetching BOQ data for ID:", id) // Debug Log

      const [m, i, t] = await Promise.all([
        getHouseModelById(id),
        getBOQItems(id),
        getContractorTypes()
      ])

      console.log("Model Data:", m) // Debug Log
      
      if (m) setModel(m)
      if (i) setItems(i)
      if (t) setTypes(t)

    } catch (error) {
      console.error("Error loading BOQ Detail:", error)
    } finally {
      setIsLoading(false) // ✅ บังคับหยุดโหลดเสมอ
    }
  }

  const handleSubmit = async (formData: FormData) => {
    setIsModalOpen(false)
    startTransition(async () => {
      formData.append('house_model_id', id)
      await createBOQItem(formData)
      await loadData()
    })
  }

  const handleDelete = async (itemId: string) => {
    if (!confirm('ยืนยันลบรายการนี้?')) return
    startTransition(async () => {
      await deleteBOQItem(itemId, id)
      await loadData()
    })
  }

  // คำนวณราคารวม
  const grandTotal = items.reduce((sum, item) => sum + (item.total_price || 0), 0)

  // --- ส่วนแสดงผล ---

  // 1. กำลังโหลด
  if (isLoading) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดรายละเอียด BOQ...</p>
      </div>
    )
  }

  // 2. หาไม่เจอ
  if (!model) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-slate-500">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <h3 className="text-lg font-bold">ไม่พบข้อมูลแบบบ้าน</h3>
        <button onClick={() => router.push('/dashboard/boq')} className="text-indigo-600 hover:underline">
          กลับไปหน้ารวม
        </button>
      </div>
    )
  }

  // 3. แสดงผลปกติ
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <button 
            onClick={() => router.push('/dashboard/boq')}
            className="mb-2 flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600 transition"
          >
            <ArrowLeft className="h-4 w-4" /> ย้อนกลับ
          </button>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Layers className="text-indigo-600 h-6 w-6"/>
            {model.name}
          </h1>
          <p className="text-sm text-slate-500">
            รหัส: {model.code || '-'} | พื้นที่: {model.area || 0} ตร.ม.
          </p>
        </div>

        <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
                <div className="text-sm text-slate-500">ราคากลางรวม (BOQ)</div>
                <div className="text-xl font-bold text-emerald-600">฿{grandTotal.toLocaleString()}</div>
            </div>
            <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 shadow-sm transition"
            >
            <Plus className="h-4 w-4" />
            เพิ่มรายการ
            </button>
        </div>
      </div>

      {/* ตาราง BOQ */}
      <Card className="overflow-hidden border-0 shadow-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">รายการงาน</th>
                <th className="px-4 py-3 font-semibold">ประเภทช่าง</th>
                <th className="px-4 py-3 font-semibold text-right">จำนวน</th>
                <th className="px-4 py-3 font-semibold text-right">หน่วย</th>
                <th className="px-4 py-3 font-semibold text-right">ราคา/หน่วย</th>
                <th className="px-4 py-3 font-semibold text-right">รวมเป็นเงิน</th>
                <th className="px-4 py-3 font-semibold text-center w-12.5">ลบ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400 italic">
                    ยังไม่มีรายการ BOQ กดปุ่ม "เพิ่มรายการ" เพื่อเริ่มต้น
                  </td>
                </tr>
              ) : (
                items.map((item, index) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {index + 1}. {item.item_name}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            {item.contractor_types?.name || 'ทั่วไป'}
                        </span>
                    </td>
                    <td className="px-4 py-3 text-right">{item.quantity}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{item.unit}</td>
                    <td className="px-4 py-3 text-right">฿{item.price_per_unit?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-700">
                      ฿{(item.total_price || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleDelete(item.id)}
                        disabled={isPending}
                        className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500 transition"
                      >
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {/* Footer สรุปยอด */}
            {items.length > 0 && (
                <tfoot className="bg-slate-50 font-bold text-slate-800">
                    <tr>
                        <td colSpan={5} className="px-4 py-3 text-right">รวมทั้งสิ้น</td>
                        <td className="px-4 py-3 text-right text-emerald-600">฿{grandTotal.toLocaleString()}</td>
                        <td></td>
                    </tr>
                </tfoot>
            )}
          </table>
        </div>
      </Card>

      {/* Modal เพิ่มรายการ */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="เพิ่มรายการ BOQ"
      >
        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อรายการงาน</label>
            <input name="item_name" required className="w-full" placeholder="เช่น เทคอนกรีตฐานราก" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ประเภทช่าง</label>
            <select name="contractor_type_id" required className="w-full">
              <option value="">-- เลือกประเภทช่าง --</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">จำนวนปริมาณ</label>
              <input name="quantity" type="number" step="0.01" required className="w-full" placeholder="100" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">หน่วย</label>
              <input name="unit" required className="w-full" placeholder="ตร.ม. / เหมา" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ราคาต่อหน่วย (บาท)</label>
            <div className="relative">
                <Coins className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input name="price_per_unit" type="number" step="0.01" required className="w-full pl-9" placeholder="0.00" />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary">ยกเลิก</button>
            <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 shadow transition">บันทึกรายการ</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}