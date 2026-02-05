'use client'

import { useState, useEffect, useTransition } from 'react'
import { Plus, Trash2, Loader2, HardHat, Phone, CreditCard, User, Pencil } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import { getContractors, createContractor, deleteContractor, updateContractor } from '@/actions/contractor-actions'
import { getContractorTypes } from '@/actions/contractor-type-actions'

type Contractor = any; // You can define a more specific type if you have one

export default function ContractorsPage() {
  // State สำหรับข้อมูล
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [types, setTypes] = useState<any[]>([])
  
  // State สำหรับ UI
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingContractor, setEditingContractor] = useState<Contractor | null>(null)
  const [isPending, startTransition] = useTransition()

  // โหลดข้อมูลเมื่อเข้าหน้าเว็บ
  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const [cData, tData] = await Promise.all([getContractors(), getContractorTypes()])
    if (cData) setContractors(cData)
    if (tData) setTypes(tData)
  }

  const openModal = (contractor: Contractor | null = null) => {
    setEditingContractor(contractor)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setEditingContractor(null)
    setIsModalOpen(false)
  }

  // ฟังก์ชันบันทึก (สร้างหรืออัปเดต)
  const handleSubmit = async (formData: FormData) => {
    closeModal()
    startTransition(async () => {
      if (editingContractor) {
        await updateContractor(editingContractor.id, formData)
      } else {
        await createContractor(formData)
      }
      await loadData()
    })
  }

  // ฟังก์ชันลบ
  const handleDelete = async (id: string) => {
    if(!confirm('ยืนยันลบผู้รับเหมารายนี้?')) return
    startTransition(async () => {
      await deleteContractor(id)
      await loadData()
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">ผู้รับเหมา</h1>
          <p className="text-sm text-slate-500">จัดการรายชื่อช่างและทีมงาน</p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition shadow-sm"
        >
          <Plus className="h-4 w-4" />
          เพิ่มผู้รับเหมา
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {contractors.map((c) => (
          <Card key={c.id} className="group relative overflow-hidden hover:border-indigo-300 transition-all p-5 flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
                    <User className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800">{c.name}</h3>
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                      {c.contractor_types?.name || 'ไม่ระบุประเภท'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                   <button 
                    onClick={() => openModal(c)}
                    className="text-slate-300 hover:text-indigo-500 p-1 rounded hover:bg-indigo-50 transition"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button 
                    onClick={() => handleDelete(c.id)}
                    disabled={isPending}
                    className="text-slate-300 hover:text-red-500 p-1 rounded hover:bg-red-50 transition"
                  >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2 text-sm text-slate-500 mt-4 pt-4 border-t border-slate-50">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-slate-400" />
                  {c.phone || '-'}
                </div>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-slate-400" />
                  {c.bank_account || '-'}
                </div>
                <div className="flex items-center gap-2">
                  <HardHat className="h-4 w-4 text-slate-400" />
                  <span className="truncate">เลขภาษี: {c.tax_id || '-'}</span>
                </div>
              </div>
            </div>
          </Card>
        ))}

        {contractors.length === 0 && (
          <div className="col-span-full py-12 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 text-slate-400">
            ยังไม่มีข้อมูลผู้รับเหมา
          </div>
        )}
      </div>

      {/* Modal เพิ่ม/แก้ไข ผู้รับเหมา */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingContractor ? 'แก้ไขข้อมูลผู้รับเหมา' : 'เพิ่มผู้รับเหมาใหม่'}
      >
        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อ-นามสกุล / ชื่อทีม</label>
            <input name="name" required className="w-full" placeholder="เช่น ทีมช่างสมชาย" defaultValue={editingContractor?.name} />
          </div>
          
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ประเภทงาน</label>
            <select name="type_id" required className="w-full" defaultValue={editingContractor?.type_id}>
              <option value="">-- เลือกประเภท --</option>
              {types.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">เบอร์โทรศัพท์</label>
              <input name="phone" className="w-full" placeholder="08x-xxxxxxx" defaultValue={editingContractor?.phone} />
            </div>
            <div>
               <label className="mb-1 block text-sm font-medium text-slate-700">เลขผู้เสียภาษี/ปชช.</label>
               <input name="tax_id" className="w-full" placeholder="13 หลัก" defaultValue={editingContractor?.tax_id} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">เลขบัญชีธนาคาร</label>
            <input name="bank_account" className="w-full" placeholder="ธนาคาร - เลขบัญชี" defaultValue={editingContractor?.bank_account} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={closeModal} className="btn-secondary">ยกเลิก</button>
            <button type="submit" disabled={isPending} className="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700">
              {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}