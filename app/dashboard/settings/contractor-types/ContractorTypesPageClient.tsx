'use client'

import { useEffect, useState, useTransition } from 'react'
import ActionMenu from '@/components/ui/ActionMenu'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Pencil, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { createContractorType, updateContractorType, deleteContractorType } from '@/actions/contractor-type-actions'
import { TableFrame } from '@/components/ui/TableFrame'

type ContractorType = {
  id: number;
  name: string;
};

export default function ContractorTypesPageClient({
  types,
  initialError,
}: {
  types: ContractorType[]
  initialError?: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isEditing, setIsEditing] = useState<ContractorType | null>(null)
  const [isPending, startTransition] = useTransition()
  const [deleteTarget, setDeleteTarget] = useState<ContractorType | null>(null)

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

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
      router.refresh()
      handleCloseModal()
    })
  }

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    const id = deleteTarget.id
    startTransition(async () => {
      await deleteContractorType(id)
      setDeleteTarget(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="จัดการประเภทช่าง"
        actions={
          <Button onClick={() => handleOpenModal()}>
            <Plus className="h-4 w-4" />
            เพิ่มประเภทใหม่
          </Button>
        }
      />

      <TableFrame>
        <table>
            <thead>
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
                      <ActionMenu
                        label={`ตัวเลือกของ ${type.name}`}
                        items={[
                          { label: 'แก้ไข', icon: <Pencil />, onClick: () => handleOpenModal(type) },
                          { label: 'ลบ', icon: <Trash2 />, danger: true, disabled: isPending, onClick: () => setDeleteTarget(type) },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      </TableFrame>

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
            <Button type="button" variant="secondary" onClick={handleCloseModal}>ยกเลิก</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึก'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="ลบประเภทช่าง"
        message={deleteTarget ? `ยืนยันการลบประเภทช่าง "${deleteTarget.name}"?` : ''}
        confirmLabel={isPending ? 'กำลังลบ...' : 'ลบ'}
        cancelLabel="ยกเลิก"
        tone="danger"
        busy={isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}
