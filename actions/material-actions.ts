'use server'

import { revalidatePath } from 'next/cache'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { getCurrentUser, getCurrentUserRole, requireAuthRole } from '@/actions/_shared/user-role'
import { fetchAllRows } from '@/actions/_shared/fetch-all-rows'
import type {
  BoqMaterialItem,
  MaterialPickerOption,
  MaterialType,
  MaterialUsageLogEntry,
  MaterialVariance,
  PlotGroup,
  PlotGroupContext,
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
  isRequestable = true
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
      },
    ])
    .select()
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/materials')
  return data
}

/** Updates name/unit/category/reorder point/requestable flag. Use
 * `updateMaterialPrice` to change the price so the price_updated_at/by audit
 * fields only change on an actual price update. */
export async function updateMaterialType(
  id: number,
  name: string,
  unit: string,
  category?: string,
  reorderPoint?: number | null,
  isRequestable = true
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
 * boq_material_items/material_usage_log/purchase_request_items/
 * purchase_order_items the moment it's ever been used anywhere, and a hard
 * delete on a referenced row fails the FK constraint. Deactivating removes
 * it from picker lists while every past reference (and the row itself)
 * stays intact - same pattern as deactivateSupplier/deactivateCompany. */
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
  const uniquePlotIds = Array.from(new Set(plotIds.filter(Boolean)))
  if (uniquePlotIds.length < 2) throw new Error('กลุ่มต้องมีอย่างน้อย 2 แปลง')

  const { data: group, error } = await supabase
    .from('plot_groups')
    .insert([{ project_id: projectId, name: trimmedName }])
    .select('id')
    .single()

  if (error) throw new Error(error.message)

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

  revalidatePath(`/dashboard/projects/${projectId}`)
}

export async function updatePlotGroup(groupId: string, projectId: string, name: string, plotIds: string[]) {
  await requireModuleAccess('projects')
  const supabase = await createClient()

  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('กรุณาตั้งชื่อกลุ่ม')
  const uniquePlotIds = Array.from(new Set(plotIds.filter(Boolean)))
  if (uniquePlotIds.length < 2) throw new Error('กลุ่มต้องมีอย่างน้อย 2 แปลง')

  const { error: nameError } = await supabase.from('plot_groups').update({ name: trimmedName }).eq('id', groupId)
  if (nameError) throw new Error(nameError.message)

  const { error: clearError } = await supabase.from('plot_group_members').delete().eq('group_id', groupId)
  if (clearError) throw new Error(clearError.message)

  const { error: membersError } = await supabase
    .from('plot_group_members')
    .insert(uniquePlotIds.map((plotId) => ({ group_id: groupId, plot_id: plotId })))

  if (membersError) {
    if (membersError.message.includes('plot_group_members_plot_unique')) {
      throw new Error('มีแปลงที่อยู่ในกลุ่มอื่นแล้ว - แปลงหนึ่งอยู่ได้เพียงกลุ่มเดียว')
    }
    throw new Error(membersError.message)
  }

  revalidatePath(`/dashboard/projects/${projectId}`)
}

export async function deletePlotGroup(groupId: string, projectId: string) {
  await requireModuleAccess('projects')
  const supabase = await createClient()

  // Past purchases scoped to this group would silently become single-plot
  // entries if the group vanished (FK is ON DELETE SET NULL), rewriting
  // spend history - so refuse while any exist.
  const { count, error: countError } = await supabase
    .from('material_usage_log')
    .select('id', { count: 'exact', head: true })
    .eq('plot_group_id', groupId)

  if (countError) throw new Error(countError.message)
  if ((count ?? 0) > 0) {
    throw new Error('ลบไม่ได้: มีบันทึกการใช้วัสดุที่อ้างถึงกลุ่มนี้อยู่ กรุณาลบบันทึกเหล่านั้นก่อน')
  }

  const { error } = await supabase.from('plot_groups').delete().eq('id', groupId)
  if (error) throw new Error(error.message)
  revalidatePath(`/dashboard/projects/${projectId}`)
}

// ---------------------------------------------------------------------------
// Actual usage log (the "actual" side, foreman logs against their own jobs)
// ---------------------------------------------------------------------------

type JobContext = {
  plotId: string | null
  itemName: string | null
  boqItemId: string | null
  group: PlotGroupContext | null
}

