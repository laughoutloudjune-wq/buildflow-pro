'use client'

import { useState, useEffect, useTransition } from 'react'
import { Plus, Trash2, Pencil, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import { getContractorTypes, createContractorType, updateContractorType, deleteContractorType } from '@/actions/contractor-type-actions'

type ContractorType = {
  id: number;
  name: string;
};

export default function ContractorTypesPage() {
  const [types, setTypes] = useState<ContractorType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isEditing, setIsEditing] = useState<ContractorType | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    loadTypes()
  }, [])

  const loadTypes = async () => {
    setIsLoading(true)
    const contractorTypes = await getContractorTypes()
    setTypes(contractorTypes)
    setIsLoading(false)
  }

  const handleOpenModal = (type: ContractorType | null = null) => {
    setIsEditing(type)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setIsEditing(null)
  }

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      if (isEditing) {
        await updateContractorType(isEditing.id, formData)
      } else {
        await createContractorType(formData)
      }
      await loadTypes()
      handleCloseModal()
    })
  }

  const handleDelete = (id: number) => {
    if (!confirm('ยืนยันการลบประเภทช่างนี้?')) return
    startTransition(async () => {
      await deleteContractorType(id)
      await loadTypes()
    })
  }
  
  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-slate-500 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดข้อมูลประเภทช่าง...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">จัดการประเภทช่าง</h1>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 shadow-sm"
        >
          <Plus className="h-4 w-4" />
          เพิ่มประเภทใหม่
        </button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">#ID</th>
                <th className="px-4 py-3 font-semibold">ชื่อประเภท</th>
                <th className="px-4 py-3 font-semibold text-center w-[120px]">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {types.map((type) => (
                <tr key={type.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">{type.id}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{type.name}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => handleOpenModal(type)} className="p-1.5 rounded text-slate-500 hover:text-indigo-600 hover:bg-indigo-50">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleDelete(type.id)} className="p-1.5 rounded text-slate-500 hover:text-red-600 hover:bg-red-50" disabled={isPending}>
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      
      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={isEditing ? 'แก้ไขประเภทช่าง' : 'เพิ่มประเภทช่างใหม่'}
      >
        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อประเภท</label>
            <input 
              name="name" 
              required 
              className="w-full" 
              placeholder="เช่น ช่างไฟฟ้า, ช่างประปา"
              defaultValue={isEditing?.name || ''}
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={handleCloseModal} className="btn-secondary">ยกเลิก</button>
            <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 shadow transition" disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>

    </div>
  )
}
