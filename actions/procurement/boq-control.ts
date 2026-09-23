'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import {
  ceilingQty,
  isBoqCheckLineOver,
  totalUsedQty,
  type BoqCheckLine,
  type BoqCheckOverride,
  type BoqControlDetailRow,
  type BoqControlOutsideBoqRow,
  type BoqControlRow,
  type BoqControlUnassignedRow,
  type ControlScope,
} from '@/lib/procurement/boqControl'
import { originalQuantityRequested } from '@/lib/procurement/requestQuantities'
import type { PurchaseRequestItem } from '@/lib/types/procurement'

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function toNumber(value: number | string | null | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function scopeToJsonb(scope: ControlScope) {
  return {
    plot_group_id: scope.plotIds && scope.plotIds.length > 0 ? null : scope.plotGroupId || null,
    plot_ids: scope.plotIds && scope.plotIds.length > 0 ? scope.plotIds : [],
  }
}

type RollupRpcRow = {
  material_type_id: number
  material_name: string
  unit: string
  planned_qty: number | string
  allowance_qty: number | string
  ordered_qty: number | string
  received_qty: number | string
  issued_qty: number | string
  ordered_value: number | string
  received_value: number | string
  is_estimated: boolean
}

/** Shared by getBoqControl (cost-control page) and every BOQ check panel
 * (PO/PR/receipts) - never call boq_control_rollup twice with hand-copied
 * mapping logic. Not itself auth-gated: every caller in this file gates on
 * whichever module actually fits its own page before reaching here. */
async function fetchRollupRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scope: ControlScope
): Promise<BoqControlRow[]> {
  const { data, error } = await supabase.rpc('boq_control_rollup', {
    p_project_id: scope.projectId,
    p_scope: scopeToJsonb(scope),
  })
  if (error) throw new Error(error.message)

  return ((data as RollupRpcRow[]) || []).map((r) => ({
    materialTypeId: r.material_type_id,
    materialName: r.material_name,
    unit: r.unit,
    plannedQty: toNumber(r.planned_qty),
    allowanceQty: toNumber(r.allowance_qty),
    orderedQty: toNumber(r.ordered_qty),
    receivedQty: toNumber(r.received_qty),
    issuedQty: toNumber(r.issued_qty),
    orderedValue: toNumber(r.ordered_value),
    receivedValue: toNumber(r.received_value),
    isEstimated: Boolean(r.is_estimated),
  }))
}

/**
 * The quantity-control rollup for one scope: planned vs ordered/received/
 * issued per material (BOQ_CONTROL_PLAN.md 5), plus the two sections that
 * never fold into a house's number - unassigned spend and outside-BOQ POs -
 * so that money stays visible instead of silently dropped.
 */
export async function getBoqControl(scope: ControlScope): Promise<{
  rows: BoqControlRow[]
  unassigned: BoqControlUnassignedRow[]
  outsideBoq: BoqControlOutsideBoqRow[]
}> {
  await requireModuleAccess('cost_control')
  const supabase = await createClient()

  const [rows, unassignedRes, outsideBoqRes] = await Promise.all([
    fetchRollupRows(supabase, scope),
    supabase.rpc('boq_control_unassigned', { p_project_id: scope.projectId }),
    supabase
      .from('purchase_orders')
      .select('id, po_no, outside_boq_reason, total_amount')
      .eq('project_id', scope.projectId)
      .eq('is_outside_boq', true)
      .neq('status', 'cancelled')
      .order('order_date', { ascending: false }),
  ])

  if (unassignedRes.error) throw new Error(unassignedRes.error.message)
  if (outsideBoqRes.error) throw new Error(outsideBoqRes.error.message)

  const unassigned: BoqControlUnassignedRow[] = (
    (unassignedRes.data as {
      material_type_id: number
      material_name: string
      unit: string
      ordered_qty: number | string
      ordered_value: number | string
      po_count: number
    }[]) || []
  ).map((r) => ({
    materialTypeId: r.material_type_id,
    materialName: r.material_name,
    unit: r.unit,
    orderedQty: toNumber(r.ordered_qty),
    orderedValue: toNumber(r.ordered_value),
    poCount: r.po_count,
  }))

  const outsideBoq: BoqControlOutsideBoqRow[] = (outsideBoqRes.data || []).map((po) => ({
    poId: po.id,
    poNo: po.po_no,
    reason: po.outside_boq_reason,
    total: toNumber(po.total_amount),
  }))

  return { rows, unassigned, outsideBoq }
}

