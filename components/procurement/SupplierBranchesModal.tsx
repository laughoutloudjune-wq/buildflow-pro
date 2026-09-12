'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import {
  getSupplierBranches,
  createSupplierBranch,
  updateSupplierBranch,
  deactivateSupplierBranch,
} from '@/actions/procurement-actions'
import type { Supplier, SupplierBranch } from '@/lib/types/procurement'

const emptyDraft = { branch_code: '', name: '', address: '', phone: '', contact_name: '' }

const fieldLabel = 'mb-1 block text-xs font-medium text-slate-600'

/** Manage the สาขา of one supplier. A vendor with several branches shares one
 * juristic person and tax id, but each branch has its own branch code and
 * address, and the Thai tax invoice must name the one that sold the goods.
 * Suppliers with no branches here keep behaving as plain single-location
 * vendors - the purchase order form only shows a branch picker once rows
 * exist. */
export default function SupplierBranchesModal({
  supplier,
  onClose,
}: {
  supplier: Supplier
  onClose: () => void
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [branches, setBranches] = useState<SupplierBranch[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editing, setEditing] = useState<SupplierBranch | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [isFormOpen, setIsFormOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    getSupplierBranches(supplier.id)
      .then((rows) => {
        if (!cancelled) setBranches(rows)
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลสาขาไม่สำเร็จ')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier.id])

  async function reload() {
    setBranches(await getSupplierBranches(supplier.id))
  }

  function openCreate() {
    setEditing(null)
    setDraft(emptyDraft)
    setIsFormOpen(true)
  }

  function openEdit(branch: SupplierBranch) {
    setEditing(branch)
    setDraft({
      branch_code: branch.branch_code,
      name: branch.name,
      address: branch.address || '',
      phone: branch.phone || '',
      contact_name: branch.contact_name || '',
    })
    setIsFormOpen(true)
  }

  function handleSubmit() {
    if (!draft.name.trim() || !draft.branch_code.trim()) {
      toast.error('กรุณาระบุชื่อสาขาและรหัสสาขา')
      return
    }
    startTransition(async () => {
      try {
        if (editing) {
          await updateSupplierBranch(editing.id, draft)
          toast.success('แก้ไขสาขาเรียบร้อยแล้ว')
        } else {
          await createSupplierBranch({ ...draft, supplier_id: supplier.id })
          toast.success('เพิ่มสาขาเรียบร้อยแล้ว')
        }
        setIsFormOpen(false)
        await reload()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'บันทึกสาขาไม่สำเร็จ')
      }
    })
  }

  function handleDeactivate(branch: SupplierBranch) {
    startTransition(async () => {
      try {
        await deactivateSupplierBranch(branch.id)
        toast.success('ปิดใช้งานสาขาแล้ว')
        await reload()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ปิดใช้งานสาขาไม่สำเร็จ')
      }
    })
  }

  return (
    <Modal isOpen onClose={onClose} title={`สาขาของ ${supplier.name}`} panelClassName="max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          ใช้เมื่อผู้จำหน่ายรายนี้มีหลายสาขา เลขผู้เสียภาษีเดียวกันแต่คนละรหัสสาขาและที่อยู่
          เมื่อมีสาขาแล้ว หน้าสร้างใบสั่งซื้อจะให้เลือกสาขาที่ออกบิล และใบสั่งซื้อจะพิมพ์สาขานั้น
        </p>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : branches.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
            ยังไม่มีสาขา — ผู้จำหน่ายรายนี้ใช้ที่อยู่และรหัสสาขาในข้อมูลหลัก
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">สาขา</th>
                  <th className="w-24 px-3 py-2 font-medium">รหัส</th>
                  <th className="px-3 py-2 font-medium">ที่อยู่</th>
                  <th className="w-20 px-3 py-2 text-center font-medium">สถานะ</th>
                  <th className="w-20 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {branches.map((branch) => (
                  <tr key={branch.id} className={branch.is_active ? undefined : 'bg-slate-50/60'}>
                    <td className="px-3 py-2 text-slate-800">{branch.name}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {branch.branch_code}
                      {branch.branch_code === '00000' && (
                        <span className="ml-1 text-xs text-slate-400">(สนญ.)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{branch.address || '-'}</td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          branch.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {branch.is_active ? 'ใช้งาน' : 'ปิด'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => openEdit(branch)}
                        disabled={isPending}
                        className="rounded p-1 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                        title="แก้ไข"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {branch.is_active && (
                        <button
                          type="button"
                          onClick={() => handleDeactivate(branch)}
                          disabled={isPending}
                          className="rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                          title="ปิดใช้งาน"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isFormOpen ? (
          <div className="space-y-3 rounded-xl border border-slate-200 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>ชื่อสาขา</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full"
                  placeholder="เช่น สาขารังสิต"
                />
              </div>
              <div>
                <label className={fieldLabel}>รหัสสาขา</label>
                <input
                  value={draft.branch_code}
                  onChange={(e) => setDraft({ ...draft, branch_code: e.target.value })}
                  className="w-full"
                  placeholder="00000 (สำนักงานใหญ่)"
                />
              </div>
            </div>
            <div>
              <label className={fieldLabel}>ที่อยู่</label>
              <textarea
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                className="w-full"
                rows={2}
                placeholder="ที่อยู่ที่จะขึ้นบนใบสั่งซื้อ"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>ผู้ติดต่อ</label>
                <input
                  value={draft.contact_name}
                  onChange={(e) => setDraft({ ...draft, contact_name: e.target.value })}
                  className="w-full"
                />
              </div>
              <div>
                <label className={fieldLabel}>โทรศัพท์</label>
                <input
                  value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  className="w-full"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setIsFormOpen(false)} disabled={isPending}>
                ยกเลิก
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? 'บันทึก' : 'เพิ่มสาขา'}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            <Plus className="h-4 w-4" /> เพิ่มสาขา
          </button>
        )}

        <div className="flex justify-end border-t border-slate-100 pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            ปิด
          </Button>
        </div>
      </div>
    </Modal>
  )
}
