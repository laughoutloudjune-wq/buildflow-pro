'use client'

import { useState, type KeyboardEvent } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { createMaterialType } from '@/actions/material-actions'
import type { MaterialPickerOption } from '@/lib/types/materials'

/** Creating a material without leaving the purchase order line you're on.
 *
 * The modal this replaces threw away the name already typed into the picker's
 * search box and asked for it again, along with a price that gets typed a
 * second time on the line moments later and a category that is rarely known
 * mid-order. This keeps the typed name and asks only for the unit - the one
 * field with no good default and no natural moment later where a wrong value
 * gets noticed, since it follows the material onto every future order,
 * request and stock movement.
 *
 * Category and catalog price are deliberately not asked for. Both can be
 * filled in afterwards from Settings, which already has bulk "set category"
 * and "set unit" actions for exactly this tidying-up.
 *
 * Rendered inside the picker's dropdown (see SearchableSelect's renderCreate),
 * so focus never leaves the line. */
export default function InlineMaterialCreate({
  query,
  close,
  onCreated,
}: {
  /** Whatever has been typed into the picker's search box - becomes the
   * material's name, so it never has to be retyped. */
  query: string
  close: () => void
  onCreated: (material: MaterialPickerOption) => void
}) {
  const toast = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [unit, setUnit] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const name = query.trim()

  // Nothing typed yet means nothing to name the material after, so there is
  // no offer to make.
  if (!name) return null

  async function handleCreate() {
    if (!unit.trim()) {
      toast.error('กรุณาระบุหน่วยนับ')
      return
    }
    setIsSaving(true)
    try {
      // Price 0 on purpose: the real figure is typed on the order line
      // moments from now, and a guess here would look like a real catalog
      // price to every later order that prefills from it.
      const created = await createMaterialType(name, unit.trim(), 0)
      onCreated({ id: created.id, name: created.name, unit: created.unit, category: created.category })
      toast.success(`เพิ่ม "${created.name}" แล้ว`)
      setUnit('')
      setIsOpen(false)
      close()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'เพิ่มวัสดุไม่สำเร็จ')
    } finally {
      setIsSaving(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleCreate()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex w-full items-center gap-1.5 border-t border-slate-200 px-2 py-2 text-left text-sm font-medium text-indigo-600 hover:bg-indigo-50"
      >
        <Plus className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          เพิ่ม &ldquo;{name}&rdquo; เป็นวัสดุใหม่
        </span>
      </button>
    )
  }

  return (
    <div className="border-t border-slate-200 bg-slate-50 p-2">
      <div className="mb-1.5 truncate text-xs text-slate-500">
        ชื่อวัสดุ: <span className="font-medium text-slate-700">{name}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="หน่วยนับ เช่น ถุง, ตัน"
          className="min-w-0 flex-1 text-sm"
          disabled={isSaving}
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={isSaving || !unit.trim()}
          className="shrink-0 rounded bg-indigo-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'เพิ่ม'}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">ราคาและหมวดหมู่ตั้งได้ภายหลังที่ตั้งค่า &rsaquo; วัสดุ</p>
    </div>
  )
}