/** The documents behind one row of the rollup, for the row-expansion panel. */
export async function getBoqControlMaterialDetail(scope: ControlScope, materialTypeId: number): Promise<BoqControlDetailRow[]> {
  await requireModuleAccess('cost_control')
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('boq_control_material_detail', {
    p_project_id: scope.projectId,
    p_material_type_id: materialTypeId,
    p_scope: scopeToJsonb(scope),
  })
  if (error) throw new Error(error.message)

  return (
    (data as {
      doc_kind: string
      doc_id: string
      doc_no: string | null
      doc_date: string | null
      supplier_name: string | null
      plot_label: string
      quantity: number | string
      weight: number | string
      status: string
    }[]) || []
  ).map((r) => ({
    docKind: r.doc_kind as BoqControlDetailRow['docKind'],
    docId: r.doc_id,
    docNo: r.doc_no,
    docDate: r.doc_date,
    supplierName: r.supplier_name,
    plotLabel: r.plot_label,
    quantity: toNumber(r.quantity),
    weight: toNumber(r.weight),
    status: r.status,
  }))
}

/** Scope picker options for the page: every real development (excluding
 * overhead buckets and the central stock pseudo-project, none of which have
 * BOQ/house models to compare against), plus every plot group and plot so
 * the client can filter without a round trip per project change. */
