'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requireAuthRole } from '@/actions/_shared/user-role'
import { translateError as translatePrError } from '@/lib/errors'
import { isAnsweredByOrder, requestLineUnit } from '@/lib/procurement/requestQuantities'
import type { PurchaseOrderStatus, PurchaseRequest, PurchaseRequestStatus, SettlementReason } from '@/lib/types/procurement'

const SELECT_WITH_RELATIONS = `
  *,
  projects (name),
  plots!purchase_requests_plot_id_fkey (name),
  plot_groups (name),
  purchase_request_plots (plot_id, plots (name)),
  requester:profiles!purchase_requests_requested_by_fkey (full_name, email),
  reviewer:profiles!purchase_requests_reviewed_by_fkey (full_name, email),
  purchase_request_items (
    *,
    material_types (*),
    boq_master (item_name),
    purchase_request_item_settlements (
      *,
      settler:profiles!purchase_request_item_settlements_settled_by_fkey (full_name, email)
    ),
    purchase_order_item_allocations (
      quantity_allocated,
      purchase_order_items (unit, closes_request_line, purchase_orders (id, po_no, status))
    )
  ),
  purchase_orders (po_no, status)
`

type RawAllocation = {
  quantity_allocated: number
  purchase_order_items:
    | { unit: string | null; closes_request_line: boolean; purchase_orders: { id: string; po_no: string; status: PurchaseOrderStatus } | null }
    | null
}

/** Rebuilds each request line's `purchase_order_items` (the shape every
 * quantity helper in lib/procurement/requestQuantities.ts reads) from the
 * line's allocations: one entry per PO line that draws on it, carrying the
 * ALLOCATED quantity rather than the PO line's own total - a consolidated PO
 * line may serve several requests, and only this request's slice belongs
 * here. Cancelled orders are left out: their quantity went back to the line
 * when they were cancelled, so counting them again would overstate the
 * original ask. */
function mapRequestAllocations(request: PurchaseRequest): PurchaseRequest {
  return {
    ...request,
    purchase_request_items: (request.purchase_request_items || []).map((item) => {
      const raw = ((item as unknown as { purchase_order_item_allocations?: RawAllocation[] }).purchase_order_item_allocations ||
        []) as RawAllocation[]
      return {
        ...item,
        purchase_order_items: raw
          .filter((a) => a.purchase_order_items && a.purchase_order_items.purchase_orders?.status !== 'cancelled')
          .map((a) => ({
            quantity_ordered: Number(a.quantity_allocated),
            unit: a.purchase_order_items!.unit,
            closes_request_line: a.purchase_order_items!.closes_request_line,
            purchase_orders: a.purchase_order_items!.purchase_orders,
          })),
      }
    }),
  }
}

export type PurchaseRequestFilters = {
  projectId?: string
  status?: PurchaseRequestStatus
}

export async function getPurchaseRequests(filters: PurchaseRequestFilters = {}): Promise<PurchaseRequest[]> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()

  let query = supabase.from('purchase_requests').select(SELECT_WITH_RELATIONS).order('created_at', { ascending: false })
  if (filters.projectId) query = query.eq('project_id', filters.projectId)
  if (filters.status) query = query.eq('status', filters.status)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return ((data as unknown as PurchaseRequest[]) || []).map(mapRequestAllocations)
}

export async function getPurchaseRequestById(id: string): Promise<PurchaseRequest | null> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  const { data, error } = await supabase.from('purchase_requests').select(SELECT_WITH_RELATIONS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapRequestAllocations(data as unknown as PurchaseRequest) : null
}

/** For printing several requests as one combined PDF - one round trip for
 * the whole batch rather than one per request. Ordered by pr_no so the
 * combined document reads the same regardless of selection order. */
