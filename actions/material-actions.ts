'use server'

import { revalidatePath } from 'next/cache'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { getCurrentUser, getCurrentUserRole, requireAuthRole } from '@/actions/_shared/user-role'
import { fetchAllRows } from '@/actions/_shared/fetch-all-rows'
import type {
  BoqMaterialImportPreview,
  BoqMaterialImportRow,
  BoqMaterialImportSkippedRow,
  BoqMaterialItem,
  BoqMaterialsForHouseModelJob,
  MaterialCatalogRow,
  MaterialPickerOption,
  MaterialType,
  PlotGroup,
} from '@/lib/types/materials'

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

const thaiCollator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })

// ---------------------------------------------------------------------------
// Material catalog (PM/admin manage; anyone with `materials` access can read)
// ---------------------------------------------------------------------------

/** activeOnly=true (the default) is for pickers - BOQ, purchase orders,
 * usage logging - where a deactivated material shouldn't be selectable for
 * new work. The materials settings page itself passes false so it can still
 * show and reactivate deactivated rows. */
export async function getMaterialTypes(activeOnly = true): Promise<MaterialType[]> {
  await requireModuleAccess('materials')
  const supabase = await createClient()
  return fetchAllRows<MaterialType>((from, to) => {
    let query = supabase.from('material_types').select('*').order('name').range(from, to)
    if (activeOnly) query = query.eq('is_active', true)
    return query
  })
}

/** Same active rows as getMaterialTypes(true), trimmed to just the columns a
 * picker renders/searches - see MaterialPickerOption. Use this instead of
 * getMaterialTypes wherever the result is only feeding a dropdown (BOQ
 * lines, PO/PR items) rather than an edit form that needs the full row. */
export async function getMaterialPickerOptions(): Promise<MaterialPickerOption[]> {
  await requireModuleAccess('materials')
  const supabase = await createClient()
  return fetchAllRows<MaterialPickerOption>((from, to) =>
    supabase.from('material_types').select('id, name, unit, category').eq('is_active', true).order('name').range(from, to)
  )
}

/** Same rows as getMaterialTypes, trimmed to the columns the materials
 * settings page table actually renders - see MaterialCatalogRow. This is the
 * only caller that needs both active and inactive rows, which on a 1000+ row
 * catalog makes the narrower select worth having as its own query. */
export async function getMaterialCatalog(activeOnly = false): Promise<MaterialCatalogRow[]> {
  await requireModuleAccess('materials')
  const supabase = await createClient()
  return fetchAllRows<MaterialCatalogRow>((from, to) => {
    let query = supabase
      .from('material_types')
      .select('id, name, unit, category, current_price, price_updated_at, is_active, reorder_point, is_requestable, lead_time_days')
      .order('name')
      .range(from, to)
    if (activeOnly) query = query.eq('is_active', true)
    return query
  })
}

// Each mutation below returns the affected row so the settings page can
// patch its local list in place instead of refetching and re-rendering the
// whole (potentially 1000+ row) table after every click. revalidatePath is
// still called so a fresh navigation/reload picks up the change too - this
// is about avoiding a redundant round-trip on the click that already has
// the answer, not about skipping cache invalidation.

export async function createMaterialType(
  name: string,
  unit: string,
  currentPrice: number,
  category?: string,
  reorderPoint?: number | null,
  isRequestable = true,
  leadTimeDays?: number | null
): Promise<MaterialType> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const user = await getCurrentUser()

  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('Material name is required')

  const { data, error } = await supabase
    .from('material_types')
    .insert([
      {
        name: trimmedName,
        unit: unit.trim() || 'unit',
        category: category?.trim() || null,
        current_price: Math.max(0, Number(currentPrice) || 0),
        price_updated_at: new Date().toISOString(),
        price_updated_by: user?.id ?? null,
        reorder_point: reorderPoint ?? null,
        is_requestable: isRequestable,
        lead_time_days: leadTimeDays ?? null,
      },
    ])
    .select()
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/materials')
  return data
}

/** Updates name/unit/category/reorder point/requestable flag/lead time. Use
 * `updateMaterialPrice` to change the price so the price_updated_at/by audit
 * fields only change on an actual price update. */