export async function getCostControlOptions(): Promise<{
  projects: { id: string; name: string }[]
  plotGroups: { id: string; name: string; project_id: string }[]
  plots: { id: string; name: string; project_id: string }[]
}> {
  await requireModuleAccess('cost_control')
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

// ---------------------------------------------------------------------------
// The owner's check at signing time (BOQ_CONTROL_PLAN.md 9). Gated on
// `procurement`, not `cost_control` - this must work for anyone who can
// manage POs/receipts, independent of whether they also have the dedicated
// cost-control page.
// ---------------------------------------------------------------------------

type PoForCheck = {
  id: string
  project_id: string
  plot_id: string | null
  plot_group_id: string | null
  is_outside_boq: boolean
  plots: { name: string } | { name: string }[] | null
  plot_groups: { name: string } | { name: string }[] | null
  purchase_order_plots: { plot_id: string; plots: { name: string } | { name: string }[] | null }[] | null
}

type PoItemForCheck = {
  material_type_id: number
  quantity_ordered: number
  material_types: { name: string; unit: string } | { name: string; unit: string }[] | null
  project_id: string | null
  plot_id: string | null
  plot_group_id: string | null
  projects: { name: string } | { name: string }[] | null
  plots: { name: string } | { name: string }[] | null
  plot_groups: { name: string } | { name: string }[] | null
}

/** Derives a PO's (or PR's - same 3-shape scope) own plot scope and a
 * human label for it. Null scope means the document carries no plot tag at
 * all - nothing to check it against. */
function resolveDocumentScope(
  doc: PoForCheck
): { scope: ControlScope; scopeLabel: string } | null {
  const plot = asSingle(doc.plots)
  const group = asSingle(doc.plot_groups)
  const adHoc = doc.purchase_order_plots || []

  if (doc.plot_id) {
    return { scope: { projectId: doc.project_id, plotIds: [doc.plot_id] }, scopeLabel: `แปลง ${plot?.name || ''}` }
  }
  if (doc.plot_group_id) {
    return { scope: { projectId: doc.project_id, plotGroupId: doc.plot_group_id }, scopeLabel: `กลุ่มแปลง ${group?.name || ''}` }
  }
  if (adHoc.length > 0) {
    const names = adHoc.map((p) => asSingle(p.plots)?.name).filter(Boolean)
    return {
      scope: { projectId: doc.project_id, plotIds: adHoc.map((p) => p.plot_id) },
      scopeLabel: `แปลง ${names.join(', ')}`,
    }
  }
  return null
}

/**
 * The BOQ check for one purchase order: derives the scope from the PO's own
 * plot tag, restricts materials to those on the PO, and computes alreadyQty
 * as the scope total excluding this PO.
 *
 * This works because a document's own derived scope always gives it weight
 * 1 against itself (its plot tag IS the scope), so the rollup's current
 * ordered_qty for that scope already equals "everything after this PO" -
 * alreadyQty is just that total minus this PO's own quantity.
 */
export async function getBoqCheckForPurchaseOrder(poId: string): Promise<{
  lines: BoqCheckLine[]
  scopeLabel: string
  isOutsideBoq: boolean
  existingOverrides: BoqCheckOverride[]
}> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()

  const { data: po, error } = await supabase
    .from('purchase_orders')
    .select(
      `id, project_id, plot_id, plot_group_id, is_outside_boq,
       plots!purchase_orders_plot_id_fkey (name),
       plot_groups (name),
       purchase_order_plots (plot_id, plots (name)),
       purchase_order_items (
         material_type_id, quantity_ordered, material_types (name, unit),
         project_id, plot_id, plot_group_id, projects (name), plots (name), plot_groups (name)
       )`
    )
    .eq('id', poId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!po) throw new Error('ไม่พบใบสั่งซื้อนี้')

  if (po.is_outside_boq) {
    return { lines: [], scopeLabel: '', isOutsideBoq: true, existingOverrides: [] }
  }

  const resolved = resolveDocumentScope(po as PoForCheck)
  if (!resolved) {
    return { lines: [], scopeLabel: 'ไม่ระบุแปลง', isOutsideBoq: false, existingOverrides: [] }
  }

  // A line overridden to its own project/plot ([[202609220002]]) needs to be
  // checked against ITS OWN scope, not the PO's - so items are grouped by
  // effective scope first, and each distinct scope gets its own rollup call.
  // The single-scope case (the vast majority of POs) collapses back to
  // exactly today's behavior: one group, one rollup call, no scope labels.
  type ThisDoc = { qty: number; name: string; unit: string }
  type Group = { scope: ControlScope; scopeLabel: string; byMaterial: Map<number, ThisDoc> }
  const groups = new Map<string, Group>()

  for (const item of (po.purchase_order_items as unknown as PoItemForCheck[]) || []) {
    const materialType = asSingle(item.material_types)
    let itemScope: ControlScope
    let itemScopeLabel: string
    if (item.project_id) {
      if (item.plot_id) {
        itemScope = { projectId: item.project_id, plotIds: [item.plot_id] }
        itemScopeLabel = `แปลง ${asSingle(item.plots)?.name || ''}`
      } else if (item.plot_group_id) {
        itemScope = { projectId: item.project_id, plotGroupId: item.plot_group_id }
        itemScopeLabel = `กลุ่มแปลง ${asSingle(item.plot_groups)?.name || ''}`
      } else {
        // No plot at all under the overridden project (e.g. central stock) -
        // nothing to weight against, so this line simply never shows up in
        // any BOQ check. See 202609220002_po_item_project_plot_override.sql.
        itemScope = { projectId: item.project_id }
        itemScopeLabel = asSingle(item.projects)?.name || 'ไม่ระบุแปลง'
      }
    } else {
      itemScope = resolved.scope
      itemScopeLabel = resolved.scopeLabel
    }

    const key = JSON.stringify({
      projectId: itemScope.projectId,
      plotGroupId: itemScope.plotGroupId || null,
      plotIds: itemScope.plotIds && itemScope.plotIds.length > 0 ? [...itemScope.plotIds].sort() : [],
    })
    let group = groups.get(key)
    if (!group) {
      group = { scope: itemScope, scopeLabel: itemScopeLabel, byMaterial: new Map() }
      groups.set(key, group)
    }
    const existing = group.byMaterial.get(item.material_type_id) || {
      qty: 0,
      name: materialType?.name || '-',
      unit: materialType?.unit || '',
    }
    existing.qty += Number(item.quantity_ordered) || 0
    group.byMaterial.set(item.material_type_id, existing)
  }
  if (groups.size === 0) {
    return { lines: [], scopeLabel: resolved.scopeLabel, isOutsideBoq: false, existingOverrides: [] }
  }

  const showScopeLabels = groups.size > 1
  const groupEntries = Array.from(groups.values())

  const [rollupsPerGroup, overridesRes] = await Promise.all([
    Promise.all(groupEntries.map((g) => fetchRollupRows(supabase, g.scope))),
    supabase
      .from('po_boq_overrides')
      .select('material_type_id, reason, approved_at, approved_by, profiles:approved_by (full_name)')
      .eq('purchase_order_id', poId),
  ])
  if (overridesRes.error) throw new Error(overridesRes.error.message)

  const lines: BoqCheckLine[] = []
  groupEntries.forEach((group, gi) => {
    const rollupByMaterial = new Map(rollupsPerGroup[gi].map((r) => [r.materialTypeId, r]))
    for (const [materialTypeId, doc] of group.byMaterial.entries()) {
      const rollup = rollupByMaterial.get(materialTypeId)
      const plannedQty = rollup ? ceilingQty(rollup) : 0
      const totalAfter = rollup ? totalUsedQty(rollup) : doc.qty
      lines.push({
        materialTypeId,
        materialName: doc.name,
        unit: doc.unit,
        plannedQty,
        alreadyQty: totalAfter - doc.qty,
        thisDocQty: doc.qty,
        totalAfter,
        scopeLabel: showScopeLabels ? group.scopeLabel : undefined,
      })
    }
  })

  const existingOverrides: BoqCheckOverride[] = (overridesRes.data || []).map((o) => ({
    materialTypeId: o.material_type_id,
    reason: o.reason,
    approvedBy: asSingle(o.profiles as { full_name: string | null } | { full_name: string | null }[] | null)?.full_name || '-',
    approvedAt: o.approved_at,
  }))

  return { lines, scopeLabel: resolved.scopeLabel, isOutsideBoq: false, existingOverrides }
}

