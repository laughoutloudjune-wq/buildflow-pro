'use client'

import { useState, useEffect, useTransition } from 'react'
import { Plus, Trash2, Loader2, HardHat, Phone, CreditCard, User } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import { getContractors, getContractorTypes, createContractor, deleteContractor } from '@/actions/contractor-actions'

export default function ContractorsPage() {
  // State สำหรับข้อมูล
  const [contractors, setContractors] = useState<any[]>([])
  const [types, setTypes] = useState<any[]>([])
  
  // State สำหรับ UI
  const [isModalOpen, setIsModalOpen] = useState(false)
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

  // ฟังก์ชันบันทึก
  const handleSubmit = async (formData: FormData) => {
    setIsModalOpen(false)
    startTransition(async () => {
      await createContractor(formData)
      await loadData() // รีโหลดข้อมูลใหม่
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
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition shadow-sm"
        >
          <Plus className="h-4 w-4" />
          เพิ่มผู้รับเหมา
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {contractors.map((c) => (
          <Card key={c.id} className="group relative overflow-hidden hover:border-indigo-300 transition-all p-5">
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
              <button 
                onClick={() => handleDelete(c.id)}
                disabled={isPending}
                className="text-slate-300 hover:text-red-500 p-1 rounded hover:bg-red-50 transition"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4" />}
              </button>
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
          </Card>
        ))}

        {contractors.length === 0 && (
          <div className="col-span-full py-12 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 text-slate-400">
            ยังไม่มีข้อมูลผู้รับเหมา
          </div>
        )}
      </div>

      {/* Modal เพิ่มผู้รับเหมา */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="เพิ่มผู้รับเหมาใหม่"
      >
        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อ-นามสกุล / ชื่อทีม</label>
            <input name="name" required className="w-full" placeholder="เช่น ทีมช่างสมชาย" />
          </div>
          
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ประเภทงาน</label>
            <select name="type_id" required className="w-full">
              <option value="">-- เลือกประเภท --</option>
              {types.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">เบอร์โทรศัพท์</label>
              <input name="phone" className="w-full" placeholder="08x-xxxxxxx" />
            </div>
            <div>
               <label className="mb-1 block text-sm font-medium text-slate-700">เลขผู้เสียภาษี/ปชช.</label>
               <input name="tax_id" className="w-full" placeholder="13 หลัก" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">เลขบัญชีธนาคาร</label>
            <input name="bank_account" className="w-full" placeholder="ธนาคาร - เลขบัญชี" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary">ยกเลิก</button>
            <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700">บันทึก</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}