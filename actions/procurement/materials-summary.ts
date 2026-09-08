'use server'

import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'

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
  await requireModuleAccess('procurement')
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('purchase_orders')
    .select(
      `id, po_no, status, order_date, plot_id, plot_group_id,
       purchase_order_plots (plot_id),
       purchase_order_items (material_type_id, quantity_ordered, quantity_received, unit_price, material_types (name, unit))`
    )
    .eq('project_id', projectId)
    .neq('status', 'cancelled')
    .order('order_date', { ascending: false })

  if (error) throw new Error(error.message)

  const targetPlotIds = new Set(opts.plotIds || [])
  const scoped = opts.plotGroupId || targetPlotIds.size > 0

  const orders = ((data as unknown as QueriedOrder[]) || []).filter((order) => {
    if (!scoped) return true
    if (opts.plotGroupId && order.plot_group_id === opts.plotGroupId) return true
    if (order.plot_id && targetPlotIds.has(order.plot_id)) return true
    return (order.purchase_order_plots || []).some((p) => targetPlotIds.has(p.plot_id))
  })

  const summary = new Map<number, MaterialsSummaryRow>()
  for (const order of orders) {
    for (const item of order.purchase_order_items || []) {
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
      row.quantity_ordered += Number(item.quantity_ordered) || 0
      row.quantity_received += Number(item.quantity_received) || 0
      row.ordered_value += (Number(item.quantity_ordered) || 0) * unitPrice
      row.received_value += (Number(item.quantity_received) || 0) * unitPrice
      if (!row.orders.some((o) => o.id === order.id)) {
        row.orders.push({ id: order.id, po_no: order.po_no, status: order.status, order_date: order.order_date })
      }
    }
  }

  return Array.from(summary.values()).sort((a, b) => a.name.localeCompare(b.name, 'th'))
}