/**
 * The BOQ check for a payment voucher about to be created from one or more
 * goods receipts. Receipts may span several POs, so this groups by PO and
 * returns one line set per PO. thisDocQty is the RECEIVED quantity on the
 * selected receipts (what the cheque actually pays for), not the ordered
 * quantity - alreadyQty/totalAfter are read the same way as the PO check,
 * but from the rollup's received_qty rather than ordered_qty, since a
 * receipt's quantity_received is already reflected there by the time a
 * payment voucher is being created from it.
 */
export async function getBoqCheckForReceipts(receiptIds: string[]): Promise<{
  perPo: { poId: string; poNo: string; scopeLabel: string; lines: BoqCheckLine[] }[]
  overCount: number
}> {
  await requireModuleAccess('procurement')
  if (receiptIds.length === 0) return { perPo: [], overCount: 0 }
  const supabase = await createClient()

  const { data: receipts, error } = await supabase
    .from('goods_receipt_items')
    .select(
      `quantity_received, unit_price_at_receipt,
       goods_receipts!inner (id, purchase_order_id),
       purchase_order_items (material_type_id, material_types (name, unit))`
    )
    .in('goods_receipt_id', receiptIds)
  if (error) throw new Error(error.message)

  type ReceiptItemRow = {
    quantity_received: number
    unit_price_at_receipt: number
    goods_receipts: { id: string; purchase_order_id: string } | { id: string; purchase_order_id: string }[]
    purchase_order_items: { material_type_id: number; material_types: { name: string; unit: string } | { name: string; unit: string }[] | null } | null
  }

  const byPo = new Map<string, Map<number, { qty: number; value: number; name: string; unit: string }>>()
  for (const row of (receipts || []) as unknown as ReceiptItemRow[]) {
    const receipt = asSingle(row.goods_receipts)
    const poi = row.purchase_order_items
    if (!receipt || !poi) continue
    const materialType = asSingle(poi.material_types)
    const poId = receipt.purchase_order_id
    const materials = byPo.get(poId) || new Map<number, { qty: number; value: number; name: string; unit: string }>()
    const existing = materials.get(poi.material_type_id) || {
      qty: 0,
      value: 0,
      name: materialType?.name || '-',
      unit: materialType?.unit || '',
    }
    const receivedQty = Number(row.quantity_received) || 0
    existing.qty += receivedQty
    existing.value += receivedQty * (Number(row.unit_price_at_receipt) || 0)
    materials.set(poi.material_type_id, existing)
    byPo.set(poId, materials)
  }

  if (byPo.size === 0) return { perPo: [], overCount: 0 }

  const poIds = Array.from(byPo.keys())
  const { data: pos, error: poError } = await supabase
    .from('purchase_orders')
    .select(
      `id, po_no, project_id, plot_id, plot_group_id, is_outside_boq,
       plots!purchase_orders_plot_id_fkey (name),
       plot_groups (name),
       purchase_order_plots (plot_id, plots (name))`
    )
    .in('id', poIds)
  if (poError) throw new Error(poError.message)

  const perPo: { poId: string; poNo: string; scopeLabel: string; lines: BoqCheckLine[] }[] = []

  for (const po of pos || []) {
    if (po.is_outside_boq) continue
    const resolved = resolveDocumentScope(po as PoForCheck)
    const materials = byPo.get(po.id)
    if (!resolved || !materials || materials.size === 0) continue

    const rollupRows = await fetchRollupRows(supabase, resolved.scope)
    const rollupByMaterial = new Map(rollupRows.map((r) => [r.materialTypeId, r]))

    const lines: BoqCheckLine[] = Array.from(materials.entries()).map(([materialTypeId, doc]) => {
      const rollup = rollupByMaterial.get(materialTypeId)
      const plannedQty = rollup ? ceilingQty(rollup) : 0
      // The received-side running total: rollup.receivedQty already
      // reflects these selected receipts (they're recorded the moment
      // goods_receipt_create runs, well before a payment voucher exists).
      const totalAfter = rollup ? rollup.receivedQty : doc.qty
      return {
        materialTypeId,
        materialName: doc.name,
        unit: doc.unit,
        plannedQty,
        alreadyQty: totalAfter - doc.qty,
        thisDocQty: doc.qty,
        totalAfter,
        thisDocValue: doc.value,
      }
    })

    perPo.push({ poId: po.id, poNo: po.po_no, scopeLabel: resolved.scopeLabel, lines })
  }

  const overCount = perPo.reduce((sum, p) => sum + p.lines.filter(isBoqCheckLineOver).length, 0)
  return { perPo, overCount }
}

