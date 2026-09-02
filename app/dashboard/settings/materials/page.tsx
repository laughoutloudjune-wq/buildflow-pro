'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, PackageCheck, PackageX, Pencil, Plus, RotateCcw, Tags, Trash2, Upload, X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import {
  bulkDeactivateMaterialTypes,
  bulkReactivateMaterialTypes,
  bulkSetMaterialCategory,
  bulkSetMaterialRequestable,
  bulkSetMaterialUnit,
  createMaterialType,
  deactivateMaterialType,
  getMaterialTypes,
  reactivateMaterialType,
  updateMaterialPrice,
  updateMaterialType,
} from '@/actions/material-actions'
import MaterialImportModal from '@/components/materials/MaterialImportModal'
import type { MaterialType } from '@/lib/types/materials'

const ALL_CATEGORIES = 'ทั้งหมด'
const UNCATEGORIZED = 'ไม่ระบุหมวดหมู่'
const CUSTOM_CATEGORY = 'อื่นๆ (ระบุใหม่)...'

export default function MaterialTypesPage() {
  const [materials, setMaterials] = useState<MaterialType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const toast = useToast()

  const [showInactive, setShowInactive] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES)
  const [search, setSearch] = useState('')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [editingMaterial, setEditingMaterial] = useState<MaterialType | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [unitDraft, setUnitDraft] = useState('')
  const [categoryDraft, setCategoryDraft] = useState('')
  const [isCustomCategory, setIsCustomCategory] = useState(false)
  const [priceDraft, setPriceDraft] = useState('0')
  const [reorderPointDraft, setReorderPointDraft] = useState('')
  const [isRequestableDraft, setIsRequestableDraft] = useState(true)

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [isBulkPending, setIsBulkPending] = useState(false)
  const [isBulkCategoryOpen, setIsBulkCategoryOpen] = useState(false)
  const [bulkCategoryDraft, setBulkCategoryDraft] = useState('')
  const [isBulkCategoryCustom, setIsBulkCategoryCustom] = useState(false)
  const [isBulkUnitOpen, setIsBulkUnitOpen] = useState(false)
  const [bulkUnitDraft, setBulkUnitDraft] = useState('')

  useEffect(() => {
    void loadMaterials()
  }, [])

  async function loadMaterials() {
    setIsLoading(true)
    try {
      // false = include deactivated rows too; this page manages both.
      const data = await getMaterialTypes(false)
      setMaterials(data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลวัสดุไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  const categories = useMemo(() => {
    const set = new Set(materials.map((m) => m.category || UNCATEGORIZED))
    return [ALL_CATEGORIES, ...Array.from(set).sort((a, b) => a.localeCompare(b, 'th'))]
  }, [materials])

  // Real category values only (no "ทั้งหมด"/"ไม่ระบุหมวดหมู่" filter sentinels)
  // for the add/edit modal's dropdown - picking from what already exists
  // keeps the catalog from accumulating near-duplicate spellings of the same
  // category over time.
  const existingCategories = useMemo(() => {
    const set = new Set(materials.map((m) => m.category).filter((c): c is string => !!c && c.trim() !== ''))
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'))
  }, [materials])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return materials.filter((m) => {
      if (!showInactive && !m.is_active) return false
      const cat = m.category || UNCATEGORIZED
      if (categoryFilter !== ALL_CATEGORIES && cat !== categoryFilter) return false
      if (term && !m.name.toLowerCase().includes(term)) return false
      return true
    })
  }, [materials, showInactive, categoryFilter, search])

  // Selection is scoped to what's currently visible - changing a filter
  // while rows are selected would otherwise let a bulk action silently touch
  // rows the user can no longer see and didn't mean to include.
  useEffect(() => {
    setSelected(new Set())
  }, [showInactive, categoryFilter, search])

  const filteredIds = useMemo(() => filtered.map((m) => m.id), [filtered])
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id))
  const someFilteredSelected = filteredIds.some((id) => selected.has(id))

  function toggleSelectAll() {
    setSelected((prev) => {
      if (allFilteredSelected) return new Set()
      return new Set(filteredIds)
    })
  }

  function toggleSelectOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openCreateModal() {
    setEditingMaterial(null)
    setNameDraft('')
    setUnitDraft('')
    setCategoryDraft('')
    setIsCustomCategory(false)
    setPriceDraft('0')
    setReorderPointDraft('')
    setIsRequestableDraft(true)
    setIsModalOpen(true)
  }

  function openEditModal(material: MaterialType) {
    setEditingMaterial(material)
    setNameDraft(material.name)
    setUnitDraft(material.unit)
    setCategoryDraft(material.category || '')
    // A material saved before the catalog had this category (e.g. imported
    // under a name no longer in use) should still show its real value, even
    // though it won't be in the dropdown's known-category list.
    setIsCustomCategory(!!material.category && !existingCategories.includes(material.category))
    setPriceDraft(String(material.current_price))
    setReorderPointDraft(material.reorder_point === null ? '' : String(material.reorder_point))
    setIsRequestableDraft(material.is_requestable)
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingMaterial(null)
  }

  function handleSubmit() {
    if (!nameDraft.trim()) {
      toast.error('กรุณาใส่ชื่อวัสดุ')
      return
    }
    const price = parseFloat(priceDraft)
    if (!Number.isFinite(price) || price < 0) {
      toast.error('กรุณาใส่ราคาที่ถูกต้อง')
      return
    }
    let reorderPoint: number | null = null
    if (reorderPointDraft.trim() !== '') {
      reorderPoint = parseFloat(reorderPointDraft)
      if (!Number.isFinite(reorderPoint) || reorderPoint < 0) {
        toast.error('กรุณาใส่จุดสั่งซื้อขั้นต่ำที่ถูกต้อง หรือเว้นว่างไว้')
        return
      }
    }

    startTransition(async () => {
      try {
        if (editingMaterial) {
          let updated = await updateMaterialType(
            editingMaterial.id,
            nameDraft,
            unitDraft,
            categoryDraft,
            reorderPoint,
            isRequestableDraft
          )
          if (price !== editingMaterial.current_price) {
            updated = await updateMaterialPrice(editingMaterial.id, price)
          }
          patchMaterial(updated)
        } else {
          const created = await createMaterialType(nameDraft, unitDraft, price, categoryDraft, reorderPoint, isRequestableDraft)
          insertMaterial(created)
        }
        closeModal()
        toast.success('บันทึกข้อมูลวัสดุเรียบร้อยแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ')
      }
    })
  }

  // Patch/insert the one row that changed instead of refetching and
  // re-rendering the whole (potentially 1000+ row) table on every click.
  function patchMaterial(updated: MaterialType) {
    setMaterials((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
  }

  function insertMaterial(created: MaterialType) {
    setMaterials((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'th')))
  }

  function patchMaterials(updated: MaterialType[]) {
    const byId = new Map(updated.map((m) => [m.id, m]))
    setMaterials((prev) => prev.map((m) => byId.get(m.id) || m))
  }

  function handleBulkDeactivate() {
    if (!confirm(`ยืนยันปิดใช้งานวัสดุที่เลือก ${selected.size} รายการ?`)) return
    setIsBulkPending(true)
    bulkDeactivateMaterialTypes(Array.from(selected))
      .then((updated) => {
        patchMaterials(updated)
        setSelected(new Set())
        toast.success(`ปิดใช้งานแล้ว ${updated.length} รายการ`)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'ปิดใช้งานไม่สำเร็จ'))
      .finally(() => setIsBulkPending(false))
  }

  function handleBulkReactivate() {
    setIsBulkPending(true)
    bulkReactivateMaterialTypes(Array.from(selected))
      .then((updated) => {
        patchMaterials(updated)
        setSelected(new Set())
        toast.success(`เปิดใช้งานแล้ว ${updated.length} รายการ`)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'เปิดใช้งานไม่สำเร็จ'))
      .finally(() => setIsBulkPending(false))
  }

  function handleBulkSetRequestable(isRequestable: boolean) {
    setIsBulkPending(true)
    bulkSetMaterialRequestable(Array.from(selected), isRequestable)
      .then((updated) => {
        patchMaterials(updated)
        setSelected(new Set())
        toast.success(`${isRequestable ? 'ทำเครื่องหมายว่าเบิกได้' : 'ทำเครื่องหมายว่ารับเข้าอย่างเดียว'}แล้ว ${updated.length} รายการ`)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'อัปเดตไม่สำเร็จ'))
      .finally(() => setIsBulkPending(false))
  }

  function openBulkCategoryModal() {
    setBulkCategoryDraft('')
    setIsBulkCategoryCustom(false)
    setIsBulkCategoryOpen(true)
  }

  function handleBulkCategorySubmit() {
    setIsBulkPending(true)
    bulkSetMaterialCategory(Array.from(selected), bulkCategoryDraft)
      .then((updated) => {
        patchMaterials(updated)
        setIsBulkCategoryOpen(false)
        setSelected(new Set())
        toast.success(`กำหนดหมวดหมู่แล้ว ${updated.length} รายการ`)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'กำหนดหมวดหมู่ไม่สำเร็จ'))
      .finally(() => setIsBulkPending(false))
  }

  function openBulkUnitModal() {
    setBulkUnitDraft('')
    setIsBulkUnitOpen(true)
  }

  function handleBulkUnitSubmit() {
    if (!bulkUnitDraft.trim()) {
      toast.error('กรุณาระบุหน่วย')
      return
    }
    setIsBulkPending(true)
    bulkSetMaterialUnit(Array.from(selected), bulkUnitDraft)
      .then((updated) => {
        patchMaterials(updated)
        setIsBulkUnitOpen(false)
        setSelected(new Set())
        toast.success(`กำหนดหน่วยแล้ว ${updated.length} รายการ`)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'กำหนดหน่วยไม่สำเร็จ'))
      .finally(() => setIsBulkPending(false))
  }

  function handleDeactivate(material: MaterialType) {
    if (!confirm(`ยืนยันปิดใช้งานวัสดุ "${material.name}"? รายการนี้จะไม่ปรากฏให้เลือกใหม่ แต่ประวัติเดิมยังอยู่ครบ`)) return
    startTransition(async () => {
      try {
        const updated = await deactivateMaterialType(material.id)
        patchMaterial(updated)
        toast.success('ปิดใช้งานวัสดุแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ปิดใช้งานไม่สำเร็จ')
      }
    })
  }

  function handleReactivate(material: MaterialType) {
    startTransition(async () => {
      try {
        const updated = await reactivateMaterialType(material.id)
        patchMaterial(updated)
        toast.success('เปิดใช้งานวัสดุแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'เปิดใช้งานไม่สำเร็จ')
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
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href="/dashboard/settings"
          className="mb-2 flex w-fit items-center gap-1 text-sm text-slate-500 transition hover:text-indigo-600"
        >
          <ArrowLeft className="h-4 w-4" /> กลับไปตั้งค่า
        </Link>
        <PageHeader
          title="รายการวัสดุ (Material Catalog)"
          subtitle="จัดการชื่อวัสดุ หน่วย หมวดหมู่ และราคาล่าสุดที่ใช้อ้างอิงเวลาบันทึกการใช้วัสดุในแต่ละงาน"
          actions={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setIsImportOpen(true)}>
                <Upload className="h-4 w-4" />
                นำเข้าจาก Excel
              </Button>
              <Button onClick={openCreateModal}>
                <Plus className="h-4 w-4" />
                เพิ่มวัสดุใหม่
              </Button>
            </div>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อวัสดุ..."
          className="w-56"
        />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-56">
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          แสดงรายการที่ปิดใช้งานแล้ว
        </label>
        <span className="ml-auto text-sm text-slate-400">{filtered.length} รายการ</span>
      </div>

      {selected.size > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-indigo-100 bg-indigo-50/60 px-4 py-3">
          <span className="text-sm font-medium text-indigo-800">เลือกแล้ว {selected.size} รายการ</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={openBulkUnitModal} disabled={isBulkPending}>
              กำหนดหน่วย
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={openBulkCategoryModal} disabled={isBulkPending}>
              <Tags className="h-3.5 w-3.5" />
              กำหนดหมวดหมู่
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => handleBulkSetRequestable(true)} disabled={isBulkPending}>
              <PackageCheck className="h-3.5 w-3.5" />
              เบิกได้
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => handleBulkSetRequestable(false)} disabled={isBulkPending}>
              <PackageX className="h-3.5 w-3.5" />
              รับเข้าอย่างเดียว
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={handleBulkReactivate} disabled={isBulkPending}>
              <RotateCcw className="h-3.5 w-3.5" />
              เปิดใช้งาน
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={handleBulkDeactivate} disabled={isBulkPending}>
              {isBulkPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              ปิดใช้งาน
            </Button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={isBulkPending}
              className="rounded p-1.5 text-indigo-400 transition hover:bg-indigo-100 hover:text-indigo-700"
              title="ล้างการเลือก"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-slate-700">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" checked={allFilteredSelected} ref={(el) => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected }} onChange={toggleSelectAll} disabled={filtered.length === 0} />
                </th>
                <th className="px-4 py-3 font-semibold">ชื่อวัสดุ</th>
                <th className="px-4 py-3 font-semibold">หมวดหมู่</th>
                <th className="px-4 py-3 font-semibold">หน่วย</th>
                <th className="px-4 py-3 text-right font-semibold">ราคาล่าสุด</th>
                <th className="px-4 py-3 text-right font-semibold">จุดสั่งซื้อขั้นต่ำ</th>
                <th className="px-4 py-3 font-semibold">อัปเดตราคาล่าสุดเมื่อ</th>
                <th className="px-4 py-3 w-[100px] text-center font-semibold">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center italic text-slate-400">
                    {materials.length === 0
                      ? 'ยังไม่มีวัสดุในระบบ กดปุ่ม "เพิ่มวัสดุใหม่" หรือ "นำเข้าจาก Excel" เพื่อเริ่มต้น'
                      : 'ไม่พบวัสดุที่ตรงกับตัวกรอง'}
                  </td>
                </tr>
              ) : (
                filtered.map((material) => (
                  <tr key={material.id} className={`transition-colors hover:bg-slate-50 ${!material.is_active ? 'opacity-50' : ''} ${selected.has(material.id) ? 'bg-indigo-50/50' : ''}`}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(material.id)} onChange={() => toggleSelectOne(material.id)} />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {material.name}
                      {!material.is_active && (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">ปิดใช้งาน</span>
                      )}
                      {!material.is_requestable && (
                        <span
                          className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                          title="รับเข้าอย่างเดียว - เบิกให้ผู้รับเหมาไม่ได้"
                        >
                          รับเข้าอย่างเดียว
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{material.category || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{material.unit}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-700">
                      ฿{formatCurrency(material.current_price)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {material.reorder_point === null ? '-' : material.reorder_point.toLocaleString('th-TH')}
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
                      {material.is_active ? (
                        <button
                          onClick={() => handleDeactivate(material)}
                          disabled={isPending}
                          className="rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                          title="ปิดใช้งาน"
                        >
                          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReactivate(material)}
                          disabled={isPending}
                          className="rounded p-1 text-slate-300 transition hover:bg-emerald-50 hover:text-emerald-600"
                          title="เปิดใช้งานอีกครั้ง"
                        >
                          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
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
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">หมวดหมู่</label>
            <select
              value={isCustomCategory ? CUSTOM_CATEGORY : categoryDraft}
              onChange={(e) => {
                if (e.target.value === CUSTOM_CATEGORY) {
                  setIsCustomCategory(true)
                  setCategoryDraft('')
                } else {
                  setIsCustomCategory(false)
                  setCategoryDraft(e.target.value)
                }
              }}
              className="w-full"
            >
              <option value="">ไม่ระบุ</option>
              {existingCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={CUSTOM_CATEGORY}>{CUSTOM_CATEGORY}</option>
            </select>
            {isCustomCategory && (
              <input
                value={categoryDraft}
                onChange={(e) => setCategoryDraft(e.target.value)}
                className="mt-2 w-full"
                placeholder="ระบุชื่อหมวดหมู่ใหม่"
                autoFocus
              />
            )}
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
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">จุดสั่งซื้อขั้นต่ำ (แจ้งเตือนเมื่อคงเหลือถึงจุดนี้)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={reorderPointDraft}
              onChange={(e) => setReorderPointDraft(e.target.value)}
              className="w-full"
              placeholder="เว้นว่างไว้ถ้ายังไม่ต้องการแจ้งเตือน"
            />
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isRequestableDraft}
                onChange={(e) => setIsRequestableDraft(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                อนุญาตให้เบิกวัสดุนี้ให้ผู้รับเหมาได้
                <span className="mt-0.5 block text-xs text-slate-500">
                  ปิดไว้สำหรับวัสดุที่ซื้อแล้วใช้ทันที ไม่ได้เก็บไว้เบิกทีหลัง เช่น อิฐมวลเบา หรือปูนถุง - ระบบจะยังนับยอดรับเข้าให้ตามปกติ
                  เพียงแต่ไม่มีขั้นตอนเบิกจ่ายให้ผู้รับเหมา
                </span>
              </span>
            </label>
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

      <MaterialImportModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} onImported={loadMaterials} />

      <Modal isOpen={isBulkCategoryOpen} onClose={() => setIsBulkCategoryOpen(false)} title={`กำหนดหมวดหมู่ให้ ${selected.size} รายการ`}>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">หมวดหมู่</label>
            <select
              value={isBulkCategoryCustom ? CUSTOM_CATEGORY : bulkCategoryDraft}
              onChange={(e) => {
                if (e.target.value === CUSTOM_CATEGORY) {
                  setIsBulkCategoryCustom(true)
                  setBulkCategoryDraft('')
                } else {
                  setIsBulkCategoryCustom(false)
                  setBulkCategoryDraft(e.target.value)
                }
              }}
              className="w-full"
            >
              <option value="">ไม่ระบุ</option>
              {existingCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={CUSTOM_CATEGORY}>{CUSTOM_CATEGORY}</option>
            </select>
            {isBulkCategoryCustom && (
              <input
                value={bulkCategoryDraft}
                onChange={(e) => setBulkCategoryDraft(e.target.value)}
                className="mt-2 w-full"
                placeholder="ระบุชื่อหมวดหมู่ใหม่"
                autoFocus
              />
            )}
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setIsBulkCategoryOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={handleBulkCategorySubmit} disabled={isBulkPending}>
              {isBulkPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึก'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isBulkUnitOpen} onClose={() => setIsBulkUnitOpen(false)} title={`กำหนดหน่วยให้ ${selected.size} รายการ`}>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">หน่วย</label>
            <input
              value={bulkUnitDraft}
              onChange={(e) => setBulkUnitDraft(e.target.value)}
              className="w-full"
              placeholder="เช่น ถุง, ก้อน, เมตร"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setIsBulkUnitOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={handleBulkUnitSubmit} disabled={isBulkPending}>
              {isBulkPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึก'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
