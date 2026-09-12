'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Building2, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import SupplierBranchesModal from '@/components/procurement/SupplierBranchesModal'
import { useToast } from '@/components/ui/Toast'
import SupplierFormFields from '@/components/procurement/SupplierFormFields'
import { createSupplier, deactivateSupplier, updateSupplier } from '@/actions/procurement-actions'
import type { Supplier, SupplierInput } from '@/lib/types/procurement'

const emptyDraft: SupplierInput = {
  name: '',
  supplier_type: 'company',
  contact_name: '',
  phone: '',
  email: '',
  address: '',
  tax_id: '',
  branch_code: '',
  payment_terms: '',
}

export default function SuppliersPageClient({
  suppliers,
  initialError,
}: {
  suppliers: Supplier[]
  initialError?: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  /** Which supplier's สาขา list is open, if any. */
  const [branchesFor, setBranchesFor] = useState<Supplier | null>(null)
  const [draft, setDraft] = useState<SupplierInput>(emptyDraft)

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  function openCreateModal() {
    setEditing(null)
    setDraft(emptyDraft)
    setIsModalOpen(true)
  }

  function openEditModal(supplier: Supplier) {
    setEditing(supplier)
    setDraft({
      name: supplier.name,
      supplier_type: supplier.supplier_type,
      contact_name: supplier.contact_name || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      address: supplier.address || '',
      tax_id: supplier.tax_id || '',
      branch_code: supplier.branch_code || '',
      payment_terms: supplier.payment_terms || '',
    })
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditing(null)
  }

  function handleSubmit() {
    if (!draft.name.trim()) {
      toast.error('กรุณาใส่ชื่อผู้จำหน่าย')
      return
    }
    startTransition(async () => {
      try {
        if (editing) {
          await updateSupplier(editing.id, draft)
        } else {
          await createSupplier(draft)
        }
        closeModal()
        router.refresh()
        toast.success('บันทึกข้อมูลผู้จำหน่ายเรียบร้อยแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ')
      }
    })
  }

  function handleDeactivate(supplier: Supplier) {
    if (!confirm(`ยืนยันปิดใช้งานผู้จำหน่าย "${supplier.name}"?`)) return
    startTransition(async () => {
      try {
        await deactivateSupplier(supplier.id)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ปิดใช้งานไม่สำเร็จ')
      }
    })
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
          title="ผู้จำหน่าย (Suppliers)"
          subtitle="รายชื่อผู้จำหน่ายวัสดุที่ใช้เลือกเวลาสร้างใบสั่งซื้อ"
          actions={
            <Button onClick={openCreateModal}>
              <Plus className="h-4 w-4" />
              เพิ่มผู้จำหน่ายใหม่
            </Button>
          }
        />
      </div>


      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">ชื่อผู้จำหน่าย</th>
                <th className="px-4 py-3 font-semibold">ประเภท</th>
                <th className="px-4 py-3 font-semibold">ผู้ติดต่อ</th>
                <th className="px-4 py-3 font-semibold">เงื่อนไขชำระเงิน</th>
                <th className="px-4 py-3 font-semibold">สถานะ</th>
                <th className="px-4 py-3 w-[80px] text-center font-semibold">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center italic text-slate-400">
                    ยังไม่มีผู้จำหน่ายในระบบ กดปุ่ม &quot;เพิ่มผู้จำหน่ายใหม่&quot; เพื่อเริ่มต้น
                  </td>
                </tr>
              ) : (
                suppliers.map((supplier) => (
                  <tr key={supplier.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{supplier.name}</td>
                    <td className="px-4 py-3 text-slate-500">{supplier.supplier_type === 'individual' ? 'บุคคลทั่วไป' : 'บริษัท/ห้างร้าน'}</td>
                    <td className="px-4 py-3 text-slate-500">{supplier.contact_name || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{supplier.payment_terms || '-'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          supplier.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {supplier.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setBranchesFor(supplier)}
                        disabled={isPending}
                        className="rounded p-1 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                        title="จัดการสาขา"
                      >
                        <Building2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => openEditModal(supplier)}
                        disabled={isPending}
                        className="rounded p-1 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                        title="แก้ไข"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {supplier.is_active && (
                        <button
                          onClick={() => handleDeactivate(supplier)}
                          disabled={isPending}
                          className="rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                          title="ปิดใช้งาน"
                        >
                          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {branchesFor && (
        <SupplierBranchesModal supplier={branchesFor} onClose={() => setBranchesFor(null)} />
      )}

      <Modal isOpen={isModalOpen} onClose={closeModal} title={editing ? 'แก้ไขผู้จำหน่าย' : 'เพิ่มผู้จำหน่ายใหม่'}>
        <div className="space-y-4">
          <p className="text-xs text-slate-400">เพิ่มซัพพลายเออร์ในนามบริษัทหรือบุคคลธรรมดา</p>
          <SupplierFormFields value={draft} onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))} />
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
