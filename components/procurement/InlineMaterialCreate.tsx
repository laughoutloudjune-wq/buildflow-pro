'use client'

import { useState, type KeyboardEvent } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { createMaterialType } from '@/actions/material-actions'
import type { MaterialPickerOption } from '@/lib/types/materials'

type Step = 'closed' | 'unit' | 'category'

const CUSTOM_CATEGORY = '__custom__'

/** Creating a material without leaving the purchase order line you're on.
 *
 * The modal this replaces threw away the name already typed into the picker's
 * search box and asked for it again, along with a price that gets typed a
 * second time on the line moments later. This keeps the typed name and asks
 * for the unit first - the one field with no good default - then a second,
 * skippable step for category: a buyer who doesn't know it yet isn't
 * blocked, but one who does can set it without a trip to Settings later.
 *
 * Rendered inside the picker's dropdown (see SearchableSelect's renderCreate),
 * so focus never leaves the line. */
export default function InlineMaterialCreate({
  query,
  categories,
  close,
  onCreated,
}: {
  /** Whatever has been typed into the picker's search box - becomes the
   * material's name, so it never has to be retyped. */
  query: string
  /** Existing category names, for the second step's picklist. */
  categories: string[]
  close: () => void
  onCreated: (material: MaterialPickerOption) => void
}) {
  const toast = useToast()
  const [step, setStep] = useState<Step>('closed')
  const [unit, setUnit] = useState('')
  const [category, setCategory] = useState('')
  const [isCustomCategory, setIsCustomCategory] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const name = query.trim()

  // Nothing typed yet means nothing to name the material after, so there is
  // no offer to make.
  if (!name) return null

  function reset() {
    setStep('closed')
    setUnit('')
    setCategory('')
    setIsCustomCategory(false)
  }

  function handleUnitNext() {
    if (!unit.trim()) {
      toast.error('กรุณาระบุหน่วยนับ')
      return
    }
    setStep('category')
  }

  async function handleCreate() {
    setIsSaving(true)
    try {
      // Price 0 on purpose: the real figure is typed on the order line
      // moments from now, and a guess here would look like a real catalog
      // price to every later order that prefills from it.
      const created = await createMaterialType(name, unit.trim(), 0, category.trim() || undefined)
      onCreated({ id: created.id, name: created.name, unit: created.unit, category: created.category })
      toast.success(`เพิ่ม "${created.name}" แล้ว`)
      reset()
      close()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'เพิ่มวัสดุไม่สำเร็จ')
    } finally {
      setIsSaving(false)
    }
  }

  function handleUnitKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleUnitNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      reset()
    }
  }

  function handleCategoryKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleCreate()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      reset()
    }
  }

  if (step === 'closed') {
    return (
      <button
        type="button"
        onClick={() => setStep('unit')}
        className="flex w-full items-center gap-1.5 border-t border-slate-200 px-2 py-2 text-left text-sm font-medium text-indigo-600 hover:bg-indigo-50"
      >
        <Plus className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          เพิ่ม &ldquo;{name}&rdquo; เป็นวัสดุใหม่
        </span>
      </button>
    )
  }

  if (step === 'unit') {
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
            onKeyDown={handleUnitKeyDown}
            placeholder="หน่วยนับ เช่น ถุง, ตัน"
            className="min-w-0 flex-1 text-sm"
            disabled={isSaving}
          />
          <button
            type="button"
            onClick={handleUnitNext}
            disabled={isSaving || !unit.trim()}
            className="shrink-0 rounded bg-indigo-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            ถัดไป
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-slate-200 bg-slate-50 p-2">
      <div className="mb-1.5 truncate text-xs text-slate-500">
        ชื่อวัสดุ: <span className="font-medium text-slate-700">{name}</span> • หน่วย:{' '}
        <span className="font-medium text-slate-700">{unit.trim()}</span>
      </div>
      <label className="mb-1 block text-[11px] font-medium text-slate-500">หมวดหมู่ (ไม่บังคับ)</label>
      <select
        autoFocus
        value={isCustomCategory ? CUSTOM_CATEGORY : category}
        onChange={(e) => {
          if (e.target.value === CUSTOM_CATEGORY) {
            setIsCustomCategory(true)
            setCategory('')
          } else {
            setIsCustomCategory(false)
            setCategory(e.target.value)
          }
        }}
        className="w-full text-sm"
        disabled={isSaving}
      >
        <option value="">ไม่ระบุ</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value={CUSTOM_CATEGORY}>อื่นๆ (ระบุใหม่)...</option>
      </select>
      {isCustomCategory && (
        <input
          autoFocus
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          onKeyDown={handleCategoryKeyDown}
          className="mt-1.5 w-full text-sm"
          placeholder="ระบุชื่อหมวดหมู่ใหม่"
          disabled={isSaving}
        />
      )}
      <div className="mt-1.5 flex items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={() => setStep('unit')}
          disabled={isSaving}
          className="shrink-0 rounded px-2 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-40"
        >
          ย้อนกลับ
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={isSaving}
          className="shrink-0 rounded bg-indigo-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'เพิ่ม'}
        </button>
      </div>
    </div>
  )
}