export async function updateMaterialType(
  id: number,
  name: string,
  unit: string,
  category?: string,
  reorderPoint?: number | null,
  isRequestable = true,
  leadTimeDays?: number | null
): Promise<MaterialType> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()

  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('Material name is required')

  const { data, error } = await supabase
    .from('material_types')
    .update({
      name: trimmedName,
      unit: unit.trim() || 'unit',
      category: category?.trim() || null,
      reorder_point: reorderPoint ?? null,
      is_requestable: isRequestable,
      lead_time_days: leadTimeDays ?? null,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/materials')
  return data
}

export async function updateMaterialPrice(id: number, currentPrice: number): Promise<MaterialType> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const user = await getCurrentUser()

  const { data, error } = await supabase
    .from('material_types')
    .update({
      current_price: Math.max(0, Number(currentPrice) || 0),
      price_updated_at: new Date().toISOString(),
      price_updated_by: user?.id ?? null,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/materials')
  return data
}

/** Soft delete, not a real DELETE - a material is referenced by
 * boq_material_items/purchase_request_items/purchase_order_items the moment
 * it's ever been used anywhere, and a hard delete on a referenced row fails
 * the FK constraint. Deactivating removes it from picker lists while every
 * past reference (and the row itself) stays intact - same pattern as
 * deactivateSupplier/deactivateCompany. */
export async function deactivateMaterialType(id: number): Promise<MaterialType> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const { data, error } = await supabase.from('material_types').update({ is_active: false }).eq('id', id).select().single()
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/materials')
  return data
}

export async function reactivateMaterialType(id: number): Promise<MaterialType> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const { data, error } = await supabase.from('material_types').update({ is_active: true }).eq('id', id).select().single()
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/materials')
  return data
}

// ---------------------------------------------------------------------------
// Batch actions (Settings > Material Catalog > select rows > bulk toolbar)
// ---------------------------------------------------------------------------

// PostgREST puts an `.in('id', [...])` filter in the request URL, not the
// body - a single call with a very large id list can blow past what
// Cloudflare/the origin will accept (the same failure mode that broke the
// spreadsheet import's duplicate-name check). ids are short compared to
// product names, but a "select all" on a 1000+ row catalog still adds up,
// so this stays chunked as a matter of habit rather than a proven necessity.
const BULK_CHUNK_SIZE = 300

async function bulkUpdate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: number[],
  patch: Record<string, unknown>
): Promise<MaterialType[]> {
  const uniqueIds = Array.from(new Set(ids))
  const results: MaterialType[] = []
  for (let i = 0; i < uniqueIds.length; i += BULK_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + BULK_CHUNK_SIZE)
    const { data, error } = await supabase.from('material_types').update(patch).in('id', chunk).select()
    if (error) throw new Error(error.message)
    results.push(...(data || []))
  }
  return results
}

export async function bulkDeactivateMaterialTypes(ids: number[]): Promise<MaterialType[]> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const result = await bulkUpdate(supabase, ids, { is_active: false })
  revalidatePath('/dashboard/settings/materials')
  return result
}

export async function bulkReactivateMaterialTypes(ids: number[]): Promise<MaterialType[]> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const result = await bulkUpdate(supabase, ids, { is_active: true })
  revalidatePath('/dashboard/settings/materials')
  return result
}

export async function bulkSetMaterialCategory(ids: number[], category: string): Promise<MaterialType[]> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const result = await bulkUpdate(supabase, ids, { category: category.trim() || null })
  revalidatePath('/dashboard/settings/materials')
  return result
}

export async function bulkSetMaterialUnit(ids: number[], unit: string): Promise<MaterialType[]> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const trimmedUnit = unit.trim()
  if (!trimmedUnit) throw new Error('กรุณาระบุหน่วย')
  const result = await bulkUpdate(supabase, ids, { unit: trimmedUnit })
  revalidatePath('/dashboard/settings/materials')
  return result
}

export async function bulkSetMaterialRequestable(ids: number[], isRequestable: boolean): Promise<MaterialType[]> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const result = await bulkUpdate(supabase, ids, { is_requestable: isRequestable })
  revalidatePath('/dashboard/settings/materials')
  return result
}

// ---------------------------------------------------------------------------
// Bulk import from a spreadsheet (Settings > Material Catalog > Import)
// ---------------------------------------------------------------------------