async function fetchJobContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobAssignmentId: string
): Promise<JobContext> {
  const { data: job, error } = await supabase
    .from('job_assignments')
    .select('plot_id, boq_item_id, boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name)')
    .eq('id', jobAssignmentId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  const itemName = asSingle(job?.boq_master)?.item_name?.trim() || null
  const plotId = job?.plot_id || null
  const boqItemId = job?.boq_item_id || null
  if (!plotId) return { plotId, itemName, boqItemId, group: null }

  const { data: membership, error: membershipError } = await supabase
    .from('plot_group_members')
    .select('group_id, plot_groups (name)')
    .eq('plot_id', plotId)
    .maybeSingle()

  if (membershipError) throw new Error(membershipError.message)
  if (!membership?.group_id) return { plotId, itemName, boqItemId, group: null }

  const { data: members, error: membersError } = await supabase
    .from('plot_group_members')
    .select('plot_id, plots (name)')
    .eq('group_id', membership.group_id)

  if (membersError) throw new Error(membersError.message)
  const memberNames = (members || [])
    .map((m) => asSingle(m.plots)?.name || '')
    .filter(Boolean)
    .sort((a, b) => thaiCollator.compare(a, b))

  return {
    plotId,
    itemName,
    boqItemId,
    group: {
      group_id: membership.group_id,
      name: asSingle(membership.plot_groups)?.name || '',
      member_count: (members || []).length,
      member_plot_names: memberNames,
    },
  }
}

/** The plot group the job's plot belongs to (or null) - the logging UI uses
 * this to offer "log for the whole group". */
export async function getPlotGroupContextForJob(jobAssignmentId: string): Promise<PlotGroupContext | null> {
  await requireModuleAccess('materials')
  const supabase = await createClient()
  const context = await fetchJobContext(supabase, jobAssignmentId)
  return context.group
}

/** Group-scoped purchases relevant to a job: entries logged for the plot's
 * group whose anchor job is the same kind of BOQ work (matched by item
 * name - "identical" house types are duplicated into separate boq_master
 * records per phase, so the FK alone can't connect them). */
async function fetchGroupEntriesForJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  context: JobContext
) {
  if (!context.group || !context.itemName) return []

  const { data, error } = await supabase
    .from('material_usage_log')
    .select(
      '*, material_types (*), job_assignments!inner (boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name))'
    )
    .eq('plot_group_id', context.group.group_id)

  if (error) throw new Error(error.message)

  return (data || []).filter((entry) => {
    const anchorItemName = asSingle(asSingle(entry.job_assignments)?.boq_master)?.item_name?.trim()
    return anchorItemName === context.itemName
  })
}

export async function getMaterialUsageForJob(jobAssignmentId: string): Promise<MaterialUsageLogEntry[]> {
  await requireModuleAccess('materials')
  const supabase = await createClient()
  const context = await fetchJobContext(supabase, jobAssignmentId)

  const [{ data: soloEntries, error: soloError }, groupEntries] = await Promise.all([
    supabase
      .from('material_usage_log')
      .select('*, material_types (*)')
      .eq('job_assignment_id', jobAssignmentId)
      .is('plot_group_id', null),
    fetchGroupEntriesForJob(supabase, context),
  ])

  if (soloError) throw new Error(soloError.message)

  const memberCount = context.group?.member_count || 1
  const decoratedGroupEntries: MaterialUsageLogEntry[] = groupEntries.map((entry) => {
    // Strip the join used only for item-name matching before returning.
    const rest = { ...entry } as Record<string, unknown>
    delete rest.job_assignments
    return {
      ...(rest as unknown as MaterialUsageLogEntry),
      plot_group: context.group ? { name: context.group.name, member_count: memberCount } : null,
      share_quantity: Number(entry.quantity_used || 0) / memberCount,
    }
  })

  return [...(soloEntries || []), ...decoratedGroupEntries].sort((a, b) => {
    const dateCompare = String(b.purchase_date).localeCompare(String(a.purchase_date))
    if (dateCompare !== 0) return dateCompare
    return String(b.created_at).localeCompare(String(a.created_at))
  })
}

