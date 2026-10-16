'use server'

import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import {
  buildHistoryEntries,
  type DocumentEventRow,
  type HistoryEntry,
  type HistoryLookups,
} from '@/lib/procurement/documentHistory'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

const EVENT_COLUMNS =
  'id, occurred_at, tx_id, actor_id, table_name, op, row_id, pr_id, po_id, gr_id, pv_id, action, reason, old_data, new_data'

export type HistoryTarget = { kind: 'pr' | 'po' | 'gr' | 'pv'; id: string }

const TARGET_COLUMN: Record<HistoryTarget['kind'], string> = {
  pr: 'pr_id',
  po: 'po_id',
  gr: 'gr_id',
  pv: 'pv_id',
}

/** Reads one column for a set of ids - from the live table first, then from
 * the history log for rows that have since been deleted (an undone receipt,
 * a removed PO line). */
async function resolveColumn(
  supabase: SupabaseServer,
  table: string,
  column: string,
  ids: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out

  const { data: live } = await supabase.from(table).select(`id, ${column}`).in('id', ids)
  for (const row of (live || []) as unknown as Record<string, unknown>[]) {
    if (row[column] != null) out.set(String(row.id), String(row[column]))
  }

  const missing = ids.filter((id) => !out.has(id))
  if (missing.length > 0) {
    const { data: logged } = await supabase
      .from('document_events')
      .select('row_id, old_data, new_data')
      .eq('table_name', table)
      .in('row_id', missing)
    for (const row of (logged || []) as { row_id: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null }[]) {
      const value = row.new_data?.[column] ?? row.old_data?.[column]
      if (value != null && !out.has(row.row_id)) out.set(row.row_id, String(value))
    }
  }
  return out
}

async function buildLookups(supabase: SupabaseServer, events: DocumentEventRow[]): Promise<HistoryLookups> {
  const actorIds = new Set<string>()
  const materialIds = new Set<number>()
  const poiIds = new Set<string>()
  const priIds = new Set<string>()
  const prIds = new Set<string>()
  const poIds = new Set<string>()
  const grIds = new Set<string>()
  const pvIds = new Set<string>()
  const plotIds = new Set<string>()

  for (const e of events) {
    if (e.actor_id) actorIds.add(e.actor_id)
    if (e.pr_id) prIds.add(e.pr_id)
    if (e.po_id) poIds.add(e.po_id)
    if (e.gr_id) grIds.add(e.gr_id)
    if (e.pv_id) pvIds.add(e.pv_id)
    for (const d of [e.old_data, e.new_data]) {
      if (!d) continue
      if (d.material_type_id != null) materialIds.add(Number(d.material_type_id))
      if (d.purchase_order_item_id) poiIds.add(String(d.purchase_order_item_id))
      if (d.purchase_request_item_id) priIds.add(String(d.purchase_request_item_id))
      if (d.goods_receipt_id) grIds.add(String(d.goods_receipt_id))
      if (d.plot_id) plotIds.add(String(d.plot_id))
    }
  }

  const [poiMaterialRaw, priMaterialRaw, prNo, poNo, riNo, ppNo] = await Promise.all([
    resolveColumn(supabase, 'purchase_order_items', 'material_type_id', [...poiIds]),
    resolveColumn(supabase, 'purchase_request_items', 'material_type_id', [...priIds]),
    resolveColumn(supabase, 'purchase_requests', 'pr_no', [...prIds]),
    resolveColumn(supabase, 'purchase_orders', 'po_no', [...poIds]),
    resolveColumn(supabase, 'goods_receipts', 'ri_no', [...grIds]),
    resolveColumn(supabase, 'payment_vouchers', 'pp_no', [...pvIds]),
  ])

  const poiMaterial = new Map<string, number>()
  for (const [k, v] of poiMaterialRaw) {
    poiMaterial.set(k, Number(v))
    materialIds.add(Number(v))
  }
  const priMaterial = new Map<string, number>()
  for (const [k, v] of priMaterialRaw) {
    priMaterial.set(k, Number(v))
    materialIds.add(Number(v))
  }

  const [actorsRes, materialsRes, plotsRes] = await Promise.all([
    actorIds.size > 0
      ? supabase.from('profiles').select('id, full_name, email').in('id', [...actorIds])
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
    materialIds.size > 0
      ? supabase.from('material_types').select('id, name, unit').in('id', [...materialIds])
      : Promise.resolve({ data: [] as { id: number; name: string; unit: string | null }[] }),
    plotIds.size > 0
      ? supabase.from('plots').select('id, name').in('id', [...plotIds])
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])

  return {
    actors: new Map(((actorsRes.data || []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [p.id, p.full_name || p.email || 'ผู้ใช้'])),
    materials: new Map(((materialsRes.data || []) as { id: number; name: string; unit: string | null }[]).map((m) => [Number(m.id), { name: m.name, unit: m.unit && m.unit !== 'unit' ? m.unit : '' }])),
    plots: new Map(((plotsRes.data || []) as { id: string; name: string }[]).map((p) => [p.id, p.name])),
    poiMaterial,
    priMaterial,
    prNo,
    poNo,
    riNo,
    ppNo,
  }
}

/** Every recorded change to one PR / PO / receipt / payment voucher, newest
 * first, one entry per user action. */
export async function getDocumentHistory(target: HistoryTarget): Promise<HistoryEntry[] | { error: string }> {
  try {
    await requireModuleAccess('procurement')
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('document_events')
      .select(EVENT_COLUMNS)
      .eq(TARGET_COLUMN[target.kind], target.id)
      .order('id', { ascending: true })
      .limit(1000)
    if (error) throw new Error(error.message)

    const events = (data || []) as DocumentEventRow[]
    const lookups = await buildLookups(supabase, events)
    return buildHistoryEntries(events, lookups)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'โหลดประวัติไม่สำเร็จ' }
  }
}

/** Cross-document audit list: the latest actions across all procurement
 * documents. With onlyDestructive, just undo / delete / void / cancel - the
 * place to find a PO that no longer exists. */
export async function getRecentDocumentHistory(opts: { onlyDestructive?: boolean } = {}): Promise<HistoryEntry[] | { error: string }> {
  try {
    await requireModuleAccess('procurement')
    const supabase = await createClient()

    // Pick the latest 100 actions first, then load every row of those actions.
    let txQuery = supabase.from('document_events').select('tx_id').order('id', { ascending: false }).limit(3000)
    if (opts.onlyDestructive) txQuery = txQuery.not('action', 'is', null)
    const { data: txRows, error: txError } = await txQuery
    if (txError) throw new Error(txError.message)

    const txIds: number[] = []
    for (const row of (txRows || []) as { tx_id: number }[]) {
      if (!txIds.includes(row.tx_id)) txIds.push(row.tx_id)
      if (txIds.length >= 100) break
    }
    if (txIds.length === 0) return []

    const { data, error } = await supabase
      .from('document_events')
      .select(EVENT_COLUMNS)
      .in('tx_id', txIds)
      .order('id', { ascending: true })
    if (error) throw new Error(error.message)

    const events = (data || []) as DocumentEventRow[]
    const lookups = await buildLookups(supabase, events)
    return buildHistoryEntries(events, lookups, { withDocLabel: true })
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'โหลดประวัติไม่สำเร็จ' }
  }
}
