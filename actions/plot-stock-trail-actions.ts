'use server'

import { createClient } from '@/lib/supabase/server'

/** One store withdrawal or straight-to-plot delivery that counts toward a plot. */
export type PlotStockEntry = {
  movementId: string
  materialTypeId: number
  materialName: string
  unit: string
  kind: 'issue' | 'direct'
  /** IS-... for a withdrawal, RI-... for a straight-to-plot delivery. */
  docNo: string | null
  /** PO behind a straight-to-plot delivery, for linking. */
  poId: string | null
  poNo: string | null
  date: string
  contractorName: string | null
  /** Plot group name when the movement was tagged to a batch, not this plot. */
  groupName: string | null
  totalQty: number
  /** This plot's share: totalQty for a plot-tagged row, an even split for a batch. */
  plotQty: number
  /** Cost per unit frozen on the movement when it was issued; null if unknown. */
  unitCost: number | null
  /** True when the frozen cost was filled in afterwards from an average, not at issue time. */
  costEstimated: boolean
  /** plotQty x unitCost - what this entry costs the plot. */
  plotValue: number
}

export type PlotBoqLine = {
  materialTypeId: number
  name: string
  unit: string
  plannedQty: number
  allowanceQty: number
}

export type PlotStockTrail = {
  boq: PlotBoqLine[]
  entries: PlotStockEntry[]
}

type MovementRow = {
  id: string
  material_type_id: number
  quantity: number | string
  created_at: string
  source_type: 'manual_request' | 'direct_to_site'
  source_id: string | null
  plot_id: string | null
  plot_group_id: string | null
  issue_no: string | null
  unit_cost: number | string | null
  unit_cost_estimated: boolean | null
  material_types: { name: string; unit: string } | null
  contractors: { name: string } | null
  plot_groups: { name: string } | null
}

/**
 * What the store handed out for one plot, plus its BOQ - the other half of
 * the plot's materials tab (getPlotMaterialsSummary covers POs). Attribution
 * follows boq_control_rollup exactly: a plot-tagged movement counts in full,
 * a batch-tagged one is split evenly across the batch's plots, and a
 * project-only one cannot be attributed and is left out. No prices, so it is
 * safe for every role that can open the plot page.
 */
export async function getPlotStockTrail(plotId: string, projectId: string): Promise<PlotStockTrail> {
  const supabase = await createClient()

  const { data: memberships } = await supabase.from('plot_group_members').select('group_id').eq('plot_id', plotId)
  const groupIds = Array.from(new Set(((memberships || []) as { group_id: string }[]).map((m) => m.group_id)))

  const groupSize = new Map<string, number>()
  if (groupIds.length > 0) {
    const { data: members } = await supabase.from('plot_group_members').select('group_id').in('group_id', groupIds)
    for (const m of (members || []) as { group_id: string }[]) groupSize.set(m.group_id, (groupSize.get(m.group_id) || 0) + 1)
  }

  const scopeFilter =
    groupIds.length > 0
      ? `plot_id.eq.${plotId},and(plot_id.is.null,plot_group_id.in.(${groupIds.join(',')}))`
      : `plot_id.eq.${plotId}`

  const [movementsRes, rollupRes] = await Promise.all([
    supabase
      .from('stock_movements')
      .select('id, material_type_id, quantity, created_at, source_type, source_id, plot_id, plot_group_id, issue_no, unit_cost, unit_cost_estimated, material_types (name, unit), contractors (name), plot_groups (name)')
      .eq('type', 'out')
      .in('source_type', ['manual_request', 'direct_to_site'])
      .or(scopeFilter)
      .order('created_at', { ascending: false }),
    supabase.rpc('boq_control_rollup', { p_project_id: projectId, p_scope: { plot_ids: [plotId] } }),
  ])
  if (movementsRes.error) throw new Error(movementsRes.error.message)

  const movements = (movementsRes.data || []) as unknown as MovementRow[]

  // Straight-to-plot rows point at the receipt line - fetch its RI and PO.
  const receiptItemIds = movements.filter((m) => m.source_type === 'direct_to_site' && m.source_id).map((m) => m.source_id as string)
  const receiptDoc = new Map<string, { riNo: string | null; poId: string | null; poNo: string | null }>()
  if (receiptItemIds.length > 0) {
    const { data } = await supabase
      .from('goods_receipt_items')
      .select('id, goods_receipts (ri_no, purchase_order_id, purchase_orders (po_no))')
      .in('id', receiptItemIds)
    for (const row of (data || []) as unknown as {
      id: string
      goods_receipts: { ri_no: string | null; purchase_order_id: string | null; purchase_orders: { po_no: string | null } | null } | null
    }[]) {
      receiptDoc.set(row.id, {
        riNo: row.goods_receipts?.ri_no ?? null,
        poId: row.goods_receipts?.purchase_order_id ?? null,
        poNo: row.goods_receipts?.purchase_orders?.po_no ?? null,
      })
    }
  }

  const entries: PlotStockEntry[] = movements.map((m) => {
    const total = Number(m.quantity) || 0
    const share = m.plot_id ? 1 : 1 / Math.max(groupSize.get(m.plot_group_id || '') || 1, 1)
    const doc = m.source_type === 'direct_to_site' && m.source_id ? receiptDoc.get(m.source_id) : undefined
    return {
      movementId: m.id,
      materialTypeId: m.material_type_id,
      materialName: m.material_types?.name ?? `วัสดุ #${m.material_type_id}`,
      unit: m.material_types?.unit ?? '',
      kind: m.source_type === 'direct_to_site' ? 'direct' : 'issue',
      docNo: m.source_type === 'direct_to_site' ? doc?.riNo ?? null : m.issue_no,
      poId: doc?.poId ?? null,
      poNo: doc?.poNo ?? null,
      date: m.created_at,
      contractorName: m.contractors?.name ?? null,
      groupName: m.plot_id ? null : m.plot_groups?.name ?? null,
      totalQty: total,
      plotQty: total * share,
      unitCost: m.unit_cost == null ? null : Number(m.unit_cost),
      costEstimated: Boolean(m.unit_cost_estimated),
      plotValue: total * share * (m.unit_cost == null ? 0 : Number(m.unit_cost)),
    }
  })

  const boq: PlotBoqLine[] = ((rollupRes.data || []) as {
    material_type_id: number
    material_name: string
    unit: string
    planned_qty: number | string
    allowance_qty: number | string
  }[])
    .filter((r) => Number(r.planned_qty) > 0)
    .map((r) => ({
      materialTypeId: r.material_type_id,
      name: r.material_name,
      unit: r.unit,
      plannedQty: Number(r.planned_qty),
      allowanceQty: Number(r.allowance_qty),
    }))

  return { boq, entries }
}