export async function logMaterialUsage(input: {
  job_assignment_id: string
  material_type_id: number
  quantity_used: number
  unit_price_at_use: number
  purchase_date: string
  note?: string
  photo_url?: string
  /** true = this purchase covers the plot's whole group, stored ONCE at
   * group scope (per-plot numbers are derived as total / member count). */
  for_group?: boolean
}) {
  await requireModuleAccess('materials')
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('User not found')

  if (!input.job_assignment_id) throw new Error('Job is required')
  if (!input.material_type_id) throw new Error('Material is required')
  if (!(Number(input.quantity_used) > 0)) throw new Error('Quantity must be greater than 0')

  let plotGroupId: string | null = null
  if (input.for_group) {
    const context = await fetchJobContext(supabase, input.job_assignment_id)
    if (!context.group) throw new Error('แปลงนี้ยังไม่ได้อยู่ในกลุ่มแปลง - ตั้งกลุ่มได้ที่หน้าจัดการแปลงของโครงการ')
    plotGroupId = context.group.group_id
  }

  const { error } = await supabase.from('material_usage_log').insert([
    {
      job_assignment_id: input.job_assignment_id,
      material_type_id: input.material_type_id,
      quantity_used: Number(input.quantity_used),
      // Snapshot the price at the moment of logging - never re-derive this
      // from material_types.current_price later, or past spend would drift
      // whenever purchasing updates the catalog price.
      unit_price_at_use: Math.max(0, Number(input.unit_price_at_use) || 0),
      purchase_date: input.purchase_date || new Date().toISOString().split('T')[0],
      note: input.note?.trim() || null,
      photo_url: input.photo_url || null,
      logged_by: user.id,
      plot_group_id: plotGroupId,
    },
  ])

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/foreman')
}

export async function updateMaterialUsageEntry(
  id: string,
  input: { quantity_used: number; unit_price_at_use: number; purchase_date: string; note?: string }
) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('User not found')
  const role = await getCurrentUserRole(supabase, user.id)

  const { data: entry, error: fetchError } = await supabase
    .from('material_usage_log')
    .select('logged_by')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) throw new Error(fetchError.message)
  if (!entry) throw new Error('Entry not found')

  const isOwner = entry.logged_by === user.id
  const isPrivileged = role === 'pm' || role === 'admin'
  if (!isOwner && !isPrivileged) throw new Error('No permission to edit this entry')

  if (!(Number(input.quantity_used) > 0)) throw new Error('Quantity must be greater than 0')

  // A purchase is stored once regardless of scope (solo or whole group), so
  // an edit is a plain single-row update - no cross-plot sync needed.
  const { error } = await supabase
    .from('material_usage_log')
    .update({
      quantity_used: Number(input.quantity_used),
      unit_price_at_use: Math.max(0, Number(input.unit_price_at_use) || 0),
      purchase_date: input.purchase_date,
      note: input.note?.trim() || null,
    })
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/foreman')
}

export async function deleteMaterialUsageEntry(id: string) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('User not found')
  const role = await getCurrentUserRole(supabase, user.id)

  const { data: entry, error: fetchError } = await supabase
    .from('material_usage_log')
    .select('logged_by')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) throw new Error(fetchError.message)
  if (!entry) throw new Error('Entry not found')

  const isOwner = entry.logged_by === user.id
  const isPrivileged = role === 'pm' || role === 'admin'
  if (!isOwner && !isPrivileged) throw new Error('No permission to delete this entry')

  // One row per purchase regardless of scope - deleting a group-scoped
  // entry removes it for every member plot automatically.
  const { error } = await supabase.from('material_usage_log').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/foreman')
}

// ---------------------------------------------------------------------------
// Planned-vs-actual rollup for one job assignment (a BOQ job on one plot)
// ---------------------------------------------------------------------------

/** Per-plot budget vs actual for one job. The budget side is always the
 * plot's own BOQ quantities. The actual side combines:
 *   - solo purchases (exact), and
 *   - this plot's share of group-scoped purchases (group total / member
 *     count - the true per-house split of a batch purchase is unknowable,
 *     so an even share, labeled as such, is the honest per-plot number).
 * Group totals ride along in `group` so the UI can show the real batch
 * numbers (e.g. "whole group: 25 used / 15 budgeted") next to the share. */