export async function getPurchaseRequestsByIds(ids: string[]): Promise<PurchaseRequest[]> {
  await requireModuleAccess('procurement')
  if (ids.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('purchase_requests')
    .select(SELECT_WITH_RELATIONS)
    .in('id', ids)
    .order('pr_no', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data as unknown as PurchaseRequest[]) || []).map(mapRequestAllocations)
}

/** BOQ job options for the request form's per-line "สำหรับงาน" picker -
 * every boq_master row belonging to any of the given plots' house models,
 * deduped. Empty until a plot scope resolving to concrete plots is picked
 * (no plots -> no house model -> nothing to link to). */
export async function getBoqJobOptionsForPlots(plotIds: string[]): Promise<{ id: string; item_name: string }[]> {
  // Shared with the foreman purchase-request form (W-01) - just BOQ item
  // names, no prices, so 'foreman' is safe to let through too.
  await requireModuleAccess(['procurement', 'foreman'])
  if (plotIds.length === 0) return []
  const supabase = await createClient()

  const { data: plots, error: plotsError } = await supabase.from('plots').select('house_model_id').in('id', plotIds)
  if (plotsError) throw new Error(plotsError.message)

  const houseModelIds = Array.from(new Set((plots || []).map((p) => p.house_model_id).filter((id): id is string => Boolean(id))))
  if (houseModelIds.length === 0) return []

  const { data: jobs, error: jobsError } = await supabase
    .from('boq_master')
    .select('id, item_name')
    .in('house_model_id', houseModelIds)
    .order('item_name')
  if (jobsError) throw new Error(jobsError.message)

  return jobs || []
}

export async function createPurchaseRequest(input: {
  project_id: string
  plot_id?: string | null
  plot_group_id?: string | null
  /** Ad-hoc multi-plot selection - when non-empty, wins over plot_id/
   * plot_group_id (both are forced null server-side). */
  plot_ids?: string[]
  note?: string
  needed_by_date?: string
  items: { material_type_id: number; quantity_requested: number; note?: string; boq_id?: string | null; unit?: string | null }[]
}): Promise<{ id: string; pr_no: string } | { error: string }> {
  try {
    await requireModuleAccess('procurement')
    const supabase = await createClient()

    if (!input.project_id) throw new Error('Project is required')
    const items = input.items.filter((i) => i.material_type_id && Number(i.quantity_requested) > 0)
    if (items.length === 0) throw new Error('At least one material line is required')

    const { data, error } = await supabase.rpc('pr_create', {
      p_payload: {
        project_id: input.project_id,
        plot_id: input.plot_id || null,
        plot_group_id: input.plot_group_id || null,
        plot_ids: input.plot_ids && input.plot_ids.length > 0 ? input.plot_ids : [],
        note: input.note?.trim() || null,
        needed_by_date: input.needed_by_date || null,
        items,
      },
    })

    if (error) throw new Error(error.message)
    revalidatePath('/dashboard/procurement/requests')
    return data as { id: string; pr_no: string }
  } catch (error) {
    return { error: translatePrError(error instanceof Error ? error.message : 'ส่งคำขอซื้อไม่สำเร็จ') }
  }
}

export async function updatePurchaseRequest(
  id: string,
  input: {
    project_id: string
    plot_id?: string | null
    plot_group_id?: string | null
    plot_ids?: string[]
    note?: string
    needed_by_date?: string
    items: { material_type_id: number; quantity_requested: number; note?: string; boq_id?: string | null; unit?: string | null }[]
  }
): Promise<{ id: string; pr_no: string } | { error: string }> {
  try {
    await requireModuleAccess('procurement')
    const supabase = await createClient()

    if (!input.project_id) throw new Error('Project is required')
    const items = input.items.filter((i) => i.material_type_id && Number(i.quantity_requested) > 0)
    if (items.length === 0) throw new Error('At least one material line is required')

    const { data, error } = await supabase.rpc('pr_update', {
      p_id: id,
      p_payload: {
        project_id: input.project_id,
        plot_id: input.plot_id || null,
        plot_group_id: input.plot_group_id || null,
        plot_ids: input.plot_ids && input.plot_ids.length > 0 ? input.plot_ids : [],
        note: input.note?.trim() || null,
        needed_by_date: input.needed_by_date || null,
        items,
      },
    })

    if (error) throw new Error(error.message)
    revalidatePath('/dashboard/procurement/requests')
    revalidatePath(`/dashboard/procurement/requests/${id}`)
    return data as { id: string; pr_no: string }
  } catch (error) {
    return { error: translatePrError(error instanceof Error ? error.message : 'Failed to update purchase request') }
  }
}