/**
 * Read-only BOQ check for a purchase request, using its own plot scope and
 * the original ask (originalQuantityRequested, not the outstanding
 * quantity_requested column - see requestQuantities.ts) as thisDocQty.
 * Catching an over-BOQ ask here is far cheaper than catching it at the
 * cheque. No override/acknowledge flow at this stage - only POs and
 * payments record an approval (plan section 9.4).
 */
export async function getBoqCheckForPurchaseRequest(prId: string): Promise<{ lines: BoqCheckLine[]; scopeLabel: string }> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()

  const { data: pr, error } = await supabase
    .from('purchase_requests')
    .select(
      // plots is reachable two ways from a request (its own plot_id, and
      // through purchase_request_plots), so the embed has to name which -
      // without the hint PostgREST refuses the whole query, which this
      // function's caller then swallows, silently hiding the BOQ panel.
      `id, project_id, plot_id, plot_group_id,
       plots!purchase_requests_plot_id_fkey (name),
       plot_groups (name),
       purchase_request_plots (plot_id, plots (name)),
       purchase_request_items (
         material_type_id, quantity_requested, unit, material_types (name, unit),
         purchase_request_item_settlements (quantity),
         purchase_order_items (quantity_ordered, unit, closes_request_line)
       )`
    )
    .eq('id', prId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!pr) throw new Error('ไม่พบคำขอซื้อนี้')

  const resolved = resolveDocumentScope({
    id: pr.id,
    project_id: pr.project_id,
    plot_id: pr.plot_id,
    plot_group_id: pr.plot_group_id,
    is_outside_boq: false,
    plots: pr.plots,
    plot_groups: pr.plot_groups,
    purchase_order_plots: pr.purchase_request_plots,
  })
  if (!resolved) return { lines: [], scopeLabel: 'ไม่ระบุแปลง' }

  const items = (pr.purchase_request_items || []) as unknown as PurchaseRequestItem[]
  if (items.length === 0) return { lines: [], scopeLabel: resolved.scopeLabel }

  const rollupRows = await fetchRollupRows(supabase, resolved.scope)
  const rollupByMaterial = new Map(rollupRows.map((r) => [r.materialTypeId, r]))

  const byMaterial = new Map<number, { qty: number; name: string; unit: string }>()
  for (const item of items) {
    const ask = originalQuantityRequested(item)
    if (ask <= 0) continue
    const existing = byMaterial.get(item.material_type_id) || {
      qty: 0,
      name: item.material_types?.name || '-',
      unit: item.material_types?.unit || '',
    }
    existing.qty += ask
    byMaterial.set(item.material_type_id, existing)
  }

  const lines: BoqCheckLine[] = Array.from(byMaterial.entries()).map(([materialTypeId, doc]) => {
    const rollup = rollupByMaterial.get(materialTypeId)
    const plannedQty = rollup ? ceilingQty(rollup) : 0
    // The PR's ask hasn't necessarily hit a PO yet, so - unlike the PO/
    // receipt checks - "already" is simply the scope's current total, and
    // "after" adds this ask on top of it (there's nothing to subtract back
    // out, since this request's own ask was never counted by the rollup).
    const alreadyQty = rollup ? totalUsedQty(rollup) : 0
    return {
      materialTypeId,
      materialName: doc.name,
      unit: doc.unit,
      plannedQty,
      alreadyQty,
      thisDocQty: doc.qty,
      totalAfter: alreadyQty + doc.qty,
    }
  })

  return { lines, scopeLabel: resolved.scopeLabel }
}

