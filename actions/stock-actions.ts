'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { fetchAllRows } from '@/actions/_shared/fetch-all-rows'
import type { ActiveMaterialRow, ConsumptionReport, ConsumptionRow, LowStockRow, StockMovement, StockOverviewRow } from '@/lib/types/stock'

// Stock lives under the `materials` permission, not a new module of its own -
// it's the same catalog, just showing on-hand quantity instead of catalog
// fields, and every role that can see materials should be able to see stock.

/** Every active material, joined against stock_balances. `tracked: false`
 * means no stock_balances row exists yet (never received, withdrawn, or
 * migrated) - the page defaults to hiding these, but the flag lets it show
 * "no activity yet" instead of a plain 0 for anyone who searches for one. */
type StockOverviewMaterialRow = { id: number; name: string; unit: string; category: string | null; is_requestable: boolean }
type StockBalanceRow = { material_type_id: number; quantity_on_hand: number }

export async function getStockOverview(): Promise<StockOverviewRow[]> {
  await requireModuleAccess('materials')
  const supabase = await createClient()

  // Both tables are read in full here, unpaginated by any filter narrow
  // enough to guarantee staying under PostgREST's 1000-row default cap -
  // material_types already crossed it once (1169 active rows silently lost
  // everything past #1000 alphabetically), and stock_balances gets one row
  // per material that's ever had any movement, so it's headed the same way.
  const [materials, balances] = await Promise.all([
    fetchAllRows<StockOverviewMaterialRow>((from, to) =>
      supabase.from('material_types').select('id, name, unit, category, is_requestable').eq('is_active', true).order('name').range(from, to)
    ),
    fetchAllRows<StockBalanceRow>((from, to) =>
      supabase.from('stock_balances').select('material_type_id, quantity_on_hand').order('material_type_id').range(from, to)
    ),
  ])

  const balanceByMaterial = new Map(balances.map((b) => [b.material_type_id, Number(b.quantity_on_hand)]))

  return materials.map((m) => ({
    material_type_id: m.id,
    name: m.name,
    unit: m.unit,
    category: m.category,
    quantity_on_hand: balanceByMaterial.get(m.id) ?? 0,
    tracked: balanceByMaterial.has(m.id),
    is_requestable: m.is_requestable,
  }))
}

const MOVEMENT_SELECT =
  '*, material_types (id, name, unit), projects (id, name), contractors (id, name), plots (id, name), plot_groups (id, name), requested_by_profile:profiles!stock_movements_requested_by_fkey (id, full_name)'

export async function getMaterialStockDetail(materialTypeId: number): Promise<{
  material: { id: number; name: string; unit: string; category: string | null; is_requestable: boolean }
  quantity_on_hand: number
  movements: StockMovement[]
  /** Stock count adjustment is pm/admin only - the same segregation-of-duties
   * reasoning as material-actions.ts's isPrivileged check, so the role that
   * withdraws stock isn't also the one correcting the balance unchecked. The
   * RPC enforces this too; this just lets the page hide the button instead
   * of showing it and failing on submit. */
  canAdjust: boolean
}> {
  const { role } = await requireModuleAccess('materials')
  const supabase = await createClient()

  const [{ data: material, error: matError }, { data: balance }, { data: movements, error: movError }] =
    await Promise.all([
      supabase.from('material_types').select('id, name, unit, category, is_requestable').eq('id', materialTypeId).single(),
      supabase.from('stock_balances').select('quantity_on_hand').eq('material_type_id', materialTypeId).maybeSingle(),
      supabase
        .from('stock_movements')
        .select(MOVEMENT_SELECT)
        .eq('material_type_id', materialTypeId)
        .order('created_at', { ascending: false }),
    ])

  if (matError) throw new Error(matError.message)
  if (movError) throw new Error(movError.message)
  if (!material) throw new Error('Material not found')

  return {
    material,
    quantity_on_hand: Number(balance?.quantity_on_hand ?? 0),
    movements: (movements as unknown as StockMovement[]) || [],
    canAdjust: role === 'pm' || role === 'admin',
  }
}

