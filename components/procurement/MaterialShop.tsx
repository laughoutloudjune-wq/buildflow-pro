'use client'

import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  Bath,
  BrickWall,
  BriefcaseMedical,
  Bolt,
  Camera,
  Construction,
  CookingPot,
  ChevronLeft,
  DoorOpen,
  Droplets,
  Fence,
  Grid2x2,
  Hammer,
  HardHat,
  House,
  Layers,
  Minus,
  Package,
  Paintbrush,
  PenLine,
  Plus,
  Search,
  ShoppingCart,
  SprayCan,
  TreePine,
  Truck,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { canEditMaterialImages, getMaterialImages, getMaterialPopularity, uploadMaterialImage } from '@/actions/material-actions'
import { useToast } from '@/components/ui/Toast'
import type { MaterialPickerOption } from '@/lib/types/materials'
import type { BoqRemainingRow } from '@/actions/procurement/boq-control'
import {
  highlightParts,
  indexMaterials,
  refineWords,
  searchMaterials,
  type IndexedMaterial,
} from '@/lib/procurement/materialSearch'

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 })
const PAGE = 60
const POPULAR_MIN = 4

type Row = IndexedMaterial<MaterialPickerOption> & { approximate?: boolean }

// A picture for materials that have no photo yet: one icon per category,
// matched on words in the (existing) category name.
const CATEGORY_ICONS: [RegExp, LucideIcon][] = [
  [/ท่อ|ประปา/, Droplets],
  [/เหล็ก|โลหะ/, Construction],
  [/สกรู|ตะปู|พุก|น็อต|ยึด/, Bolt],
  [/สี|กาว|เคลือบ/, Paintbrush],
  [/เครื่องมือ/, Hammer],
  [/หลังคา|ฝ้า|ผนัง/, House],
  [/เครื่องเขียน|สำนักงาน/, PenLine],
  [/ทำความสะอาด/, SprayCan],
  [/ปูน|คอนกรีต|มวลรวม/, Layers],
  [/อิฐ|บล็อก/, BrickWall],
  [/กระเบื้อง|ปูพื้น/, Grid2x2],
  [/ประตู|หน้าต่าง/, DoorOpen],
  [/ไฟฟ้า/, Zap],
  [/สุขภัณฑ์|ห้องน้ำ/, Bath],
  [/ไม้/, TreePine],
  [/บริการ|ขนส่ง|ค่าแรง/, Truck],
  [/ครัว|ภาชนะ/, CookingPot],
  [/รั้ว|นั่งร้าน/, Fence],
  [/พยาบาล/, BriefcaseMedical],
  [/นิรภัย/, HardHat],
]
function categoryIcon(category: string): LucideIcon {
  return CATEGORY_ICONS.find(([re]) => re.test(category))?.[1] || Package
}

/** Shrink a phone photo to at most 640px on its long side, as JPEG. */
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('แปลงรูปไม่สำเร็จ'))), 'image/jpeg', 0.8))
}

/**
 * The "shop" for picking materials on a purchase request (mockup tab 22):
 * no typing needed (BOQ items for the plots, then the most requested, then
 * categories), a forgiving search (see lib/procurement/materialSearch), "+ ใส่"
 * then a −/+ stepper per item, and the basket count always at the bottom.
 * Only materials already in the catalog can be picked. The basket IS the
 * form's lines - this component only reads and changes them.
 */