/**
 * Live "would this push a material over its BOQ ceiling" check for a PO
 * still being drafted in the form - no purchase_orders row has to exist yet
 * (BOQ_CONTROL_PLAN.md 10: "warn at PO save time... so the buyer sees it
 * before the owner does"). `excludeQuantitiesByMaterial` lets the edit form
 * subtract this same PO's own currently-saved quantities before adding the
 * draft's live ones back on top, so editing an existing PO doesn't double-
 * count the portion that hasn't changed.
 */
export async function getBoqCheckForDraft(
  scope: ControlScope,
  items: {
    materialTypeId: number
    quantity: number
    /** This line's own scope override, when it has one (see
     * 202609220002_po_item_project_plot_override.sql) - falls back to the
     * main `scope` param when omitted, exactly like every call site did
     * before this existed. */
    scope?: ControlScope
    /** Human label for `scope`, shown as a chip only when the draft's lines
     * span more than one distinct scope. Ignored when `scope` is omitted. */
    scopeLabel?: string
  }[],
  /** Only ever applied within the MAIN scope group (items with no `scope`
   * of their own) - a known, accepted gap for the rare case where editing a
   * PO both keeps an overridden line and reuses the same material under the
   * main scope; the live check is a best-effort early warning, never a
   * blocker, so a minor double-count there is an acceptable trade for not
   * needing a scope-keyed exclusion map. */
  excludeQuantitiesByMaterial?: Record<number, number>,
  /** 'ordered' (default) reads the rollup's ordered+issued total - the
   * right basis while drafting a PO. 'received' reads receivedQty alone -
   * the right basis while drafting a goods receipt (see
   * getBoqCheckForGoodsReceiptDraft below), since what's being checked
   * there is "will this shipment push received quantity over budget",
   * not ordered quantity (already checked when the PO itself was saved).
   * 'issued' reads issuedQty alone - the right basis while drafting a
   * central-stock withdrawal (WithdrawDrawer.tsx), which adds directly to
   * issuedQty and has nothing to do with ordered/received at all. */
  basis: 'ordered' | 'received' | 'issued' = 'ordered'
): Promise<{ lines: BoqCheckLine[] }> {
  // Reachable from both the procurement pages (drafting a PO/receipt) and
  // the stock module (drafting a withdrawal, which gates on 'materials'
  // rather than 'procurement') - either is enough to call this.
  await requireModuleAccess(['procurement', 'materials'])
  if (!scope.projectId) return { lines: [] }
  const supabase = await createClient()

  type Group = { scope: ControlScope; scopeLabel?: string; isMainScope: boolean; byMaterial: Map<number, number> }
  const groups = new Map<string, Group>()
  for (const item of items) {
    if (!item.materialTypeId || !(item.quantity > 0)) continue
    const itemScope = item.scope ?? scope
    const key = JSON.stringify({
      projectId: itemScope.projectId,
      plotGroupId: itemScope.plotGroupId || null,
      plotIds: itemScope.plotIds && itemScope.plotIds.length > 0 ? [...itemScope.plotIds].sort() : [],
    })
    let group = groups.get(key)
    if (!group) {
      group = { scope: itemScope, scopeLabel: item.scope ? item.scopeLabel : undefined, isMainScope: !item.scope, byMaterial: new Map() }
      groups.set(key, group)
    } else if (!item.scope) {
      group.isMainScope = true
    }
    group.byMaterial.set(item.materialTypeId, (group.byMaterial.get(item.materialTypeId) || 0) + item.quantity)
  }
  if (groups.size === 0) return { lines: [] }

  const showScopeLabels = groups.size > 1
  const groupEntries = Array.from(groups.values())
  const allMaterialIds = Array.from(new Set(groupEntries.flatMap((g) => Array.from(g.byMaterial.keys()))))

  const [rollupsPerGroup, materialsRes] = await Promise.all([
    Promise.all(groupEntries.map((g) => fetchRollupRows(supabase, g.scope))),
    supabase.from('material_types').select('id, name, unit').in('id', allMaterialIds),
  ])
  if (materialsRes.error) throw new Error(materialsRes.error.message)
  const nameById = new Map((materialsRes.data || []).map((m) => [m.id, m]))

  const lines: BoqCheckLine[] = []
  groupEntries.forEach((group, gi) => {
    const rollupByMaterial = new Map(rollupsPerGroup[gi].map((r) => [r.materialTypeId, r]))
    for (const [materialTypeId, thisDocQty] of group.byMaterial.entries()) {
      const rollup = rollupByMaterial.get(materialTypeId)
      const plannedQty = rollup ? ceilingQty(rollup) : 0
      const excluded = group.isMainScope ? excludeQuantitiesByMaterial?.[materialTypeId] || 0 : 0
      const currentTotal = rollup ? (basis === 'received' ? rollup.receivedQty : basis === 'issued' ? rollup.issuedQty : totalUsedQty(rollup)) : 0
      const alreadyQty = currentTotal - excluded
      lines.push({
        materialTypeId,
        materialName: nameById.get(materialTypeId)?.name || '-',
        unit: nameById.get(materialTypeId)?.unit || '',
        plannedQty,
        alreadyQty,
        thisDocQty,
        totalAfter: alreadyQty + thisDocQty,
        scopeLabel: showScopeLabels ? group.scopeLabel : undefined,
      })
    }
  })

  return { lines }
}