// ---------------------------------------------------------------------------
// Stock count / adjustment (Phase D) - corrects the system balance to match
// a physical count. Same "no approval gate, direct write, audit via the
// ledger" policy as withdrawals; stock_adjustment_create restricts who can
// write at all (pm/admin) rather than gating the write itself.
// ---------------------------------------------------------------------------

export type StockAdjustmentResult = {
  material_type_id: number
  prev_qty: number
  new_qty: number
  delta: number
}

export async function createStockAdjustment(input: {
  material_type_id: number
  counted_qty: number
  note: string
}): Promise<StockAdjustmentResult> {
  await requireModuleAccess('materials')
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('stock_adjustment_create', {
    p_material_type_id: input.material_type_id,
    p_counted_qty: input.counted_qty,
    p_note: input.note.trim() || null,
  })

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/stock')
  return data as StockAdjustmentResult
}

/** Capped at 500 rows - the whole ledger is 117 rows today, all from one
 * migration. The page filters this client-side (material, type, source,
 * project, contractor, date all ride along on each row already via the
 * joins above) rather than round-tripping per filter change. If this ever
 * needs real server-side filtering/pagination, that's a sign contractor
 * withdrawals actually took off, which is the point. */
export async function getStockMovements(): Promise<StockMovement[]> {
  await requireModuleAccess('materials')
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('stock_movements')
    .select(MOVEMENT_SELECT)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) throw new Error(error.message)
  return (data as unknown as StockMovement[]) || []
}

// ---------------------------------------------------------------------------
// Desktop withdrawal (Phase B) - the same action the mobile app does,
// available from the office too. Calls the exact stock_request_create RPC
// Phase 2 already shipped and guard-tested; nothing new on the database side.
// ---------------------------------------------------------------------------

/** Lightweight id+name lists for the withdraw form's pickers - deliberately
 * not reusing getContractors() from contractor-actions.ts, which joins in
 * contractor_types and computed payment totals this form has no use for. */
export async function getStockWithdrawPickerOptions(): Promise<{
  projects: { id: string; name: string }[]
  contractors: { id: string; name: string }[]
}> {
  await requireModuleAccess('materials')
  const supabase = await createClient()

  const [{ data: projects, error: projError }, { data: contractors, error: contError }] = await Promise.all([
    supabase.from('projects').select('id, name').order('name'),
    supabase.from('contractors').select('id, name').order('name'),
  ])

  if (projError) throw new Error(projError.message)
  if (contError) throw new Error(contError.message)

  return { projects: projects || [], contractors: contractors || [] }
}

export type StockWithdrawResult = {
  batch_id: string
  items: { material_type_id: number; quantity: number; new_qty: number }[]
}

export async function createStockWithdrawal(input: {
  project_id: string
  contractor_id: string
  /** Mutually exclusive with plot_group_id - one specific plot, or the
   * whole project (both null) when the material isn't house-specific. */
  plot_id?: string | null
  /** Mutually exclusive with plot_id - a whole batch of plots (e.g.
   * "98-102"), same concept material_usage_log already uses. */
  plot_group_id?: string | null
  note?: string
  items: { material_type_id: number; quantity: number }[]
}): Promise<StockWithdrawResult> {
  await requireModuleAccess('materials')
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('stock_request_create', {
    p_payload: {
      project_id: input.project_id,
      contractor_id: input.contractor_id,
      plot_id: input.plot_id || null,
      plot_group_id: input.plot_group_id || null,
      note: input.note?.trim() || null,
      items: input.items,
    },
  })

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/stock')
  return data as StockWithdrawResult
}

// ---------------------------------------------------------------------------
// Reports (Phase C) - low stock needs the reorder_point column (Settings >
// Material Catalog sets it); consumption and "most active" read straight off
// stock_movements, no schema change needed. Both will look sparse until real
// contractor withdrawals accrue - today's ledger is 117 rows, all from the
// one-time opening-balance migration, so there is no real 'out' history yet.
// ---------------------------------------------------------------------------

