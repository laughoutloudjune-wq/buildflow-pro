'use server'

import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requireAuthRole, getCurrentUser } from '@/actions/_shared/user-role'
import { decodeAdjustmentDescription } from '@/actions/_shared/billing-adjustments'
import { summarizePlotMaterials, type PlotMaterialSummaryRow, type PlotSummaryLine } from '@/lib/procurement/allocationTrace'

export type SaleStatus = {
  code: string
  label: string
  color: string
  stage: string
  sort_order: number
  is_active: boolean
}

export type SalesBoardRow = {
  plot_id: string
  plot_name: string
  plot_group_id: string | null
  plot_group_name: string | null
  house_model_name: string | null
  list_price: number | null
  land_area_sqwa: number | null
  sale_id: string | null
  status_code: string
  status_label: string
  status_color: string
  stage: string
  customer_id: string | null
  customer_name: string | null
  sales_rep_name: string | null
  sale_price: number | null
  booked_at: string | null
  contract_at: string | null
  inspection_at: string | null
  transfer_at: string | null
  delivered_at: string | null
  status_updated_at: string | null
  jobs_total: number
  jobs_done: number
  progress_percent: number
}

// Same {projects, plotGroups, plots} shape as getCostControlOptions
// (actions/procurement/boq-control.ts), gated on 'sales' instead of
// 'cost_control' so ScopePicker can be reused as-is for a role that has the
// former but never the latter.
export async function getSalesBoardOptions() {
  await requireModuleAccess('sales')
  const supabase = await createClient()

  const [projects, plotGroups, plots] = await Promise.all([
    supabase.from('projects').select('id, name').eq('kind', 'development').order('name'),
    supabase.from('plot_groups').select('id, name, project_id').order('name'),
    supabase.from('plots').select('id, name, project_id').order('name'),
  ])

  if (projects.error) throw new Error(projects.error.message)
  if (plotGroups.error) throw new Error(plotGroups.error.message)
  if (plots.error) throw new Error(plots.error.message)

  return {
    projects: projects.data || [],
    plotGroups: plotGroups.data || [],
    plots: plots.data || [],
  }
}

export async function getSalesBoard(projectId: string): Promise<SalesBoardRow[]> {
  await requireModuleAccess('sales')
  if (!projectId) return []

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_sales_board', { p_project_id: projectId })
  if (error) throw new Error(error.message)
  return (data || []) as SalesBoardRow[]
}

/** Active statuses only, in board/legend order - what the status-change
 * picker and the legend both use. See getAllSaleStatuses for the admin
 * catalogue editor, which also needs inactive ones. */
export async function getSaleStatuses(): Promise<SaleStatus[]> {
  await requireModuleAccess('sales')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sale_statuses')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
  if (error) throw new Error(error.message)
  return data || []
}

export type ChangeSaleStatusInput = {
  plotId: string
  statusCode: string
  note?: string
  customerId?: string
  customerName?: string
  customerPhone?: string
  salePrice?: number | null
}

/** The one write path for moving a plot through the pipeline - always logs a
 * plot_sale_events row via the sales_change_status() RPC, which does the deal
 * upsert and the event insert in one transaction (SALES_MODULE_PLAN.md §8.2). */