export type MaterialImportRow = { name: string; category: string; price: number }

export type MaterialImportPreview = {
  rows: MaterialImportRow[]
  categories: { name: string; count: number }[]
  skippedRows: number
  duplicateNamesInFile: number
}

/**
 * Reads column A = name, column B = price, column C = category (in that
 * order) from the first sheet. Rows whose name starts with "หมวดหมู่:" are
 * section-header rows some category-grouped exports insert above each
 * group - they carry a subtotal in the price column, not a real product, so
 * they're dropped rather than imported as materials.
 */
export async function parseMaterialImportFile(formData: FormData): Promise<MaterialImportPreview> {
  await requireAuthRole(['admin', 'pm'])

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) throw new Error('กรุณาเลือกไฟล์')

  const buffer = Buffer.from(await file.arrayBuffer())
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('ไม่พบชีทข้อมูลในไฟล์')

  const sheet = workbook.Sheets[sheetName]
  const raw = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' })
  const dataRows = raw.slice(1) // row 0 is assumed to be the column header

  // Last occurrence wins on an in-file duplicate name - matches how a human
  // skimming the sheet top-to-bottom would resolve a conflict (later row =
  // more recent correction).
  const byName = new Map<string, MaterialImportRow>()
  let skippedRows = 0
  let duplicateNamesInFile = 0

  for (const row of dataRows) {
    const name = String(row[0] ?? '').trim()
    const priceRaw = row[1]
    const category = String(row[2] ?? '').trim()

    if (!name || name.startsWith('หมวดหมู่:')) {
      skippedRows++
      continue
    }

    const price = typeof priceRaw === 'number' ? priceRaw : parseFloat(String(priceRaw).replace(/,/g, ''))
    if (!Number.isFinite(price) || price < 0) {
      skippedRows++
      continue
    }

    if (byName.has(name)) duplicateNamesInFile++
    byName.set(name, { name, category: category || 'ไม่ระบุหมวดหมู่', price })
  }

  const rows = Array.from(byName.values())
  const categoryCounts = new Map<string, number>()
  for (const row of rows) {
    categoryCounts.set(row.category, (categoryCounts.get(row.category) || 0) + 1)
  }
  const categories = Array.from(categoryCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  return { rows, categories, skippedRows, duplicateNamesInFile }
}

export type MaterialImportItem = { name: string; unit: string; category: string; price: number }
export type MaterialImportResult = { inserted: number; updated: number; skipped: number }

/**
 * Upserts by name (material_types.name is unique). Existing materials are
 * reactivated on import - re-importing is read as "this item is in the
 * source catalog again," which should undo a prior deactivation.
 */
export async function importMaterialTypes(
  items: MaterialImportItem[],
  onDuplicate: 'update' | 'skip'
): Promise<MaterialImportResult> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const user = await getCurrentUser()

  const byName = new Map<string, MaterialImportItem>()
  for (const item of items) {
    const name = item.name.trim()
    if (name) byName.set(name, { ...item, name })
  }
  const rows = Array.from(byName.values())
  if (rows.length === 0) return { inserted: 0, updated: 0, skipped: 0 }

  // Fetch every existing name ONCE, unfiltered, rather than chunking the
  // import batch through `.in('name', [...])` - PostgREST puts an .in()
  // filter in the request URL, and a few hundred Thai product names (some
  // 90+ chars) blew the URL past what Cloudflare/the origin would accept,
  // failing the whole import with an opaque 520. A plain `select('name')`
  // has no such limit, but PostgREST's own default row cap (1000) still
  // applies to a single unpaginated request - fetchAllRows pages past it,
  // otherwise a catalog over 1000 rows silently under-reports existing
  // names and the upsert can create a duplicate instead of updating.
  const existingRows = await fetchAllRows<{ name: string }>((from, to) =>
    supabase.from('material_types').select('name').order('id').range(from, to)
  )
  const existingNames = new Set(existingRows.map((r) => r.name))

  const CHUNK_SIZE = 200
  let inserted = 0
  let updated = 0
  let skipped = 0

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)

    let toUpsert = chunk
    if (onDuplicate === 'skip') {
      toUpsert = chunk.filter((r) => !existingNames.has(r.name))
      skipped += chunk.length - toUpsert.length
    }

    if (toUpsert.length > 0) {
      const { error } = await supabase.from('material_types').upsert(
        toUpsert.map((r) => ({
          name: r.name,
          unit: r.unit.trim() || 'unit',
          category: r.category.trim() || null,
          current_price: Math.max(0, Number(r.price) || 0),
          price_updated_at: new Date().toISOString(),
          price_updated_by: user?.id ?? null,
          is_active: true,
        })),
        { onConflict: 'name' }
      )
      if (error) throw new Error(error.message)
    }

    for (const r of toUpsert) {
      if (existingNames.has(r.name)) updated++
      else inserted++
    }
  }

  revalidatePath('/dashboard/settings/materials')
  return { inserted, updated, skipped }
}