export async function approvePurchaseRequest(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can approve a purchase request')
    const supabase = await createClient()
    const { error } = await supabase.rpc('pr_approve', { p_id: id })
    if (error) return { error: translatePrError(error.message) }
    revalidatePath('/dashboard/procurement/requests')
    revalidatePath(`/dashboard/procurement/requests/${id}`)
    return { ok: true }
  } catch (error) {
    return { error: translatePrError(error instanceof Error ? error.message : 'อนุมัติไม่สำเร็จ') }
  }
}

export async function rejectPurchaseRequest(id: string, note?: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can reject a purchase request')
    const supabase = await createClient()
    const { error } = await supabase.rpc('pr_reject', { p_id: id, p_note: note?.trim() || null })
    if (error) return { error: translatePrError(error.message) }
    revalidatePath('/dashboard/procurement/requests')
    revalidatePath(`/dashboard/procurement/requests/${id}`)
    return { ok: true }
  } catch (error) {
    return { error: translatePrError(error instanceof Error ? error.message : 'ปฏิเสธไม่สำเร็จ') }
  }
}

/** Close out quantity on request lines by hand, for material that was bought
 * outside this request's PO flow (a different brand, or a PO raised
 * standalone) or that isn't being bought at all. Settled quantity stops
 * counting as outstanding exactly like a PO's would, so the request can reach
 * 'ordered' instead of hanging on lines no PO will ever reference. */
export async function settlePurchaseRequestItems(input: {
  purchase_request_id: string
  reason: SettlementReason
  po_ref?: string
  note?: string
  items: { purchase_request_item_id: string; quantity: number }[]
}): Promise<{ settled: number } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can settle a purchase request line')
    const supabase = await createClient()

    const items = input.items.filter((i) => i.purchase_request_item_id && Number(i.quantity) > 0)
    if (items.length === 0) throw new Error('Select at least one line to settle')

    const { data, error } = await supabase.rpc('pr_item_settle', {
      p_payload: {
        purchase_request_id: input.purchase_request_id,
        reason: input.reason,
        po_ref: input.po_ref?.trim() || null,
        note: input.note?.trim() || null,
        items,
      },
    })
    if (error) throw new Error(error.message)

    revalidatePath('/dashboard/procurement/requests')
    revalidatePath(`/dashboard/procurement/requests/${input.purchase_request_id}`)
    return { settled: (data as { settled: number }).settled }
  } catch (error) {
    return { error: translatePrError(error instanceof Error ? error.message : 'Failed to settle purchase request lines') }
  }
}

/** Give one manual settlement's quantity back to its line, re-opening the
 * request if closing that line had been what finished it off. */
export async function undoPurchaseRequestItemSettlement(
  settlementId: string,
  requestId: string
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can undo a settlement')
    const supabase = await createClient()

    const { error } = await supabase.rpc('pr_item_settle_undo', { p_id: settlementId })
    if (error) throw new Error(error.message)

    revalidatePath('/dashboard/procurement/requests')
    revalidatePath(`/dashboard/procurement/requests/${requestId}`)
    return { ok: true }
  } catch (error) {
    return { error: translatePrError(error instanceof Error ? error.message : 'Failed to undo settlement') }
  }
}