export async function changeSaleStatus(input: ChangeSaleStatusInput) {
  await requireModuleAccess('sales')
  if (!input.plotId || !input.statusCode) {
    return { success: false, error: 'ข้อมูลไม่ครบ' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('sales_change_status', {
    p_payload: {
      plot_id: input.plotId,
      status_code: input.statusCode,
      note: input.note?.trim() || null,
      customer_id: input.customerId || null,
      customer_name: input.customerName?.trim() || null,
      customer_phone: input.customerPhone?.trim() || null,
      sale_price: input.salePrice ?? null,
    },
  })
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/sales')
  return { success: true, data }
}

// ---------------------------------------------------------------------------
// Status catalogue - admin only (D3): add/rename/recolour, never delete (a
// status a past sale points at must keep resolving), tagged to a fixed
// `stage` so reports survive statuses invented after this shipped.
// ---------------------------------------------------------------------------

export async function getAllSaleStatuses(): Promise<SaleStatus[]> {
  await requireAuthRole(['admin'], 'Only admin can manage sale statuses')
  const supabase = await createClient()
  const { data, error } = await supabase.from('sale_statuses').select('*').order('sort_order')
  if (error) throw new Error(error.message)
  return data || []
}

function readStatusForm(formData: FormData) {
  const label = String(formData.get('label') || '').trim()
  const color = String(formData.get('color') || '').trim()
  const stage = String(formData.get('stage') || '').trim()
  const sortOrder = Number(formData.get('sort_order') || 0)
  return { label, color, stage, sortOrder }
}

export async function createSaleStatus(formData: FormData) {
  await requireAuthRole(['admin'], 'Only admin can manage sale statuses')
  const code = String(formData.get('code') || '').trim()
  const { label, color, stage, sortOrder } = readStatusForm(formData)

  if (!code || !label || !color || !stage) {
    return { success: false, error: 'กรอกข้อมูลให้ครบ' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('sale_statuses')
    .insert({ code, label, color, stage, sort_order: sortOrder })

  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/settings/sale-statuses')
  revalidatePath('/dashboard/sales')
  return { success: true }
}

export async function updateSaleStatus(code: string, formData: FormData) {
  await requireAuthRole(['admin'], 'Only admin can manage sale statuses')
  const { label, color, stage, sortOrder } = readStatusForm(formData)
  const isActive = formData.get('is_active') === 'on'

  if (!label || !color || !stage) {
    return { success: false, error: 'กรอกข้อมูลให้ครบ' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('sale_statuses')
    .update({ label, color, stage, sort_order: sortOrder, is_active: isActive })
    .eq('code', code)

  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/settings/sale-statuses')
  revalidatePath('/dashboard/sales')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Import the team's existing sales book (Phase 3, SALES_MODULE_PLAN.md).
//
// Expected columns, first sheet, row 1 = header (mirrors the fixed-column
// convention parseMaterialImportFile already uses for the material catalog
// import, rather than a general column-mapper - simpler, and consistent with
// how imports already work in this app):
//   A ชื่อแปลง/บ้านเลขที่ · B ชื่อลูกค้า · C เบอร์โทร · D สถานะ · E ราคาขาย ·
//   F วันที่จอง · G วันที่ทำสัญญา · H วันที่นัดตรวจ · I วันที่โอน · J หมายเหตุ
//
// Plot and status resolution both follow the exact-match-then-normalized
// rule from the PO import (see memory project-buildflow-po-import): never a
// blanket normalized join, and a normalized match that is ambiguous (fans
// out to more than one real row) is reported as unmatched, not guessed.
// Every unresolved row gets a manual-override dropdown in the UI rather than
// being silently dropped or guessed - see SalesImportModal.tsx.
// ---------------------------------------------------------------------------

export type SalesImportRow = {
  rowIndex: number
  plotNameRaw: string
  plotId: string | null
  customerName: string
  customerPhone: string
  statusRaw: string
  statusCode: string | null
  salePrice: number | null
  bookedAt: string | null
  contractAt: string | null
  inspectionAt: string | null
  transferAt: string | null
  note: string
  alreadyHasDeal: boolean
}

export type SalesImportPreview = {
  rows: SalesImportRow[]
  plotOptions: { id: string; name: string }[]
  statusOptions: { code: string; label: string }[]
}

function normalizeImportText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

// Deliberately never constructs a JS Date from ambiguous input (a spreadsheet
// date string, or a locally-constructed Date's local-vs-UTC fields) - that
// path shifts the calendar date by a day for any user not in UTC+0, which
// silently corrupted every booked/contract/transfer date on import. Excel
// serials are parsed with SheetJS's own date-code math (no timezone concept
// at that level), and text dates are matched against explicit formats only.
function parseImportDateCell(value: unknown): string | null {
  if (value == null || value === '') return null

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
  }

  const str = String(value).trim()
  if (!str) return null

  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`

  // DD/MM/YYYY or DD-MM-YYYY - the common non-US spreadsheet format, and the
  // one JS's own Date constructor gets wrong (it reads slash dates as MM/DD).
  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${dmy[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  return null
}

export async function parseSalesImportFile(formData: FormData): Promise<SalesImportPreview> {
  await requireModuleAccess('sales')

  const projectId = String(formData.get('project_id') || '')
  if (!projectId) throw new Error('กรุณาเลือกโครงการ')

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) throw new Error('กรุณาเลือกไฟล์')

  const supabase = await createClient()
  const [plotsRes, statusesRes, liveDealsRes] = await Promise.all([
    supabase.from('plots').select('id, name').eq('project_id', projectId).eq('is_sellable', true),
    supabase.from('sale_statuses').select('code, label').eq('is_active', true).order('sort_order'),
    supabase.from('plot_sales').select('plot_id').is('cancelled_at', null),
  ])
  if (plotsRes.error) throw new Error(plotsRes.error.message)
  if (statusesRes.error) throw new Error(statusesRes.error.message)
  if (liveDealsRes.error) throw new Error(liveDealsRes.error.message)

  const plots = plotsRes.data || []
  const statuses = statusesRes.data || []
  const plotsWithLiveDeal = new Set((liveDealsRes.data || []).map((d) => d.plot_id))

  const plotByExactName = new Map(plots.map((p) => [p.name, p.id]))
  const plotByNormName = new Map<string, string[]>()
  for (const p of plots) {
    const norm = normalizeImportText(p.name)
    plotByNormName.set(norm, [...(plotByNormName.get(norm) || []), p.id])
  }
  const statusByExactLabel = new Map(statuses.map((s) => [s.label, s.code]))
  const statusByNormLabel = new Map(statuses.map((s) => [normalizeImportText(s.label), s.code]))

  const buffer = Buffer.from(await file.arrayBuffer())
  // No cellDates: true - a real Excel date cell should come through as its
  // raw serial number, parsed via XLSX.SSF (timezone-free), not as a JS Date
  // (see parseImportDateCell's comment for why that path is unsafe).
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('ไม่พบชีทข้อมูลในไฟล์')
  const sheet = workbook.Sheets[sheetName]
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
  const dataRows = raw.slice(1)

  const rows: SalesImportRow[] = []
  dataRows.forEach((r, i) => {
    const plotNameRaw = String(r[0] ?? '').trim()
    if (!plotNameRaw) return

    const statusRaw = String(r[3] ?? '').trim()
    const priceRaw = r[4]
    const price =
      priceRaw === '' || priceRaw == null
        ? null
        : typeof priceRaw === 'number'
          ? priceRaw
          : parseFloat(String(priceRaw).replace(/,/g, ''))

    const normMatches = plotByNormName.get(normalizeImportText(plotNameRaw))
    const plotId = plotByExactName.get(plotNameRaw) ?? (normMatches?.length === 1 ? normMatches[0] : null)
    const statusCode = statusByExactLabel.get(statusRaw) ?? statusByNormLabel.get(normalizeImportText(statusRaw)) ?? null

    rows.push({
      rowIndex: i + 2,
      plotNameRaw,
      plotId,
      customerName: String(r[1] ?? '').trim(),
      customerPhone: String(r[2] ?? '').trim(),
      statusRaw,
      statusCode,
      salePrice: price != null && Number.isFinite(price) ? price : null,
      bookedAt: parseImportDateCell(r[5]),
      contractAt: parseImportDateCell(r[6]),
      inspectionAt: parseImportDateCell(r[7]),
      transferAt: parseImportDateCell(r[8]),
      note: String(r[9] ?? '').trim(),
      alreadyHasDeal: plotId ? plotsWithLiveDeal.has(plotId) : false,
    })
  })

  return {
    rows,
    plotOptions: plots.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name, 'th')),
    statusOptions: statuses.map((s) => ({ code: s.code, label: s.label })),
  }
}

export type SalesImportCommitRow = {
  plotId: string
  statusCode: string
  customerName: string
  customerPhone: string
  salePrice: number | null
  bookedAt: string | null
  contractAt: string | null
  inspectionAt: string | null
  transferAt: string | null
  note: string
}

export type SalesImportResult = {
  inserted: number
  skipped: number
  errors: { plotId: string; message: string }[]
}

/**
 * Writes directly via the tables' own RLS (admin/pm/sales), not through
 * sales_change_status() - that RPC auto-stamps today's date on the matching
 * milestone column, which is correct for a live status change but wrong
 * here: an imported row's booked_at/contract_at/etc. are real historical
 * dates from the source sheet, not "today". Same reasoning the PO import
 * used to write directly rather than through po_create (see memory
 * project-buildflow-po-import) - a live-operation RPC would misrepresent
 * when the event actually happened.
 *
 * One row at a time rather than a single batch insert: a multi-row insert
 * fails entirely on the first constraint violation, which would turn one bad
 * row into a reason to drop the whole file. Each row's own success/failure
 * is reported back instead.
 */
export async function importSalesRecords(rows: SalesImportCommitRow[]): Promise<SalesImportResult> {
  await requireModuleAccess('sales')
  const supabase = await createClient()
  const user = await getCurrentUser()

  let inserted = 0
  let skipped = 0
  const errors: { plotId: string; message: string }[] = []

  for (const row of rows) {
    const { data: existing } = await supabase
      .from('plot_sales')
      .select('id')
      .eq('plot_id', row.plotId)
      .is('cancelled_at', null)
      .maybeSingle()
    if (existing) {
      skipped++
      continue
    }

    let customerId: string | null = null
    if (row.customerName.trim()) {
      const { data: customer, error: custError } = await supabase
        .from('customers')
        .insert({
          full_name: row.customerName.trim(),
          phone: row.customerPhone.trim() || null,
          lead_source: 'นำเข้าจากระบบเดิม',
          created_by: user?.id,
        })
        .select('id')
        .single()
      if (custError) {
        errors.push({ plotId: row.plotId, message: custError.message })
        continue
      }
      customerId = customer.id
    }

    const { data: sale, error: saleError } = await supabase
      .from('plot_sales')
      .insert({
        plot_id: row.plotId,
        customer_id: customerId,
        status_code: row.statusCode,
        sales_rep_id: user?.id,
        sale_price: row.salePrice,
        booked_at: row.bookedAt,
        contract_at: row.contractAt,
        inspection_at: row.inspectionAt,
        transfer_at: row.transferAt,
        note: row.note ? `${row.note} (นำเข้าจากระบบเดิม)` : 'นำเข้าจากระบบเดิม',
        created_by: user?.id,
      })
      .select('id')
      .single()
    if (saleError) {
      errors.push({ plotId: row.plotId, message: saleError.message })
      continue
    }

    await supabase.from('plot_sale_events').insert({
      plot_sale_id: sale.id,
      event_type: 'import',
      to_status: row.statusCode,
      actor_id: user?.id,
      note: 'นำเข้าจากระบบเดิม',
    })

    inserted++
  }

  revalidatePath('/dashboard/sales')
  return { inserted, skipped, errors }
}

// ---------------------------------------------------------------------------
// Site plan map view (Phase 4, promoted per D4). plots.map_x/map_y already
// exist from Phase 0; this adds the plan image itself (projects.site_plan_*)
// and the read/write actions around it.
//
// Reading the map is gated on 'sales' alone, not ['sales','projects'] -
// under the locked Phase 1 permission table every role that can have
// 'projects' (admin, pm) also has 'sales', so the OR-gate would only add a
// path where a caller passes this gate but then fails inside getSalesBoard's
// own requireModuleAccess('sales') call. Editing (upload/place/move a
// marker) stays 'projects'-only per the plan - admin/pm, never sales.
// ---------------------------------------------------------------------------

export type SitePlanPlot = {
  id: string
  name: string
  statusCode: string
  statusLabel: string
  statusColor: string
  mapX: number | null
  mapY: number | null
  houseModelName: string | null
  customerName: string | null
  listPrice: number | null
  salePrice: number | null
  jobsDone: number
  jobsTotal: number
  progressPercent: number
}

export type SitePlanData = {
  projectName: string
  sitePlanUrl: string | null
  sitePlanWidth: number | null
  sitePlanHeight: number | null
  plots: SitePlanPlot[]
}

export async function getSitePlanData(projectId: string): Promise<SitePlanData> {
  await requireModuleAccess('sales')

  const empty: SitePlanData = { projectName: '', sitePlanUrl: null, sitePlanWidth: null, sitePlanHeight: null, plots: [] }
  if (!projectId) return empty

  const supabase = await createClient()
  const [projectRes, boardRows, positionsRes] = await Promise.all([
    supabase.from('projects').select('name, site_plan_url, site_plan_width, site_plan_height').eq('id', projectId).maybeSingle(),
    getSalesBoard(projectId),
    supabase.from('plots').select('id, map_x, map_y').eq('project_id', projectId).eq('is_sellable', true),
  ])
  if (projectRes.error) throw new Error(projectRes.error.message)
  if (positionsRes.error) throw new Error(positionsRes.error.message)

  const posByPlot = new Map((positionsRes.data || []).map((p) => [p.id, { mapX: p.map_x, mapY: p.map_y }]))

  return {
    projectName: projectRes.data?.name || '',
    sitePlanUrl: projectRes.data?.site_plan_url || null,
    sitePlanWidth: projectRes.data?.site_plan_width || null,
    sitePlanHeight: projectRes.data?.site_plan_height || null,
    plots: boardRows.map((row) => ({
      id: row.plot_id,
      name: row.plot_name,
      statusCode: row.status_code,
      statusLabel: row.status_label,
      statusColor: row.status_color,
      mapX: posByPlot.get(row.plot_id)?.mapX ?? null,
      mapY: posByPlot.get(row.plot_id)?.mapY ?? null,
      houseModelName: row.house_model_name,
      customerName: row.customer_name,
      listPrice: row.list_price,
      salePrice: row.sale_price,
      jobsDone: row.jobs_done,
      jobsTotal: row.jobs_total,
      progressPercent: row.progress_percent,
    })),
  }
}

export type SitePlanUploadResult = { success: true; url: string } | { success: false; error: string }

/**
 * The natural pixel width/height are measured client-side (an <img>/Image()
 * in the browser, where decoding actually happens) and passed in rather than
 * computed here - Node has no image decoder available for a raw upload
 * buffer without pulling in a native dependency, and the editor only needs
 * the number, not the decoded pixels.
 */
export async function uploadSitePlan(formData: FormData): Promise<SitePlanUploadResult> {
  await requireModuleAccess('projects')
  const supabase = await createClient()

  const projectId = String(formData.get('project_id') || '')
  const file = formData.get('file') as File | null
  const width = Number(formData.get('width') || 0)
  const height = Number(formData.get('height') || 0)

  if (!projectId) return { success: false, error: 'ไม่พบโครงการ' }
  if (!file || file.size === 0) return { success: false, error: 'กรุณาเลือกไฟล์' }
  if (!width || !height) return { success: false, error: 'อ่านขนาดภาพไม่สำเร็จ' }

  const ext = (file.name.split('.').pop() || 'png').toLowerCase()
  const filePath = `public/site-plan-${projectId}-${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage.from('assets').upload(filePath, file)
  if (uploadError) return { success: false, error: uploadError.message }

  const { data: urlData } = supabase.storage.from('assets').getPublicUrl(filePath)

  const { error } = await supabase
    .from('projects')
    .update({ site_plan_url: urlData.publicUrl, site_plan_width: width, site_plan_height: height })
    .eq('id', projectId)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/sales')
  return { success: true, url: urlData.publicUrl }
}

/** mapX/mapY null clears a plot's placement (removes its marker from the
 * map without touching its sale status). */
export async function updatePlotMapPosition(plotId: string, mapX: number | null, mapY: number | null) {
  await requireModuleAccess('projects')
  const supabase = await createClient()
  const { error } = await supabase.from('plots').update({ map_x: mapX, map_y: mapY }).eq('id', plotId)
  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/sales')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Plot detail, both departments (Phase 5, SALES_MODULE_PLAN.md §8.3).
//
// Reads here are deliberately NOT gated with requireModuleAccess - same as
// the existing getPlotById/getJobAssignments in actions/job-actions.ts. The
// plot detail route now gates on ['projects','sales'] (page.tsx), which lets
// foreman (projects, no sales) keep viewing the page; if these reads also
// hard-required 'sales', a foreman viewer would get redirected out of a page
// they're otherwise allowed to see, just because one tab's data doesn't
// apply to them. Row-level security on plot_sales/customers/plot_sale_events
// (admin/pm/sales only, from Phase 2) is what actually keeps a foreman
// caller from seeing rows - this just returns empty for them, not an error.
// Writes stay gated on 'sales', which is exactly {admin,pm,sales} under the
// locked Phase 1 default permissions - foreman correctly can't call them.
// ---------------------------------------------------------------------------

export type PlotSaleDetail = {
  sale: {
    id: string
    statusCode: string
    statusLabel: string
    statusColor: string
    stage: string
    listPrice: number | null
    salePrice: number | null
    discountNote: string | null
    bookingAmount: number | null
    contractAmount: number | null
    downTotal: number | null
    loanBank: string | null
    loanAmount: number | null
    bookedAt: string | null
    contractAt: string | null
    loanSubmittedAt: string | null
    loanApprovedAt: string | null
    inspectionAt: string | null
    transferAt: string | null
    deliveredAt: string | null
    cancelReason: string | null
    note: string | null
    salesRepName: string | null
  } | null
  customer: {
    id: string
    fullName: string
    phone: string | null
    email: string | null
    idCard: string | null
    address: string | null
    leadSource: string | null
    note: string | null
  } | null
}

export async function getPlotSaleDetail(plotId: string): Promise<PlotSaleDetail> {
  const supabase = await createClient()
  const { data: sale, error } = await supabase
    .from('plot_sales')
    .select(`
      id, status_code, list_price, sale_price, discount_note, booking_amount, contract_amount,
      down_total, loan_bank, loan_amount, booked_at, contract_at, loan_submitted_at,
      loan_approved_at, inspection_at, transfer_at, delivered_at, cancel_reason, note,
      sale_statuses (label, color, stage),
      customers (id, full_name, phone, email, id_card, address, lead_source, note),
      profiles!plot_sales_sales_rep_id_fkey (full_name)
    `)
    .eq('plot_id', plotId)
    .is('cancelled_at', null)
    .maybeSingle()

  if (error || !sale) return { sale: null, customer: null }

  const statusInfo = sale.sale_statuses as unknown as { label: string; color: string; stage: string } | null
  // The blanket `as unknown as PlotSaleDetail['customer']` cast this replaced
  // never actually renamed fields - full_name/id_card/lead_source stayed
  // snake_case at runtime while the type claimed fullName/idCard/leadSource,
  // so those three always read as undefined (silently blank in the form)
  // regardless of what was actually saved.
  const rawCustomer = sale.customers as unknown as {
    id: string
    full_name: string
    phone: string | null
    email: string | null
    id_card: string | null
    address: string | null
    lead_source: string | null
    note: string | null
  } | null
  const customer: PlotSaleDetail['customer'] = rawCustomer
    ? {
        id: rawCustomer.id,
        fullName: rawCustomer.full_name,
        phone: rawCustomer.phone,
        email: rawCustomer.email,
        idCard: rawCustomer.id_card,
        address: rawCustomer.address,
        leadSource: rawCustomer.lead_source,
        note: rawCustomer.note,
      }
    : null
  const rep = sale.profiles as unknown as { full_name: string | null } | null

  return {
    sale: {
      id: sale.id,
      statusCode: sale.status_code,
      statusLabel: statusInfo?.label || sale.status_code,
      statusColor: statusInfo?.color || 'slate',
      stage: statusInfo?.stage || 'open',
      listPrice: sale.list_price,
      salePrice: sale.sale_price,
      discountNote: sale.discount_note,
      bookingAmount: sale.booking_amount,
      contractAmount: sale.contract_amount,
      downTotal: sale.down_total,
      loanBank: sale.loan_bank,
      loanAmount: sale.loan_amount,
      bookedAt: sale.booked_at,
      contractAt: sale.contract_at,
      loanSubmittedAt: sale.loan_submitted_at,
      loanApprovedAt: sale.loan_approved_at,
      inspectionAt: sale.inspection_at,
      transferAt: sale.transfer_at,
      deliveredAt: sale.delivered_at,
      cancelReason: sale.cancel_reason,
      note: sale.note,
      salesRepName: rep?.full_name || null,
    },
    customer,
  }
}

export type PlotSaleHistoryJobLine = {
  itemName: string
  unit: string
  /** Pre-formatted since the two sources mean different things - "80%" for
   * a progress claim against an existing BOQ job, "9 เมตร" or "หัก 2 ต้น"
   * for a DC's ad-hoc line item (billing_adjustments has no progress
   * concept, just a quantity and addition/deduction). */
  quantityLabel: string
  amount: number | null
}

export type PlotSaleHistoryEntry = {
  id: string
  kind: 'sale_event' | 'billing'
  happenedAt: string
  label: string
  detail: string | null
  amount: number | null
  actorName: string | null
  jobs?: PlotSaleHistoryJobLine[]
}

/** Merged timeline: every plot_sales this plot has ever had (including
 * cancelled ones, so a past deal's history doesn't vanish on re-sale) plus
 * this plot's billings (progress claims and DCs). Amount is stripped by the
 * caller when canSeeCost is false, same as the other tabs - not done here,
 * since this function has no permission context of its own by design. */
export async function getPlotSaleHistory(plotId: string): Promise<PlotSaleHistoryEntry[]> {
  const supabase = await createClient()

  const { data: sales } = await supabase.from('plot_sales').select('id').eq('plot_id', plotId)
  const saleIds = (sales || []).map((s) => s.id)

  const [plotRes, eventsRes, billingsRes] = await Promise.all([
    // Needed to match this plot against billing_adjustments' [PLOT:name]
    // tag below - a DC can bundle several plots' work under one billing
    // filed against a single anchor plot_id, so billing_id alone isn't
    // enough to tell which line items are actually this plot's.
    supabase.from('plots').select('name').eq('id', plotId).maybeSingle(),
    saleIds.length > 0
      ? supabase
          .from('plot_sale_events')
          .select('id, event_type, from_status, to_status, happened_at, note, profiles (full_name)')
          .in('plot_sale_id', saleIds)
      : Promise.resolve({ data: [] as unknown[] }),
    // billings.submitted_by has no FK constraint to profiles (checked
    // against the live schema - only contractor_id/project_id/paid_out_by
    // do), so PostgREST can't auto-embed it. Names are looked up separately
    // below instead of `profiles!billings_submitted_by_fkey (...)`, which
    // would 400 at request time with no such relationship.
    supabase
      .from('billings')
      .select(`
        id, billing_date, created_at, type, status, net_amount, reason_for_dc, doc_no, submitted_by,
        billing_jobs (
          amount,
          progress_percent,
          job_assignments (
            boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name, unit)
          )
        ),
        billing_adjustments (
          type, description, unit, quantity, total_amount
        )
      `)
      .eq('plot_id', plotId),
  ])

  const plotName = plotRes.data?.name || ''

  const submitterIds = Array.from(
    new Set(((billingsRes.data || []) as Array<{ submitted_by: string | null }>).map((b) => b.submitted_by).filter((id): id is string => Boolean(id)))
  )
  const submitterNames = new Map<string, string>()
  if (submitterIds.length > 0) {
    const { data: submitters } = await supabase.from('profiles').select('id, full_name').in('id', submitterIds)
    for (const p of submitters || []) submitterNames.set(p.id, p.full_name || '')
  }

  const events: PlotSaleHistoryEntry[] = ((eventsRes.data || []) as unknown as Array<{
    id: string
    event_type: string
    from_status: string | null
    to_status: string | null
    happened_at: string
    note: string | null
    profiles: { full_name: string | null } | null
  }>).map((e) => ({
    id: `event-${e.id}`,
    kind: 'sale_event',
    happenedAt: e.happened_at,
    label: e.from_status ? `${e.from_status} → ${e.to_status}` : `เริ่มบันทึก: ${e.to_status}`,
    detail: e.note,
    amount: null,
    actorName: e.profiles?.full_name || null,
  }))

  const billings: PlotSaleHistoryEntry[] = ((billingsRes.data || []) as unknown as Array<{
    id: string
    billing_date: string | null
    created_at: string
    type: string | null
    status: string
    net_amount: number | null
    reason_for_dc: string | null
    doc_no: number | string | null
    submitted_by: string | null
    billing_jobs: Array<{
      amount: number | null
      progress_percent: number | null
      job_assignments: { boq_master: { item_name: string | null; unit: string | null } | null } | null
    }> | null
    billing_adjustments: Array<{
      type: string
      description: string | null
      unit: string | null
      quantity: number | null
      total_amount: number | null
    }> | null
  }>).map((b) => {
    const jobLines: PlotSaleHistoryJobLine[] = (b.billing_jobs || []).map((j) => ({
      itemName: j.job_assignments?.boq_master?.item_name || 'ไม่ระบุรายการ',
      unit: j.job_assignments?.boq_master?.unit || '',
      quantityLabel: `${Math.round(j.progress_percent || 0)}%`,
      amount: j.amount,
    }))

    // A DC can bundle several plots' work under one billing filed against a
    // single anchor plot_id (see encodeAdjustmentDescription /
    // decodeAdjustmentDescription in actions/_shared/billing-adjustments.ts)
    // - only lines actually tagged for THIS plot, or untagged (a plain
    // single-plot DC never adds the tag at all), belong in its history.
    const adjustmentLines: PlotSaleHistoryJobLine[] = (b.billing_adjustments || [])
      .map((a) => ({ ...a, ...decodeAdjustmentDescription(a.description) }))
      .filter((a) => !a.plot_name || a.plot_name === plotName)
      .map((a) => ({
        itemName: a.description || 'ไม่ระบุรายการ',
        unit: a.unit || '',
        quantityLabel: `${a.type === 'deduction' ? 'หัก ' : ''}${a.quantity ?? ''} ${a.unit || ''}`.trim(),
        amount: a.total_amount == null ? null : a.type === 'deduction' ? -a.total_amount : a.total_amount,
      }))

    return {
      id: `billing-${b.id}`,
      kind: 'billing' as const,
      happenedAt: b.billing_date || b.created_at,
      label: b.type === 'extra_work' ? `DC #${b.doc_no ?? ''}` : `เบิกความคืบหน้า #${b.doc_no ?? ''}`,
      detail: b.reason_for_dc || `สถานะ: ${b.status}`,
      amount: b.net_amount,
      actorName: (b.submitted_by && submitterNames.get(b.submitted_by)) || null,
      jobs: [...jobLines, ...adjustmentLines],
    }
  })

  return [...events, ...billings].sort((a, b) => new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime())
}

/**
 * Direct field update on an existing deal - everything the การขาย tab's form
 * covers except status_code (that stays sales_change_status()'s job, since a
 * status change must always log a plot_sale_events row with a note; editing
 * the down-payment amount or a loan bank isn't a status change and doesn't
 * need one).
 */
export async function updatePlotSaleDetails(saleId: string, formData: FormData) {
  await requireModuleAccess('sales')
  const supabase = await createClient()

  const num = (key: string) => {
    const raw = String(formData.get(key) || '').trim()
    return raw ? Number(raw) : null
  }
  const text = (key: string) => {
    const raw = String(formData.get(key) || '').trim()
    return raw || null
  }
  const date = (key: string) => {
    const raw = String(formData.get(key) || '').trim()
    return raw || null
  }

  const { error } = await supabase
    .from('plot_sales')
    .update({
      list_price: num('list_price'),
      sale_price: num('sale_price'),
      discount_note: text('discount_note'),
      booking_amount: num('booking_amount'),
      contract_amount: num('contract_amount'),
      down_total: num('down_total'),
      loan_bank: text('loan_bank'),
      loan_amount: num('loan_amount'),
      booked_at: date('booked_at'),
      contract_at: date('contract_at'),
      loan_submitted_at: date('loan_submitted_at'),
      loan_approved_at: date('loan_approved_at'),
      inspection_at: date('inspection_at'),
      transfer_at: date('transfer_at'),
      delivered_at: date('delivered_at'),
      note: text('note'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', saleId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/projects')
  revalidatePath('/dashboard/sales')
  return { success: true }
}

/** Single-field write for "ใช้ราคานี้เป็นราคาขายจริง" on the promotion
 * breakdown card - a lighter path than resubmitting the whole การขาย form
 * just to change one number. */
export async function updateSalePrice(saleId: string, price: number) {
  await requireModuleAccess('sales')
  if (!Number.isFinite(price) || price < 0) return { success: false, error: 'ราคาไม่ถูกต้อง' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('plot_sales')
    .update({ sale_price: price, updated_at: new Date().toISOString() })
    .eq('id', saleId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/projects')
  revalidatePath('/dashboard/sales')
  return { success: true }
}

export async function updateCustomer(customerId: string, formData: FormData) {
  await requireModuleAccess('sales')
  const supabase = await createClient()

  const fullName = String(formData.get('full_name') || '').trim()
  if (!fullName) return { success: false, error: 'กรุณาใส่ชื่อลูกค้า' }

  const text = (key: string) => {
    const raw = String(formData.get(key) || '').trim()
    return raw || null
  }

  const { error } = await supabase
    .from('customers')
    .update({
      full_name: fullName,
      phone: text('phone'),
      email: text('email'),
      id_card: text('id_card'),
      address: text('address'),
      lead_source: text('lead_source'),
      note: text('note'),
    })
    .eq('id', customerId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/projects')
  return { success: true }
}

/**
 * A deal can exist with no customer attached - e.g. its status was set
 * directly (import, admin correction) rather than through
 * changeSaleStatus()'s "start sale" path, which is the only other place a
 * customer gets created. This is the ข้อมูลลูกค้า tab's fallback for that
 * case: create the customer row and point this sale at it in one step,
 * since there's otherwise no way to attach one after the fact.
 */
export async function createCustomerForSale(saleId: string, formData: FormData) {
  await requireModuleAccess('sales')
  const supabase = await createClient()

  const fullName = String(formData.get('full_name') || '').trim()
  if (!fullName) return { success: false, error: 'กรุณาใส่ชื่อลูกค้า' }

  const text = (key: string) => {
    const raw = String(formData.get(key) || '').trim()
    return raw || null
  }

  const user = await getCurrentUser()
  const { data: customer, error: insertError } = await supabase
    .from('customers')
    .insert({
      full_name: fullName,
      phone: text('phone'),
      email: text('email'),
      id_card: text('id_card'),
      address: text('address'),
      lead_source: text('lead_source'),
      note: text('note'),
      created_by: user?.id || null,
    })
    .select('id')
    .single()

  if (insertError) return { success: false, error: insertError.message }

  const { error: linkError } = await supabase
    .from('plot_sales')
    .update({ customer_id: customer.id })
    .eq('id', saleId)

  if (linkError) return { success: false, error: linkError.message }
  revalidatePath('/dashboard/projects')
  return { success: true }
}

export type PlotMaterialRow = PlotMaterialSummaryRow

/**
 * Dedicated plot-scoped materials query rather than calling the existing
 * getMaterialsSummaryForProject (actions/procurement/materials-summary.ts) -
 * that function is gated on ['procurement','cost_control'], neither of which
 * 'sales' has, and widening its gate would make full unit-price data
 * reachable by any sales session that knows the action exists, not just
 * through this stripped view. Same 3 PO-plot-scope shapes it resolves
 * (direct plot_id, plot_group_id, purchase_order_plots junction), just
 * narrowed to one plot instead of a scope object.
 */
export async function getPlotMaterialsSummary(plotId: string, projectId: string): Promise<PlotMaterialRow[]> {
  const supabase = await createClient()

  const { data: groupRow } = await supabase
    .from('plot_group_members')
    .select('group_id')
    .eq('plot_id', plotId)
    .maybeSingle()
  const groupId = groupRow?.group_id || null

  type QueriedAllocation = {
    id: string
    quantity_allocated: number | string
    purchase_request_items: {
      purchase_request_id: string
      purchase_requests: {
        id: string
        pr_no: number
        plot_id: string | null
        plot_group_id: string | null
        plot_groups: { plot_group_members: { plot_id: string }[] | null } | null
        purchase_request_plots: { plot_id: string }[] | null
      } | null
    } | null
  }
  type QueriedItem = {
    id: string
    material_type_id: number
    quantity_ordered: number | string | null
    quantity_received: number | string | null
    unit_price: number | string | null
    project_id: string | null
    plot_id: string | null
    plot_group_id: string | null
    material_types: { name: string; unit: string } | null
    plot_groups: { plot_group_members: { plot_id: string }[] | null } | null
    purchase_order_item_allocations: QueriedAllocation[] | null
  }
  type QueriedOrder = {
    id: string
    po_no: string
    plot_id: string | null
    plot_group_id: string | null
    plot_groups: { plot_group_members: { plot_id: string }[] | null } | null
    purchase_order_plots: { plot_id: string }[] | null
    purchase_order_items: QueriedItem[] | null
  }

  const ITEM_COLUMNS = `id, material_type_id, quantity_ordered, quantity_received, unit_price, project_id, plot_id, plot_group_id,
         material_types (name, unit),
         plot_groups (plot_group_members (plot_id)),
         purchase_order_item_allocations (
           id, quantity_allocated,
           purchase_request_items (
             purchase_request_id,
             purchase_requests (
               id, pr_no, plot_id, plot_group_id,
               plot_groups (plot_group_members (plot_id)),
               purchase_request_plots (plot_id)
             )
           )
         )`

  // A line's allocated quantity is attributed through its allocations (each
  // counts for its own request's plots) - never through the order header, so
  // a combined PO that lists several plots does not put the whole line on
  // each. Only the part of a line no allocation covers falls back to the two
  // older rules: a line that never overrode its scope inherits the ORDER's
  // project/plot (matched against the order's own plot/group/multi-plot), and
  // a line overridden straight to this project is matched against its OWN
  // plot/group - regardless of which project its order was placed under (see
  // 202609220002_po_item_project_plot_override.sql).
  const [inheritedRes, overriddenRes, crossRes] = await Promise.all([
    supabase
      .from('purchase_orders')
      .select(
        `id, po_no, status, plot_id, plot_group_id,
         plot_groups (plot_group_members (plot_id)),
         purchase_order_plots (plot_id),
         purchase_order_items (${ITEM_COLUMNS})`
      )
      .eq('project_id', projectId)
      .neq('status', 'cancelled'),
    supabase
      .from('purchase_order_items')
      .select(
        `${ITEM_COLUMNS},
         purchase_orders!inner (id, po_no, status)`
      )
      .eq('project_id', projectId)
      .neq('purchase_orders.status', 'cancelled'),
    // An order raised under ANOTHER project can still buy for this project's
    // requests (one supplier delivering to several sites). Only the
    // allocations to this project's requests come back here; nothing else on
    // such a line belongs to this project.
    supabase
      .from('purchase_order_items')
      .select(
        `id, material_type_id, quantity_ordered, quantity_received, unit_price, project_id, plot_id, plot_group_id,
         material_types (name, unit),
         purchase_order_item_allocations!inner (
           id, quantity_allocated,
           purchase_request_items!inner (
             purchase_request_id,
             purchase_requests!inner (
               id, pr_no, project_id, plot_id, plot_group_id,
               plot_groups (plot_group_members (plot_id)),
               purchase_request_plots (plot_id)
             )
           )
         ),
         purchase_orders!inner (id, po_no, status)`
      )
      .neq('purchase_orders.status', 'cancelled')
      .neq('purchase_orders.project_id', projectId)
      .eq('purchase_order_item_allocations.purchase_request_items.purchase_requests.project_id', projectId),
  ])
  if (inheritedRes.error) throw new Error(inheritedRes.error.message)
  if (overriddenRes.error) throw new Error(overriddenRes.error.message)
  // The cross-project lookup is an add-on: if it ever fails, the plot's own
  // materials must still show, so its error is logged and skipped.
  if (crossRes.error) console.error('plot materials: cross-project lookup failed', crossRes.error.message)

  const toLine = (item: QueriedItem, poId: string, poNo: string, remainderWeight: number): PlotSummaryLine => ({
    poItemId: item.id,
    poId,
    poNo,
    materialTypeId: item.material_type_id,
    materialName: item.material_types?.name || '-',
    unit: item.material_types?.unit || '',
    quantityOrdered: Number(item.quantity_ordered) || 0,
    quantityReceived: Number(item.quantity_received) || 0,
    unitPrice: Number(item.unit_price) || 0,
    remainderWeight,
    allocations: (item.purchase_order_item_allocations || []).flatMap((a) => {
      const pr = a.purchase_request_items?.purchase_requests
      if (!pr) return []
      const members =
        pr.plot_id != null
          ? []
          : pr.plot_group_id != null
            ? (pr.plot_groups?.plot_group_members || []).map((m) => m.plot_id)
            : (pr.purchase_request_plots || []).map((p) => p.plot_id)
      return [
        {
          allocationId: a.id,
          quantity: Number(a.quantity_allocated) || 0,
          purchaseRequestId: pr.id,
          prNo: pr.pr_no,
          scope: { plotId: pr.plot_id, plotGroupId: pr.plot_group_id, memberPlotIds: members },
        },
      ]
    }),
  })

  // Share of a line's unallocated part that lands on this plot: the whole of
  // it for a single plot, an even split across a group's or a multi-plot
  // selection's plots (the same split the cost-control rollup uses) - so the
  // remainder is counted once across the header's plots, not once per plot.
  const groupWeight = (members: { plot_id: string }[] | null | undefined, fallbackMatches: boolean): number => {
    const ids = (members || []).map((m) => m.plot_id)
    if (ids.length === 0) return fallbackMatches ? 1 : 0
    return ids.includes(plotId) ? 1 / ids.length : 0
  }
  const orderRemainderWeight = (order: QueriedOrder): number => {
    if (order.plot_id) return order.plot_id === plotId ? 1 : 0
    if (order.plot_group_id) return groupWeight(order.plot_groups?.plot_group_members, groupId != null && order.plot_group_id === groupId)
    const plots = (order.purchase_order_plots || []).map((p) => p.plot_id)
    return plots.includes(plotId) ? 1 / plots.length : 0
  }

  const lines = new Map<string, PlotSummaryLine>()

  const orders = (inheritedRes.data as unknown as QueriedOrder[]) || []
  for (const order of orders) {
    const orderWeight = orderRemainderWeight(order)
    for (const item of order.purchase_order_items || []) {
      // A line overridden away from this order's own scope has its remainder
      // matched by its own plot/group below instead.
      lines.set(item.id, toLine(item, order.id, order.po_no, item.project_id == null ? orderWeight : 0))
    }
  }

  for (const item of (overriddenRes.data as unknown as (QueriedItem & { purchase_orders: { id: string; po_no: string } })[]) || []) {
    const itemWeight = item.plot_id
      ? item.plot_id === plotId
        ? 1
        : 0
      : item.plot_group_id
        ? groupWeight(item.plot_groups?.plot_group_members, groupId != null && item.plot_group_id === groupId)
        : 0
    lines.set(item.id, toLine(item, item.purchase_orders.id, item.purchase_orders.po_no, itemWeight))
  }

  // Lines from other projects' orders: allocations only, never a remainder.
  for (const item of ((crossRes.error ? [] : crossRes.data) as unknown as (QueriedItem & { purchase_orders: { id: string; po_no: string } })[]) || []) {
    if (lines.has(item.id)) continue
    lines.set(item.id, toLine(item, item.purchase_orders.id, item.purchase_orders.po_no, 0))
  }

  return summarizePlotMaterials(Array.from(lines.values()), plotId)
}