// ---------------------------------------------------------------------------
// Planned materials per BOQ job (the "budget" side, PM/admin manage)
// ---------------------------------------------------------------------------

export async function getBoqMaterialItems(boqId: string): Promise<BoqMaterialItem[]> {
  await requireModuleAccess('materials')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('boq_material_items')
    .select('*, material_types (*)')
    .eq('boq_id', boqId)
    .order('created_at')

  if (error) throw new Error(error.message)
  return data || []
}

export async function addBoqMaterialItem(boqId: string, materialTypeId: number, plannedQuantity: number) {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()

  const { error } = await supabase.from('boq_material_items').insert([
    {
      boq_id: boqId,
      material_type_id: materialTypeId,
      planned_quantity: Math.max(0, Number(plannedQuantity) || 0),
    },
  ])

  if (error) throw new Error(error.message)
  revalidatePath(`/dashboard/boq/${boqId}`)
}

export async function updateBoqMaterialItem(id: string, boqId: string, plannedQuantity: number) {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()

  const { error } = await supabase
    .from('boq_material_items')
    .update({ planned_quantity: Math.max(0, Number(plannedQuantity) || 0) })
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath(`/dashboard/boq/${boqId}`)
}

export async function deleteBoqMaterialItem(id: string, boqId: string) {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const { error } = await supabase.from('boq_material_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath(`/dashboard/boq/${boqId}`)
}

// ---------------------------------------------------------------------------
// House-model-level material entry (BOQ_CONTROL_PLAN.md 7.2). Opening one
// BoqMaterialItemsModal per BOQ job to enter a whole house's materials is
// the reason boq_material_items is still almost empty - this fetches/saves
// every job's materials in one grid instead.
// ---------------------------------------------------------------------------

export async function getBoqMaterialsForHouseModel(houseModelId: string): Promise<BoqMaterialsForHouseModelJob[]> {
  await requireModuleAccess('materials')
  const supabase = await createClient()

  const { data: boqRows, error: boqError } = await supabase
    .from('boq_master')
    .select('id, item_name')
    .eq('house_model_id', houseModelId)
    .order('created_at')
  if (boqError) throw new Error(boqError.message)
  if (!boqRows || boqRows.length === 0) return []

  const boqIds = boqRows.map((b) => b.id)
  const { data: itemRows, error: itemError } = await supabase
    .from('boq_material_items')
    .select('*, material_types (*)')
    .in('boq_id', boqIds)
    .order('created_at')
  if (itemError) throw new Error(itemError.message)

  const itemsByBoq = new Map<string, BoqMaterialItem[]>()
  for (const item of itemRows || []) {
    const list = itemsByBoq.get(item.boq_id) || []
    list.push(item)
    itemsByBoq.set(item.boq_id, list)
  }

  return boqRows.map((b) => ({
    boqId: b.id,
    boqItemName: b.item_name,
    items: itemsByBoq.get(b.id) || [],
  }))
}

export async function bulkUpsertBoqMaterialItems(
  rows: { boqId: string; materialTypeId: number; plannedQuantity: number; wastePercent: number }[]
): Promise<{ inserted: number; updated: number }> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  if (rows.length === 0) return { inserted: 0, updated: 0 }

  const boqIds = Array.from(new Set(rows.map((r) => r.boqId)))
  const { data: existing, error: existingError } = await supabase
    .from('boq_material_items')
    .select('boq_id, material_type_id')
    .in('boq_id', boqIds)
  if (existingError) throw new Error(existingError.message)
  const existingKeys = new Set((existing || []).map((e) => `${e.boq_id}:${e.material_type_id}`))

  const { error } = await supabase.from('boq_material_items').upsert(
    rows.map((r) => ({
      boq_id: r.boqId,
      material_type_id: r.materialTypeId,
      planned_quantity: Math.max(0, Number(r.plannedQuantity) || 0),
      waste_percent: Math.max(0, Number(r.wastePercent) || 0),
    })),
    { onConflict: 'boq_id,material_type_id' }
  )
  if (error) throw new Error(error.message)

  let inserted = 0
  let updated = 0
  for (const r of rows) {
    if (existingKeys.has(`${r.boqId}:${r.materialTypeId}`)) updated++
    else inserted++
  }

  revalidatePath('/dashboard/boq')
  return { inserted, updated }
}