/**
 * Live "would receiving this push received quantity over its BOQ ceiling"
 * check for the "สร้างใบรับสินค้า" modal - another moment quantity moves,
 * same as creating the PO itself. The receipt doesn't exist yet, so unlike
 * the payment-voucher check (which reads already-recorded receipts) there
 * is nothing to exclude: alreadyQty is simply the scope's current received
 * total, and totalAfter adds this draft's quantities on top.
 */
export async function getBoqCheckForGoodsReceiptDraft(
  poId: string,
  items: { materialTypeId: number; quantity: number }[]
): Promise<{ lines: BoqCheckLine[]; scopeLabel: string; isOutsideBoq: boolean }> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()

  const { data: po, error } = await supabase
    .from('purchase_orders')
    .select(
      `id, project_id, plot_id, plot_group_id, is_outside_boq,
       plots!purchase_orders_plot_id_fkey (name),
       plot_groups (name),
       purchase_order_plots (plot_id, plots (name))`
    )
    .eq('id', poId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!po) throw new Error('ไม่พบใบสั่งซื้อนี้')

  if (po.is_outside_boq) return { lines: [], scopeLabel: '', isOutsideBoq: true }

  const resolved = resolveDocumentScope(po as PoForCheck)
  if (!resolved) return { lines: [], scopeLabel: 'ไม่ระบุแปลง', isOutsideBoq: false }

  const { lines } = await getBoqCheckForDraft(resolved.scope, items, undefined, 'received')
  return { lines, scopeLabel: resolved.scopeLabel, isOutsideBoq: false }
}

/** Records the owner's sign-off on one or more over-BOQ lines for a PO -
 * one po_boq_override_set call per material, per plan section 9.1/9.2. */
export async function setPoBoqOverrides(
  poId: string,
  overrides: { materialTypeId: number; reason: string; plannedQuantity: number; totalAfterThisPo: number }[]
): Promise<void> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()

  for (const o of overrides) {
    const { error } = await supabase.rpc('po_boq_override_set', {
      p_payload: {
        purchase_order_id: poId,
        material_type_id: o.materialTypeId,
        planned_quantity: o.plannedQuantity,
        total_after_this_po: o.totalAfterThisPo,
        reason: o.reason,
      },
    })
    if (error) throw new Error(error.message)
  }

  revalidatePath(`/dashboard/procurement/orders/${poId}`)
}