export default function MaterialShop({
  isOpen,
  onClose,
  materials,
  remainingByMaterial,
  scopeLabel,
  quantities,
  units,
  onAdd,
  onSetQuantity,
}: {
  isOpen: boolean
  onClose: () => void
  materials: MaterialPickerOption[]
  remainingByMaterial: Map<number, BoqRemainingRow>
  /** "แปลง 103, 104" - who the request is for; null for store/overhead. */
  scopeLabel: string | null
  /** Requested quantity per material already in the basket (first line). */
  quantities: Map<number, string>
  /** The line's unit per material in the basket (to compare with the BOQ). */
  units: Map<number, string>
  onAdd: (material: MaterialPickerOption) => void
  /** 0 removes the material from the basket; '' keeps it while typing. */
  onSetQuantity: (materialId: number, quantity: string) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [onlyBoq, setOnlyBoq] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [popularity, setPopularity] = useState<Map<number, number>>(new Map())
  const [popularityLoaded, setPopularityLoaded] = useState(false)
  const [images, setImages] = useState<Record<number, string>>({})
  const [canEditImages, setCanEditImages] = useState(false)
  const [uploadingId, setUploadingId] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null)
  const toast = useToast()

  useEffect(() => {
    if (!isOpen || popularityLoaded) return
    let cancelled = false
    Promise.all([getMaterialPopularity(), getMaterialImages().catch(() => ({})), canEditMaterialImages().catch(() => false)])
      .then(([counts, imgs, canEdit]) => {
        if (cancelled) return
        setPopularity(new Map(Object.entries(counts).map(([id, n]) => [Number(id), n])))
        setImages(imgs)
        setCanEditImages(canEdit)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPopularityLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, popularityLoaded])

  const index = useMemo(() => indexMaterials(materials, popularity), [materials, popularity])
  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of index) counts.set(r.category, (counts.get(r.category) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [index])
  const boqIds = useMemo(() => new Set(remainingByMaterial.keys()), [remainingByMaterial])

  // Typo matching can take a moment on a slow phone; typing stays smooth
  // because results follow the deferred copy of the query.
  const searchQuery = useDeferredValue(query)
  const browsing = !searchQuery.trim() && category == null && !onlyBoq

  const result = useMemo(() => {
    if (browsing) return null
    const pool = category == null ? index : index.filter((r) => r.category === category)
    const res = searchMaterials(pool, searchQuery, { boqIds })
    const rows = onlyBoq ? res.rows.filter((r) => boqIds.has(r.item.id)) : res.rows
    return { ...res, rows }
  }, [browsing, index, category, searchQuery, boqIds, onlyBoq])

  const refine = useMemo(
    () => (result && (searchQuery.trim() || category != null) ? refineWords(result.rows.slice(0, 200), result.tokens) : []),
    [result, searchQuery, category]
  )

  const home = useMemo(() => {
    if (!browsing) return null
    const ranked = searchMaterials(index, '', { boqIds }).rows
    const boq = ranked.filter((r) => boqIds.has(r.item.id))
    const popular = index
      .filter((r) => !boqIds.has(r.item.id) && r.popularity > 0)
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 8)
    return { boq, popular }
  }, [browsing, index, boqIds])

  function changeQuery(q: string) {
    setQuery(q)
    setLimit(PAGE)
  }
  function pickCategory(c: string | null) {
    setCategory(c)
    setShowCategories(false)
    setLimit(PAGE)
  }
  function resetAndClose() {
    onClose()
  }

  const basketCount = quantities.size
  const tokens = result?.tokens || []

  async function uploadPhoto(materialId: number, file: File) {
    setUploadingId(materialId)
    try {
      const small = await shrinkImage(file).catch(() => file)
      const form = new FormData()
      form.append('file', new File([small], 'photo.jpg', { type: small.type || 'image/jpeg' }))
      const res = await uploadMaterialImage(materialId, form)
      if ('error' in res) toast.error(res.error)
      else {
        setImages((prev) => ({ ...prev, [materialId]: res.url }))
        toast.success('บันทึกรูปแล้ว')
      }
    } finally {
      setUploadingId(null)
    }
  }

  function renderThumb(r: Row) {
    const url = images[r.item.id]
    const Icon = categoryIcon(r.category)
    const box = 'relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-400'
    const picture = url ? (
      // eslint-disable-next-line @next/next/no-img-element -- small public storage thumbnails; no Next image optimisation needed
      <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
    ) : (
      <Icon className="h-6 w-6" aria-hidden />
    )
    if (url && !canEditImages) {
      return (
        <button type="button" className={box} aria-label={`ดูรูป ${r.item.name}`} onClick={() => setPreview({ url, name: r.item.name })}>
          {picture}
        </button>
      )
    }
    if (!canEditImages) return <div className={box}>{picture}</div>
    return (
      <label className={`${box} cursor-pointer`} title={url ? 'เปลี่ยนรูป' : 'เพิ่มรูป'}>
        {picture}
        <span className="absolute bottom-0 right-0 rounded-tl-md bg-white/90 p-0.5 text-indigo-600">
          <Camera className="h-3 w-3" aria-hidden />
        </span>
        {uploadingId === r.item.id && <span className="absolute inset-0 animate-pulse bg-white/70" />}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label={`${url ? 'เปลี่ยนรูป' : 'เพิ่มรูป'} ${r.item.name}`}
          disabled={uploadingId != null}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void uploadPhoto(r.item.id, file)
          }}
        />
      </label>
    )
  }

  function renderRow(r: Row) {
    const m = r.item
    const qty = quantities.get(m.id)
    const remaining = remainingByMaterial.get(m.id)
    const qtyNum = Number(qty) || 0
    const sameUnit = (units.get(m.id) || m.unit) === (remaining?.unit || m.unit)
    const over = remaining != null && sameUnit && qtyNum > remaining.remaining
    return (
      <div key={m.id} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-slate-100 py-2.5 first:border-t-0">
        <div className="row-span-2 self-center">{renderThumb(r)}</div>
        <p className="line-clamp-3 min-w-0 break-words text-sm leading-snug text-slate-800">
          {highlightParts(m.name, tokens).map((p, i) =>
            p.hit ? (
              <mark key={i} className="rounded bg-yellow-100 px-0.5 text-slate-900">
                {p.text}
              </mark>
            ) : (
              <span key={i}>{p.text}</span>
            )
          )}
        </p>
        <div className="row-span-2 self-center">
          {qty != null ? (
            <div className="flex flex-col items-center">
              <div className="inline-flex items-center overflow-hidden rounded-lg border-2 border-indigo-500 bg-indigo-50">
                <button
                  type="button"
                  aria-label="ลดจำนวน"
                  onClick={() => onSetQuantity(m.id, String(Math.max(qtyNum - 1, 0)))}
                  className="flex h-8 w-8 items-center justify-center text-indigo-600"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  inputMode="decimal"
                  aria-label={`จำนวน ${m.name}`}
                  value={qty}
                  onChange={(e) => onSetQuantity(m.id, e.target.value.replace(/[^\d.]/g, ''))}
                  onBlur={(e) => {
                    if (!(Number(e.target.value) > 0)) onSetQuantity(m.id, '0')
                  }}
                  className="w-12 border-0 bg-transparent p-0 text-center text-base font-semibold tabular-nums focus:ring-0"
                />
                <button
                  type="button"
                  aria-label="เพิ่มจำนวน"
                  onClick={() => onSetQuantity(m.id, String(qtyNum + 1))}
                  className="flex h-8 w-8 items-center justify-center text-indigo-600"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <span className="mt-0.5 text-[11px] text-slate-500">{units.get(m.id) || m.unit}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onAdd(m)}
              className="whitespace-nowrap rounded-lg border-2 border-indigo-500 px-3 py-1 text-sm font-semibold text-indigo-600 hover:bg-indigo-50"
            >
              + ใส่
            </button>
          )}
        </div>
        <div className="col-start-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <span>{m.unit}</span>
          <span aria-hidden>·</span>
          <span>
            {r.category}
            {r.categoryGuessed && ' (ประมาณ)'}
          </span>
          {remaining && (
            <span
              className={`whitespace-nowrap rounded-full px-2 text-[11px] font-medium ${over ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}
            >
              {over ? 'เกิน BOQ · ' : ''}BOQ เหลือ {fmt(Math.max(remaining.remaining, 0))} {remaining.unit}
            </span>
          )}
          {r.popularity >= POPULAR_MIN && <span className="rounded-full bg-slate-100 px-2 text-[11px] font-medium">ขอบ่อย</span>}
          {r.approximate && <span className="rounded-full bg-amber-50 px-2 text-[11px] font-medium text-amber-800">ใกล้เคียง</span>}
        </div>
      </div>
    )
  }

  const categoryGrid = (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {categories.map(([name, count]) => (
        <button
          key={name}
          type="button"
          onClick={() => pickCategory(name)}
          className="flex min-w-0 flex-col items-start rounded-lg border border-slate-200 px-2.5 py-2 text-left text-sm leading-tight hover:border-indigo-400"
        >
          <span className="break-words">{name}</span>
          <span className="text-[11px] text-slate-500">{count} รายการ</span>
        </button>
      ))}
    </div>
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      panelClassName="max-w-2xl h-[min(860px,calc(100dvh-2rem))]"
      bodyClassName="p-0 flex flex-col"
      footer={
        <div className="border-t border-slate-100 p-3">
          <button
            type="button"
            onClick={resetAndClose}
            className="flex w-full items-center justify-between rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white"
          >
            <span className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              ตะกร้า {basketCount} รายการ
            </span>
            <span>เสร็จ ›</span>
          </button>
        </div>
      }
    >
      <div className="flex shrink-0 flex-col gap-2 border-b border-slate-100 px-3 pb-2.5 pt-3">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={resetAndClose} aria-label="กลับ" className="p-1 text-slate-500">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-500" />
            <input
              id="pr-material-search"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                const first = result?.rows[0]
                if (first && !quantities.has(first.item.id)) onAdd(first.item)
              }}
              placeholder="ค้นหาวัสดุ เช่น ปูน, ท่อ pvc 1/2"
              className="w-full rounded-xl border-2 border-indigo-300 py-2.5 pl-9 pr-9 text-base focus:border-indigo-500"
            />
            {query && (
              <button
                type="button"
                aria-label="ล้างคำค้น"
                onClick={() => {
                  changeQuery('')
                  document.getElementById('pr-material-search')?.focus()
                }}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-slate-100 text-slate-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {scopeLabel && <p className="px-1 text-xs text-slate-500">ขอให้ <span className="font-semibold text-slate-700">{scopeLabel}</span></p>}
        {!browsing && (
          <div className="flex flex-wrap gap-1.5">
            {boqIds.size > 0 && (
              <button
                type="button"
                onClick={() => setOnlyBoq((v) => !v)}
                className={`rounded-full border px-3 py-0.5 text-sm ${onlyBoq ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200'}`}
              >
                เฉพาะ BOQ
              </button>
            )}
            {category != null ? (
              <button
                type="button"
                onClick={() => pickCategory(null)}
                className="rounded-full border border-indigo-600 bg-indigo-600 px-3 py-0.5 text-sm text-white"
              >
                {category} ✕
              </button>
            ) : (
              <button type="button" onClick={() => setShowCategories((v) => !v)} className="rounded-full border border-slate-200 px-3 py-0.5 text-sm">
                หมวด ▾
              </button>
            )}
            {refine.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => changeQuery(`${query.trim()} ${w}`.trim())}
                className="rounded-full bg-slate-100 px-3 py-0.5 text-sm"
              >
                <span className="font-semibold text-indigo-600">+</span> {w}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-3">
        {home && (
          <>
            {home.boq.length > 0 && (
              <section>
                <div className="flex items-baseline justify-between gap-2 pb-1">
                  <h4 className="text-sm font-semibold text-slate-800">ตาม BOQ {scopeLabel || ''}</h4>
                  {home.boq.length > 5 && (
                    <button type="button" onClick={() => setOnlyBoq(true)} className="text-sm text-indigo-600">
                      ดูทั้งหมด {home.boq.length} ›
                    </button>
                  )}
                </div>
                {home.boq.slice(0, 5).map(renderRow)}
              </section>
            )}
            {home.popular.length > 0 && (
              <section>
                <div className="flex items-baseline justify-between gap-2 pb-1">
                  <h4 className="text-sm font-semibold text-slate-800">ขอบ่อย</h4>
                  <span className="text-xs text-slate-500">จากใบขอซื้อและใบสั่งซื้อที่ผ่านมา</span>
                </div>
                {home.popular.map(renderRow)}
              </section>
            )}
            <section>
              <div className="flex items-baseline justify-between gap-2 pb-1.5">
                <h4 className="text-sm font-semibold text-slate-800">หมวดวัสดุ</h4>
                <span className="text-xs text-slate-500">{fmt(index.length)} รายการ</span>
              </div>
              {categoryGrid}
            </section>
          </>
        )}

        {result && (
          <>
            {showCategories && (
              <section>
                <div className="flex items-baseline justify-between pb-1.5">
                  <h4 className="text-sm font-semibold text-slate-800">เลือกหมวด</h4>
                  <button type="button" onClick={() => setShowCategories(false)} className="text-sm text-indigo-600">
                    ปิด
                  </button>
                </div>
                {categoryGrid}
              </section>
            )}
            {result.readAs && (
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-slate-700">
                ลืมเปลี่ยนภาษา? ค้นหา <span className="font-semibold text-indigo-700">{result.readAs}</span> ให้แทน
              </p>
            )}
            {result.approximate && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">ไม่เจอตรงทุกตัวอักษร แสดงชื่อที่ใกล้เคียงด้วย (ป้าย &quot;ใกล้เคียง&quot;)</p>
            )}
            {result.rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
                ไม่พบ &quot;{query}&quot; ในรายการวัสดุ
                <br />
                ลองคำสั้นลง หรือเลือกจากหมวด
                <br />
                ถ้าเป็นวัสดุใหม่ ให้แจ้งฝ่ายจัดซื้อเพิ่มเข้ารายการ
              </p>
            ) : (
              <section>
                <p className="pb-1 text-xs text-slate-500">{fmt(result.rows.length)} รายการ</p>
                {result.rows.slice(0, limit).map(renderRow)}
                {result.rows.length > limit && (
                  <button
                    type="button"
                    onClick={() => setLimit((l) => l + PAGE)}
                    className="mt-2 w-full rounded-lg border border-slate-200 py-2 text-sm text-indigo-600"
                  >
                    แสดงเพิ่ม ({fmt(result.rows.length - limit)} รายการ)
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </div>
      {preview && (
        <button
          type="button"
          onClick={() => setPreview(null)}
          aria-label="ปิดรูป"
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-slate-900/80 p-6 text-white"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- public storage photo */}
          <img src={preview.url} alt={preview.name} className="max-h-[70%] max-w-full rounded-xl object-contain" />
          <span className="text-center text-sm">{preview.name}</span>
        </button>
      )}
    </Modal>
  )
}