// ---------------------------------------------------------------------------
// BOQ material Excel import (BOQ_CONTROL_PLAN.md 7.1) - preview-then-commit,
// same shape as parseMaterialImportFile/importMaterialTypes above.
// Columns (Thai or English header): house model | boq job | material |
// quantity | waste %.
// ---------------------------------------------------------------------------

/** Exact match first, normalized match only as a fallback - never a blanket
 * normalize-then-join. Matches the pattern that avoided nearly duplicating
 * 850 line items in the PO Excel import: `x`/`X`/`×` are folded together
 * (both as multiplication signs in dimensions and as literal "x" spelling)
 * and case/whitespace differences are ignored, but two genuinely different
 * names never collide. */
function normalizeMaterialName(name: string): string {
  return name.trim().toLowerCase().replace(/[×x*]/g, 'x').replace(/\s+/g, ' ')
}

const BOQ_IMPORT_HEADER_ALIASES: Record<'houseModel' | 'boqJob' | 'material' | 'quantity' | 'wastePercent', string[]> = {
  houseModel: ['house model', 'แบบบ้าน'],
  boqJob: ['boq job', 'รายการงาน', 'boq'],
  material: ['material', 'วัสดุ'],
  quantity: ['quantity', 'จำนวน', 'ปริมาณ'],
  wastePercent: ['waste %', 'waste', 'เผื่อ', '% เผื่อ', 'เผื่อ %', 'wastepercent'],
}

