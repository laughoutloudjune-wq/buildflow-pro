'use client'

import { useEffect, useState, useTransition } from 'react'
import { ArrowLeft, Loader2, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button, ButtonLink } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import {
  addPromotionItem,
  createPromotion,
  deletePromotionItem,
  setPromotionActive,
  updatePromotion,
  updatePromotionItem,
  type Promotion,
  type PromotionItem,
} from '@/actions/promotions-actions'

export default function PromotionsPageClient({
  initialPromotions,
  initialError,
  canManage,
}: {
  initialPromotions: Promotion[]
  initialError?: string | null
  canManage: boolean
}) {
  const [promotions, setPromotions] = useState<Promotion[]>(initialPromotions)
  const [isCreating, startCreating] = useTransition()
  const [isPending, startTransition] = useTransition()
  const [formKey, setFormKey] = useState(0)
  const [editingBundle, setEditingBundle] = useState<Promotion | null>(null)
  const [itemModalBundleId, setItemModalBundleId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<PromotionItem | null>(null)
  const [deleteItemTarget, setDeleteItemTarget] = useState<{ bundleId: string; item: PromotionItem } | null>(null)
  const toast = useToast()

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  function refetchNeeded() {
    // Item/bundle CRUD changes nested structure that's simpler to just
    // reload than reconcile client-side (unlike sale_statuses' flat list).
    window.location.reload()
  }

  function handleCreate(formData: FormData) {
    startCreating(async () => {
      const res = await createPromotion(formData)
      if (!res.success) {
        toast.error(res.error || 'เพิ่มโปรโมชั่นไม่สำเร็จ')
        return
      }
      toast.success(`เพิ่มโปรโมชั่น "${formData.get('name')}" แล้ว`)
      setFormKey((k) => k + 1)
      refetchNeeded()
    })
  }

  function handleSaveBundle(formData: FormData) {
    if (!editingBundle) return
    startTransition(async () => {
      const res = await updatePromotion(editingBundle.id, formData)
      if (!res.success) {
        toast.error(res.error || 'บันทึกไม่สำเร็จ')
        return
      }
      toast.success('บันทึกแล้ว')
      setEditingBundle(null)
      refetchNeeded()
    })
  }

  function handleToggleActive(bundle: Promotion) {
    startTransition(async () => {
      const res = await setPromotionActive(bundle.id, !bundle.isActive)
      if (!res.success) {
        toast.error(res.error || 'เปลี่ยนสถานะไม่สำเร็จ')
        return
      }
      setPromotions((prev) => prev.map((p) => (p.id === bundle.id ? { ...p, isActive: !p.isActive } : p)))
      toast.success(bundle.isActive ? `ปิดใช้งาน "${bundle.name}" แล้ว` : `เปิดใช้งาน "${bundle.name}" แล้ว`)
    })
  }

  function openAddItem(bundleId: string) {
    setItemModalBundleId(bundleId)
    setEditingItem(null)
  }

  function openEditItem(bundleId: string, item: PromotionItem) {
    setItemModalBundleId(bundleId)
    setEditingItem(item)
  }

  function handleSaveItem(formData: FormData) {
    if (!itemModalBundleId) return
    startTransition(async () => {
      const res = editingItem
        ? await updatePromotionItem(editingItem.id, formData)
        : await addPromotionItem(itemModalBundleId, formData)
      if (!res.success) {
        toast.error(res.error || 'บันทึกไม่สำเร็จ')
        return
      }
      toast.success('บันทึกรายการแล้ว')
      setItemModalBundleId(null)
      setEditingItem(null)
      refetchNeeded()
    })
  }

  function handleDeleteItem() {
    if (!deleteItemTarget) return
    startTransition(async () => {
      const res = await deletePromotionItem(deleteItemTarget.item.id)
      if (!res.success) {
        toast.error(res.error || 'ลบไม่สำเร็จ')
        return
      }
      setDeleteItemTarget(null)
      refetchNeeded()
    })
  }

  const sorted = [...promotions].sort((a, b) => a.name.localeCompare(b.name, 'th'))

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-indigo-600">
            <Tag className="h-4 w-4" aria-hidden />
            ฝ่ายขาย
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">โปรโมชั่น</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            แต่ละโปรโมชั่นเป็นชุด (bundle) ของรายการของแถม แต่ละรายการมีมูลค่าของตัวเอง เช่น
            &quot;แถมแอร์ 4 เครื่อง = 48,000 บาท&quot; + &quot;แถมบ้านตกแต่งครบ = 200,000 บาท&quot;
            เมื่อนำไปใช้กับดีลจริง ฝ่ายขายปรับรายการ/มูลค่า หรือเพิ่มรายการเองได้ตามที่เจรจากับลูกค้า
          </p>
        </div>
        <ButtonLink href="/dashboard/sales" variant="secondary">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          กลับไปผังการขาย
        </ButtonLink>
      </div>

      {canManage && (
        <Card className="border-slate-200 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">เพิ่มโปรโมชั่นใหม่ (bundle)</h2>
          <form key={formKey} action={handleCreate} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input name="name" required placeholder="ชื่อโปรโมชั่น เช่น โปรโมชั่นหลัก" className="sm:col-span-1" />
            <input name="description" placeholder="รายละเอียด / เงื่อนไข (ถ้ามี)" className="sm:col-span-1" />
            <Button type="submit" disabled={isCreating} className="sm:w-fit">
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              เพิ่มโปรโมชั่น
            </Button>
          </form>
        </Card>
      )}

      {sorted.length === 0 && (
        <Card className="p-8 text-center text-slate-400">ยังไม่มีโปรโมชั่น</Card>
      )}

      {sorted.map((bundle) => {
        const total = bundle.items.reduce((s, i) => s + i.value, 0)
        return (
          <Card key={bundle.id} className={`overflow-hidden border-slate-200 shadow-sm ${!bundle.isActive ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-900">{bundle.name}</h3>
                  {!bundle.isActive && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">ปิดใช้งาน</span>}
                </div>
                {bundle.description && <p className="mt-1 text-sm text-slate-500">{bundle.description}</p>}
                <p className="mt-1 text-xs text-slate-400">{bundle.items.length} รายการ - มูลค่ารวม ฿{formatCurrency(total)}</p>
              </div>
              {canManage && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditingBundle(bundle)}>
                    <Pencil className="h-3.5 w-3.5" /> แก้ไข
                  </Button>
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={bundle.isActive}
                      disabled={isPending}
                      onChange={() => handleToggleActive(bundle)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    ใช้งาน
                  </label>
                </div>
              )}
            </div>

            <div className="p-5">
              {bundle.items.length === 0 ? (
                <p className="text-sm text-slate-400">ยังไม่มีรายการของแถมในโปรโมชั่นนี้</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {bundle.items.map((item) => (
                      <tr key={item.id}>
                        <td className="py-1.5 pr-2 text-slate-700">{item.name}</td>
                        <td className="py-1.5 pr-2 text-right font-medium text-slate-700">฿{formatCurrency(item.value)}</td>
                        {canManage && (
                          <td className="py-1.5 pl-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button type="button" onClick={() => openEditItem(bundle.id, item)} className="text-slate-300 hover:text-indigo-600">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteItemTarget({ bundleId: bundle.id, item })}
                                className="text-slate-300 hover:text-red-500"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {canManage && (
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => openAddItem(bundle.id)}>
                  <Plus className="h-3.5 w-3.5" /> เพิ่มรายการของแถม
                </Button>
              )}
            </div>
          </Card>
        )
      })}

      <Modal isOpen={editingBundle !== null} onClose={() => setEditingBundle(null)} title="แก้ไขโปรโมชั่น">
        {editingBundle && (
          <form action={handleSaveBundle} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อโปรโมชั่น</label>
              <input name="name" required defaultValue={editingBundle.name} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">รายละเอียด / เงื่อนไข</label>
              <textarea name="description" rows={2} defaultValue={editingBundle.description ?? ''} className="w-full" />
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button type="button" variant="secondary" onClick={() => setEditingBundle(null)}>ยกเลิก</Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                บันทึก
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        isOpen={itemModalBundleId !== null}
        onClose={() => { setItemModalBundleId(null); setEditingItem(null) }}
        title={editingItem ? 'แก้ไขรายการของแถม' : 'เพิ่มรายการของแถม'}
      >
        <form key={editingItem?.id || 'new'} action={handleSaveItem} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อรายการ</label>
            <input name="name" required placeholder="เช่น แอร์ 12,000 BTU 1 เครื่อง" className="w-full" defaultValue={editingItem?.name} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">มูลค่า (บาท)</label>
            <input type="number" min="0" step="0.01" name="value" required className="w-full" defaultValue={editingItem?.value} />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => { setItemModalBundleId(null); setEditingItem(null) }}>ยกเลิก</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              บันทึก
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteItemTarget !== null}
        title="ลบรายการ"
        message={deleteItemTarget ? `ลบรายการ "${deleteItemTarget.item.name}" ใช่ไหม?` : ''}
        confirmLabel={isPending ? 'กำลังลบ...' : 'ลบ'}
        cancelLabel="ยกเลิก"
        tone="danger"
        busy={isPending}
        onCancel={() => setDeleteItemTarget(null)}
        onConfirm={handleDeleteItem}
      />
    </div>
  )
}