export async function getApprovedRequestsForOrder(projectId?: string): Promise<PurchaseRequest[]> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  let query = supabase.from('purchase_requests').select(SELECT_WITH_RELATIONS).eq('status', 'approved').order('created_at', { ascending: false })
  if (projectId) query = query.eq('project_id', projectId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return ((data as unknown as PurchaseRequest[]) || []).map(mapRequestAllocations)
}

/** One request line that can still be ordered, flattened for the
 * "combine requests into one PO" picker. */
export type EligibleRequestLine = {
  purchase_request_item_id: string
  purchase_request_id: string
  pr_no: number
  project_id: string
  project_name: string
  /** Display label of the request's plot / plot group / multi-plot scope. */
  plot_label: string | null
  /** Every concrete plot the request's scope resolves to (a saved group is
   * expanded to its members) - used to scope the combined order. */
  plot_ids: string[]
  material_type_id: number
  material_name: string
  unit: string
  /** What is still outstanding on the line (purchase_request_items.quantity_requested). */
  remaining: number
  /** The material's current catalog price - the same default the single-request flow prefills. */
  unit_price: number
  requested_at: string
}

/** Approved request lines with something left to order, for one project.
 * Lines whose request unit differs from the material's own unit are left out:
 * a PO line transacts in the material's unit, and a consolidated line only
 * allocates same-unit quantities - those still go through the single-request
 * flow with its "covers the request" tick box. Lines already closed by an
 * order's tick box are left out too. */
export async function getEligibleRequestLinesForOrder(projectId: string): Promise<EligibleRequestLine[]> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('purchase_requests')
    .select(SELECT_WITH_RELATIONS)
    .eq('status', 'approved')
    .eq('project_id', projectId)
    .order('pr_no', { ascending: true })
  if (error) throw new Error(error.message)
  const requests = ((data as unknown as PurchaseRequest[]) || []).map(mapRequestAllocations)

  const groupIds = Array.from(new Set(requests.map((r) => r.plot_group_id).filter((id): id is string => Boolean(id))))
  const groupMembers = new Map<string, string[]>()
  if (groupIds.length > 0) {
    const { data: members, error: membersError } = await supabase
      .from('plot_group_members')
      .select('group_id, plot_id')
      .in('group_id', groupIds)
    if (membersError) throw new Error(membersError.message)
    for (const m of (members || []) as { group_id: string; plot_id: string }[]) {
      groupMembers.set(m.group_id, [...(groupMembers.get(m.group_id) || []), m.plot_id])
    }
  }

  const rows: EligibleRequestLine[] = []
  for (const request of requests) {
    const plotIds = request.plot_group_id
      ? groupMembers.get(request.plot_group_id) || []
      : request.plot_id
        ? [request.plot_id]
        : (request.purchase_request_plots || []).map((p) => p.plot_id)
    const plotNames = (request.purchase_request_plots || []).map((p) => p.plots?.name).filter(Boolean)
    const plotLabel = request.plots?.name
      ? `แปลง ${request.plots.name}`
      : request.plot_groups?.name
        ? `กลุ่มแปลง ${request.plot_groups.name}`
        : plotNames.length > 0
          ? `แปลง ${plotNames.join(', ')}`
          : null

    for (const item of request.purchase_request_items || []) {
      const remaining = Number(item.quantity_requested)
      if (!(remaining > 0)) continue
      if (isAnsweredByOrder(item)) continue
      const materialUnit = item.material_types?.unit || ''
      if (requestLineUnit(item) !== materialUnit) continue
      rows.push({
        purchase_request_item_id: item.id,
        purchase_request_id: request.id,
        pr_no: request.pr_no,
        project_id: request.project_id,
        project_name: request.projects?.name || '-',
        plot_label: plotLabel,
        plot_ids: plotIds,
        material_type_id: item.material_type_id,
        material_name: item.material_types?.name || '-',
        unit: materialUnit,
        remaining,
        unit_price: Number(item.material_types?.current_price ?? 0),
        requested_at: request.created_at,
      })
    }
  }
  return rows
}