export async function parseBoqMaterialImportFile(formData: FormData): Promise<BoqMaterialImportPreview> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) throw new Error('กรุณาเลือกไฟล์')

  const buffer = Buffer.from(await file.arrayBuffer())
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('ไม่พบชีทข้อมูลในไฟล์')

  const sheet = workbook.Sheets[sheetName]
  const raw = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' })
  if (raw.length === 0) throw new Error('ไฟล์ว่างเปล่า')

  const headerRow = (raw[0] || []).map((h) => String(h).trim().toLowerCase())
  const colIndex = {} as Record<keyof typeof BOQ_IMPORT_HEADER_ALIASES, number>
  for (const key of Object.keys(BOQ_IMPORT_HEADER_ALIASES) as (keyof typeof BOQ_IMPORT_HEADER_ALIASES)[]) {
    colIndex[key] = headerRow.findIndex((h) => BOQ_IMPORT_HEADER_ALIASES[key].includes(h))
  }
  if (colIndex.houseModel < 0 || colIndex.boqJob < 0 || colIndex.material < 0 || colIndex.quantity < 0) {
    throw new Error('ไม่พบคอลัมน์ที่จำเป็น: house model / boq job / material / quantity (แบบบ้าน / รายการงาน / วัสดุ / จำนวน)')
  }

  const [{ data: houseModels, error: hmError }, { data: boqRows, error: boqError }, materialTypes, existingItems] =
    await Promise.all([
      supabase.from('house_models').select('id, name'),
      supabase.from('boq_master').select('id, item_name, house_model_id'),
      fetchAllRows<{ id: number; name: string }>((from, to) =>
        supabase.from('material_types').select('id, name').eq('is_active', true).order('id').range(from, to)
      ),
      fetchAllRows<{ boq_id: string; material_type_id: number; planned_quantity: number }>((from, to) =>
        supabase.from('boq_material_items').select('boq_id, material_type_id, planned_quantity').order('boq_id').range(from, to)
      ),
    ])
  if (hmError) throw new Error(hmError.message)
  if (boqError) throw new Error(boqError.message)

  const houseModelByExact = new Map((houseModels || []).map((h) => [h.name.trim(), h] as const))
  const houseModelByNorm = new Map((houseModels || []).map((h) => [normalizeMaterialName(h.name), h] as const))
  const boqByExact = new Map((boqRows || []).map((b) => [`${b.house_model_id}:${b.item_name.trim()}`, b] as const))
  const boqByNorm = new Map((boqRows || []).map((b) => [`${b.house_model_id}:${normalizeMaterialName(b.item_name)}`, b] as const))
  // coalesce(mt_exact.id, mt_norm.id) - mt_norm is only ever consulted when
  // no exact name matched, matching the SQL idiom this mirrors.
  const materialByExact = new Map(materialTypes.map((m) => [m.name.trim(), m] as const))
  const materialByNorm = new Map(materialTypes.map((m) => [normalizeMaterialName(m.name), m] as const))
  const existingByKey = new Map(existingItems.map((e) => [`${e.boq_id}:${e.material_type_id}`, e.planned_quantity]))

  const rows: BoqMaterialImportRow[] = []
  const skipped: BoqMaterialImportSkippedRow[] = []

  raw.slice(1).forEach((row, idx) => {
    const line = idx + 2 // header is row 1; data starts at row 2
    const houseModelName = String(row[colIndex.houseModel] ?? '').trim()
    const boqJobName = String(row[colIndex.boqJob] ?? '').trim()
    const materialName = String(row[colIndex.material] ?? '').trim()

    if (!houseModelName && !boqJobName && !materialName) return // blank row

    if (!houseModelName || !boqJobName || !materialName) {
      skipped.push({ line, houseModelName, boqJobName, materialName, reason: 'ข้อมูลไม่ครบ (แบบบ้าน / รายการงาน / วัสดุ)' })
      return
    }

    const quantityRaw = row[colIndex.quantity]
    const quantity = typeof quantityRaw === 'number' ? quantityRaw : parseFloat(String(quantityRaw).replace(/,/g, ''))
    if (!Number.isFinite(quantity) || quantity <= 0) {
      skipped.push({ line, houseModelName, boqJobName, materialName, reason: 'จำนวนไม่ถูกต้องหรือไม่มากกว่า 0' })
      return
    }

    const wasteRaw = colIndex.wastePercent >= 0 ? row[colIndex.wastePercent] : ''
    const wastePercent =
      wasteRaw === '' || wasteRaw == null
        ? 0
        : typeof wasteRaw === 'number'
          ? wasteRaw
          : parseFloat(String(wasteRaw).replace(/[,%]/g, ''))

    const houseModel = houseModelByExact.get(houseModelName) || houseModelByNorm.get(normalizeMaterialName(houseModelName))
    if (!houseModel) {
      skipped.push({ line, houseModelName, boqJobName, materialName, reason: `ไม่พบแบบบ้าน "${houseModelName}"` })
      return
    }

    const boqJob =
      boqByExact.get(`${houseModel.id}:${boqJobName}`) || boqByNorm.get(`${houseModel.id}:${normalizeMaterialName(boqJobName)}`)
    if (!boqJob) {
      skipped.push({ line, houseModelName, boqJobName, materialName, reason: `ไม่พบรายการงาน "${boqJobName}" ในแบบบ้าน "${houseModel.name}"` })
      return
    }

    const material = materialByExact.get(materialName) || materialByNorm.get(normalizeMaterialName(materialName))
    if (!material) {
      skipped.push({ line, houseModelName, boqJobName, materialName, reason: `ไม่พบวัสดุ "${materialName}" ในระบบ - เพิ่มวัสดุนี้ก่อนแล้วนำเข้าใหม่` })
      return
    }

    const previousQuantity = existingByKey.get(`${boqJob.id}:${material.id}`)
    rows.push({
      line,
      houseModelName: houseModel.name,
      boqJobName: boqJob.item_name,
      materialName: material.name,
      quantity,
      wastePercent: Math.max(0, Number.isFinite(wastePercent) ? wastePercent : 0),
      boqId: boqJob.id,
      materialTypeId: material.id,
      status: previousQuantity != null ? 'update' : 'insert',
      previousQuantity,
    })
  })

  return { rows, skipped }
}

