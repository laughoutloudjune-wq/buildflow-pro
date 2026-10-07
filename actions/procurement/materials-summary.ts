'use server'

import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { plotWeight, receivedShare, round4, unallocatedQty, type PlotScopeShape } from '@/lib/procurement/allocationTrace'

export type MaterialsSummaryRow = {
  material_type_id: number
  name: string
  unit: string
  quantity_ordered: number
  quantity_received: number
  /** quantity_ordered x unit_price, summed across contributing PO lines. */
  ordered_value: number
  /** quantity_received x unit_price - the actual cost incurred so far, since
   * unreceived quantity hasn't been paid for or physically arrived yet. */
  received_value: number
  orders: { id: string; po_no: string; status: string; order_date: string }[]
}

type QueriedOrder = {
  id: string
  po_no: string
  status: string
  order_date: string
  plot_id: string | null
  plot_group_id: string | null
  purchase_order_plots: { plot_id: string }[] | null
  purchase_order_items:
    | {
        material_type_id: number
        quantity_ordered: number
        quantity_received: number
        unit_price: number
        material_types: { name: string; unit: string } | null
        purchase_order_item_allocations:
          | {
              quantity_allocated: number
              purchase_request_items: {
                purchase_requests: {
                  plot_id: string | null
                  plot_group_id: string | null
                  plot_groups: { plot_group_members: { plot_id: string }[] | null } | null
                  purchase_request_plots: { plot_id: string }[] | null
                } | null
              } | null
            }[]
          | null
      }[]
    | null
}

/** Rolls up purchase order line items for a project into one row per
 * material - ordered/received totals plus which POs contributed - so a
 * plot or plot group's tagged materials can be seen without opening each
 * PO individually. Filtered in JS rather than a cross-table SQL filter: a
 * PO's plot scope is one of three shapes (single plot_id, a saved
 * plot_group_id, or ad-hoc purchase_order_plots rows), and a project's PO
 * count is small enough that fetching them all with their scope already
 * embedded and matching client-side is simpler than getting an OR across
 * a related table right in PostgREST syntax. */