export async function getLowStockMaterials(): Promise<LowStockRow[]> {
  await requireModuleAccess('materials')
  const supabase = await createClient()

  const { data: materials, error: matError } = await supabase
    .from('material_types')
    .select('id, name, unit, category, reorder_point')
    .eq('is_active', true)
    .not('reorder_point', 'is', null)

  if (matError) throw new Error(matError.message)
  if (!materials || materials.length === 0) return []

  const ids = materials.map((m) => m.id)
  const { data: balances, error: balError } = await supabase
    .from('stock_balances')
    .select('material_type_id, quantity_on_hand')
    .in('material_type_id', ids)

  if (balError) throw new Error(balError.message)
  const balanceByMaterial = new Map((balances || []).map((b) => [b.material_type_id, Number(b.quantity_on_hand)]))

  return materials
    .map((m) => ({
      material_type_id: m.id,
      name: m.name,
      unit: m.unit,
      category: m.category,
      quantity_on_hand: balanceByMaterial.get(m.id) ?? 0,
      reorder_point: Number(m.reorder_point),
    }))
    .filter((m) => m.quantity_on_hand <= m.reorder_point)
    .sort((a, b) => a.quantity_on_hand - b.quantity_on_hand)
}

type ConsumptionSourceRow = {
  material_type_id: number
  quantity: number
  projects: { name: string } | null
  contractors: { name: string } | null
}

type ActiveMaterialSourceRow = {
  material_type_id: number
  quantity: number
  material_types: { name: string; unit: string } | null
}

export async function getConsumptionReport(): Promise<ConsumptionReport> {
  await requireModuleAccess('materials')
  const supabase = await createClient()

  const [{ data: outRows, error: outError }, { data: allRows, error: allError }] = await Promise.all([
    // 'out' only - what got consumed, and by whom/where.
    supabase
      .from('stock_movements')
      .select('material_type_id, quantity, projects (name), contractors (name)')
      .eq('type', 'out'),
    // 'in' + 'out' - a material that's only ever been received isn't
    // "inactive," it's just early. Excludes the opening-balance migration
    // itself so it doesn't dominate the ranking as fake "activity."
    supabase
      .from('stock_movements')
      .select('material_type_id, quantity, material_types (name, unit)')
      .neq('source_type', 'opening_balance'),
  ])

  if (outError) throw new Error(outError.message)
  if (allError) throw new Error(allError.message)

  const byProjectMap = new Map<string, ConsumptionRow>()
  const byContractorMap = new Map<string, ConsumptionRow>()

  for (const row of (outRows as unknown as ConsumptionSourceRow[]) || []) {
    const qty = Number(row.quantity)
    if (row.projects?.name) {
      const existing = byProjectMap.get(row.projects.name) || { name: row.projects.name, quantity: 0, movement_count: 0 }
      existing.quantity += qty
      existing.movement_count += 1
      byProjectMap.set(row.projects.name, existing)
    }
    if (row.contractors?.name) {
      const existing =
        byContractorMap.get(row.contractors.name) || { name: row.contractors.name, quantity: 0, movement_count: 0 }
      existing.quantity += qty
      existing.movement_count += 1
      byContractorMap.set(row.contractors.name, existing)
    }
  }

  const byMaterialMap = new Map<number, ActiveMaterialRow>()
  for (const row of (allRows as unknown as ActiveMaterialSourceRow[]) || []) {
    if (!row.material_types) continue
    const existing = byMaterialMap.get(row.material_type_id) || {
      material_type_id: row.material_type_id,
      name: row.material_types.name,
      unit: row.material_types.unit,
      movement_count: 0,
      total_quantity: 0,
    }
    existing.movement_count += 1
    existing.total_quantity += Number(row.quantity)
    byMaterialMap.set(row.material_type_id, existing)
  }

  return {
    byProject: Array.from(byProjectMap.values()).sort((a, b) => b.quantity - a.quantity),
    byContractor: Array.from(byContractorMap.values()).sort((a, b) => b.quantity - a.quantity),
    mostActiveMaterials: Array.from(byMaterialMap.values())
      .sort((a, b) => b.movement_count - a.movement_count)
      .slice(0, 10),
  }
}