export async function getMaterialVarianceForJob(jobAssignmentId: string): Promise<MaterialVariance[]> {
  await requireModuleAccess('materials')
  const supabase = await createClient()

  const context = await fetchJobContext(supabase, jobAssignmentId)
  if (!context.boqItemId) return []

  const [{ data: planned, error: plannedError }, { data: solo, error: soloError }, groupEntries] =
    await Promise.all([
      supabase
        .from('boq_material_items')
        .select('material_type_id, planned_quantity, material_types (id, name, unit, current_price)')
        .eq('boq_id', context.boqItemId),
      supabase
        .from('material_usage_log')
        .select('material_type_id, quantity_used, unit_price_at_use')
        .eq('job_assignment_id', jobAssignmentId)
        .is('plot_group_id', null),
      fetchGroupEntriesForJob(supabase, context),
    ])

  if (plannedError) throw new Error(plannedError.message)
  if (soloError) throw new Error(soloError.message)

  const memberCount = context.group?.member_count || 1

  const soloByMaterial = new Map<number, { quantity: number; cost: number }>()
  for (const row of solo || []) {
    const existing = soloByMaterial.get(row.material_type_id) || { quantity: 0, cost: 0 }
    existing.quantity += Number(row.quantity_used || 0)
    existing.cost += Number(row.quantity_used || 0) * Number(row.unit_price_at_use || 0)
    soloByMaterial.set(row.material_type_id, existing)
  }

  const groupByMaterial = new Map<number, { quantity: number; cost: number }>()
  for (const row of groupEntries) {
    const existing = groupByMaterial.get(row.material_type_id) || { quantity: 0, cost: 0 }
    existing.quantity += Number(row.quantity_used || 0)
    existing.cost += Number(row.quantity_used || 0) * Number(row.unit_price_at_use || 0)
    groupByMaterial.set(row.material_type_id, existing)
  }

  const plannedByMaterial = new Map<
    number,
    { planned_quantity: number; material_type: { id: number; name: string; unit: string; current_price: number } | null }
  >()
  for (const row of planned || []) {
    plannedByMaterial.set(row.material_type_id, {
      planned_quantity: Number(row.planned_quantity || 0),
      material_type: asSingle(row.material_types),
    })
  }

  // Union of planned + actual material ids - a material logged without being
  // pre-planned (e.g. something unexpected was bought) must still show up
  // here, not silently disappear from the comparison.
  const allMaterialIds = new Set<number>([
    ...plannedByMaterial.keys(),
    ...soloByMaterial.keys(),
    ...groupByMaterial.keys(),
  ])

  // Materials that only appear in `actual` have no joined material_types row
  // from the `planned` query, so look those up separately.
  const unplannedIds = Array.from(allMaterialIds).filter((id) => !plannedByMaterial.has(id))
  const unplannedTypes = unplannedIds.length
    ? (
        await supabase
          .from('material_types')
          .select('id, name, unit, current_price')
          .in('id', unplannedIds)
      ).data || []
    : []
  const unplannedTypeById = new Map(unplannedTypes.map((t) => [t.id, t]))

  return Array.from(allMaterialIds).map((materialTypeId) => {
    const plannedEntry = plannedByMaterial.get(materialTypeId)
    const materialType = plannedEntry?.material_type ?? unplannedTypeById.get(materialTypeId) ?? null
    const plannedQuantity = plannedEntry?.planned_quantity ?? 0
    const plannedCost = plannedQuantity * Number(materialType?.current_price || 0)
    const soloUsed = soloByMaterial.get(materialTypeId) || { quantity: 0, cost: 0 }
    const groupUsed = groupByMaterial.get(materialTypeId) || { quantity: 0, cost: 0 }

    const usedQuantity = soloUsed.quantity + groupUsed.quantity / memberCount
    const actualCost = soloUsed.cost + groupUsed.cost / memberCount

    return {
      material_type_id: materialTypeId,
      material_name: materialType?.name || 'ไม่ระบุ',
      unit: materialType?.unit || 'unit',
      planned_quantity: plannedQuantity,
      used_quantity: usedQuantity,
      planned_cost: plannedCost,
      actual_cost: actualCost,
      difference: actualCost - plannedCost,
      group:
        groupUsed.quantity > 0 && context.group
          ? {
              member_count: memberCount,
              total_quantity: groupUsed.quantity,
              total_cost: groupUsed.cost,
              planned_quantity: plannedQuantity * memberCount,
              planned_cost: plannedCost * memberCount,
            }
          : undefined,
    }
  })
}