export async function getMaterialsSummaryForProject(
  projectId: string,
  opts: { plotGroupId?: string; plotIds?: string[] } = {}
): Promise<MaterialsSummaryRow[]> {
  // Also reachable from the cost-control page (BOQ_CONTROL_PLAN.md 8.3),
  // which gates on 'cost_control' rather than 'procurement' - a user granted
  // only one of the two must still be able to call this.
  await requireModuleAccess(['procurement', 'cost_control'])
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('purchase_orders')
    .select(
      `id, po_no, status, order_date, plot_id, plot_group_id,
       purchase_order_plots (plot_id),
       purchase_order_items (
         material_type_id, quantity_ordered, quantity_received, unit_price, material_types (name, unit),
         purchase_order_item_allocations (
           quantity_allocated,
           purchase_request_items (
             purchase_requests (
               plot_id, plot_group_id,
               plot_groups (plot_group_members (plot_id)),
               purchase_request_plots (plot_id)
             )
           )
         )
       )`
    )
    .eq('project_id', projectId)
    .neq('status', 'cancelled')
    .order('order_date', { ascending: false })

  if (error) throw new Error(error.message)

  const targetPlotIds = new Set(opts.plotIds || [])
  // A saved group scope is judged plot by plot against each request's own
  // plots, so its members are needed.
  if (opts.plotGroupId && targetPlotIds.size === 0) {
    const { data: members, error: membersError } = await supabase
      .from('plot_group_members')
      .select('plot_id')
      .eq('group_id', opts.plotGroupId)
    if (membersError) throw new Error(membersError.message)
    for (const m of members || []) targetPlotIds.add(m.plot_id)
  }
  const scoped = Boolean(opts.plotGroupId) || targetPlotIds.size > 0

  // Orders raised under another project that buy for THIS project's requests:
  // only the allocations to this project's requests count here.
  const { data: crossData, error: crossError } = await supabase
    .from('purchase_orders')
    .select(
      `id, po_no, status, order_date, plot_id, plot_group_id,
       purchase_order_plots (plot_id),
       purchase_order_items!inner (
         material_type_id, quantity_ordered, quantity_received, unit_price, material_types (name, unit),
         purchase_order_item_allocations!inner (
           quantity_allocated,
           purchase_request_items!inner (
             purchase_requests!inner (
               project_id, plot_id, plot_group_id,
               plot_groups (plot_group_members (plot_id)),
               purchase_request_plots (plot_id)
             )
           )
         )
       )`
    )
    .neq('project_id', projectId)
    .neq('status', 'cancelled')
    .eq('purchase_order_items.purchase_order_item_allocations.purchase_request_items.purchase_requests.project_id', projectId)
  // An add-on lookup: if it fails the project's own orders must still show.
  if (crossError) console.error('materials summary: cross-project lookup failed', crossError.message)

  const orders = (data as unknown as QueriedOrder[]) || []
  const crossOrders = ((crossError ? [] : crossData) as unknown as QueriedOrder[]) || []

  const summary = new Map<number, MaterialsSummaryRow>()
  const add = (order: QueriedOrder, item: NonNullable<QueriedOrder['purchase_order_items']>[number], qtyOrdered: number, qtyReceived: number) => {
    if (qtyOrdered <= 0) return
    let row = summary.get(item.material_type_id)
    if (!row) {
      row = {
        material_type_id: item.material_type_id,
        name: item.material_types?.name || '-',
        unit: item.material_types?.unit || '',
        quantity_ordered: 0,
        quantity_received: 0,
        ordered_value: 0,
        received_value: 0,
        orders: [],
      }
      summary.set(item.material_type_id, row)
    }
    const unitPrice = Number(item.unit_price) || 0
    row.quantity_ordered += qtyOrdered
    row.quantity_received += qtyReceived
    row.ordered_value += qtyOrdered * unitPrice
    row.received_value += qtyReceived * unitPrice
    if (!row.orders.some((o) => o.id === order.id)) {
      row.orders.push({ id: order.id, po_no: order.po_no, status: order.status, order_date: order.order_date })
    }
  }

  // allocationsOnly: this order is not this project's own, so a line's
  // unallocated remainder is never counted here.
  const visit = (order: QueriedOrder, allocationsOnly: boolean) => {
    const orderMatches =
      !scoped ||
      (opts.plotGroupId != null && order.plot_group_id === opts.plotGroupId) ||
      (order.plot_id != null && targetPlotIds.has(order.plot_id)) ||
      (order.purchase_order_plots || []).some((p) => targetPlotIds.has(p.plot_id))

    for (const item of order.purchase_order_items || []) {
      const ordered = Number(item.quantity_ordered) || 0
      const received = Number(item.quantity_received) || 0
      const allocations = item.purchase_order_item_allocations || []

      if (allocations.length === 0) {
        if (orderMatches && !allocationsOnly) add(order, item, ordered, received)
        continue
      }

      // Allocated part: each allocation counts only for its own request's
      // plots - the order header's plot list is not consulted.
      for (const a of allocations) {
        const qty = Number(a.quantity_allocated) || 0
        const pr = a.purchase_request_items?.purchase_requests
        if (!pr) continue
        if (!scoped) {
          add(order, item, qty, receivedShare(received, ordered, qty))
          continue
        }
        const members =
          pr.plot_id != null
            ? []
            : pr.plot_group_id != null
              ? (pr.plot_groups?.plot_group_members || []).map((m) => m.plot_id)
              : (pr.purchase_request_plots || []).map((x) => x.plot_id)
        const scope: PlotScopeShape = { plotId: pr.plot_id, plotGroupId: pr.plot_group_id, memberPlotIds: members }
        let weight = 0
        for (const plotId of targetPlotIds) weight += plotWeight(scope, plotId)
        if (weight > 0) add(order, item, round4(qty * weight), round4(receivedShare(received, ordered, qty) * weight))
      }

      // Whatever no allocation covers keeps the order-level rule.
      const remainder = unallocatedQty(ordered, allocations.map((a) => Number(a.quantity_allocated) || 0))
      if (remainder > 0 && orderMatches && !allocationsOnly) add(order, item, remainder, receivedShare(received, ordered, remainder))
    }
  }
  for (const order of orders) visit(order, false)
  for (const order of crossOrders) visit(order, true)

  return Array.from(summary.values()).sort((a, b) => a.name.localeCompare(b.name, 'th'))
}