// ---------------------------------------------------------------------------
// Plot groups (batches of plots built/supplied together, e.g. "98-102").
// Managed from plot management on the project page; material purchases can
// then be scoped to a whole group instead of one plot.
// ---------------------------------------------------------------------------

export async function getPlotGroups(projectId: string): Promise<PlotGroup[]> {
  await requireModuleAccess('projects')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plot_groups')
    .select('id, project_id, name, created_at, plot_group_members (plot_id, plots (name))')
    .eq('project_id', projectId)
    .order('name')

  if (error) throw new Error(error.message)

  return (data || []).map((group) => {
    const members = (group.plot_group_members || []).map((member) => ({
      plot_id: member.plot_id,
      name: asSingle(member.plots)?.name || '',
    }))
    members.sort((a, b) => thaiCollator.compare(a.name, b.name))
    return {
      id: group.id,
      project_id: group.project_id,
      name: group.name,
      created_at: group.created_at,
      member_plot_ids: members.map((m) => m.plot_id),
      member_plot_names: members.map((m) => m.name),
    }
  })
}

export async function createPlotGroup(projectId: string, name: string, plotIds: string[]) {
  await requireModuleAccess('projects')
  const supabase = await createClient()

  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('กรุณาตั้งชื่อกลุ่ม')
  // No minimum member count - a batch's name is usually known (e.g. "98-102")
  // before every individual plot in it exists yet, since creating a plot is
  // its own heavier flow (house model + auto-generated BOQ jobs). Letting the
  // group exist name-only means stock/material logging can start referencing
  // it right away, with plots added as they're actually created.
  const uniquePlotIds = Array.from(new Set(plotIds.filter(Boolean)))

  const { data: group, error } = await supabase
    .from('plot_groups')
    .insert([{ project_id: projectId, name: trimmedName }])
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  if (uniquePlotIds.length > 0) {
    const { error: membersError } = await supabase
      .from('plot_group_members')
      .insert(uniquePlotIds.map((plotId) => ({ group_id: group.id, plot_id: plotId })))

    if (membersError) {
      // Roll back the empty group so a failed member insert (e.g. a plot that
      // is already in another group) doesn't leave a hollow group behind.
      await supabase.from('plot_groups').delete().eq('id', group.id)
      if (membersError.message.includes('plot_group_members_plot_unique')) {
        throw new Error('มีแปลงที่อยู่ในกลุ่มอื่นแล้ว - แปลงหนึ่งอยู่ได้เพียงกลุ่มเดียว')
      }
      throw new Error(membersError.message)
    }
  }

  revalidatePath(`/dashboard/projects/${projectId}`)
}

export async function updatePlotGroup(groupId: string, projectId: string, name: string, plotIds: string[]) {
  await requireModuleAccess('projects')
  const supabase = await createClient()

  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('กรุณาตั้งชื่อกลุ่ม')
  // No minimum member count here either - see createPlotGroup. Editing down
  // to zero (or building up one plot at a time) both need to work.
  const uniquePlotIds = Array.from(new Set(plotIds.filter(Boolean)))

  const { error: nameError } = await supabase.from('plot_groups').update({ name: trimmedName }).eq('id', groupId)
  if (nameError) throw new Error(nameError.message)

  const { error: clearError } = await supabase.from('plot_group_members').delete().eq('group_id', groupId)
  if (clearError) throw new Error(clearError.message)

  if (uniquePlotIds.length > 0) {
    const { error: membersError } = await supabase
      .from('plot_group_members')
      .insert(uniquePlotIds.map((plotId) => ({ group_id: groupId, plot_id: plotId })))

    if (membersError) {
      if (membersError.message.includes('plot_group_members_plot_unique')) {
        throw new Error('มีแปลงที่อยู่ในกลุ่มอื่นแล้ว - แปลงหนึ่งอยู่ได้เพียงกลุ่มเดียว')
      }
      throw new Error(membersError.message)
    }
  }

  revalidatePath(`/dashboard/projects/${projectId}`)
}

export async function deletePlotGroup(groupId: string, projectId: string) {
  await requireModuleAccess('projects')
  const supabase = await createClient()

  const { error } = await supabase.from('plot_groups').delete().eq('id', groupId)
  if (error) throw new Error(error.message)
  revalidatePath(`/dashboard/projects/${projectId}`)
}
