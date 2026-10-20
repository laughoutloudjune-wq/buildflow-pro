import type { createClient } from '@/lib/supabase/server'
import { plotWeight, round4, type PlotScopeShape } from '@/lib/procurement/allocationTrace'

type Supabase = Awaited<ReturnType<typeof createClient>>

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export type PlotExtraWorkRow = {
  id: string
  docNo: string | null
  date: string | null
  /** Gross value of the extra work before retention / withholding. */
  value: number
  status: 'approved' | 'pending_review'
  reason: string | null
  contractorName: string | null
}

/** Extra work (DC bills) on one plot. Approved bills are committed cost;
 * pending ones are shown but kept apart so they never inflate a total. */
export async function fetchPlotExtraWork(supabase: Supabase, plotId: string): Promise<PlotExtraWorkRow[]> {
  const { data, error } = await supabase
    .from('billings')
    .select('id, doc_no, billing_date, total_work_amount, status, reason_for_dc, contractors (name)')
    .eq('plot_id', plotId)
    .eq('type', 'extra_work')
    .in('status', ['approved', 'pending_review'])
    .order('billing_date', { ascending: false })
  if (error) throw new Error(error.message)

  type Row = {
    id: string
    doc_no: string | number | null
    billing_date: string | null
    total_work_amount: number | string | null
    status: string
    reason_for_dc: string | null
    contractors: { name: string | null } | { name: string | null }[] | null
  }
  return ((data || []) as unknown as Row[]).map((r) => ({
    id: r.id,
    docNo: r.doc_no == null ? null : String(r.doc_no),
    date: r.billing_date,
    value: Number(r.total_work_amount) || 0,
    status: r.status === 'approved' ? 'approved' : 'pending_review',
    reason: r.reason_for_dc,
    contractorName: asSingle(r.contractors)?.name ?? null,
  }))
}

type RequestRow = {
  id: string
  plot_id: string | null
  plot_group_id: string | null
  plot_groups: { plot_group_members: { plot_id: string }[] | null } | { plot_group_members: { plot_id: string }[] | null }[] | null
  purchase_request_plots: { plot_id: string }[] | null
  purchase_request_items: { material_type_id: number; quantity_requested: number | string | null; line_status: string | null }[] | null
}

/**
 * Quantity requested (PR lines) per material for one plot - the "Requested"
 * stage of the Plan > Requested > Ordered > Received > Used funnel. A request
 * covering several plots is split evenly across them, the same rule the
 * ordered and used figures follow. Rejected and cancelled requests and
 * closed lines are not counted: they will never be bought.
 */
export async function fetchPlotRequestedQty(supabase: Supabase, projectId: string, plotId: string): Promise<Map<number, number>> {
  const { data: groupRow } = await supabase.from('plot_group_members').select('group_id').eq('plot_id', plotId).maybeSingle()
  const groupId = groupRow?.group_id || null

  const { data: adHoc, error: adHocError } = await supabase.from('purchase_request_plots').select('purchase_request_id').eq('plot_id', plotId)
  if (adHocError) throw new Error(adHocError.message)
  const adHocIds = (adHoc || []).map((r) => r.purchase_request_id as string)

  const filters = [`plot_id.eq.${plotId}`]
  if (groupId) filters.push(`plot_group_id.eq.${groupId}`)
  if (adHocIds.length > 0) filters.push(`id.in.(${adHocIds.join(',')})`)

  const { data, error } = await supabase
    .from('purchase_requests')
    .select(
      `id, plot_id, plot_group_id,
       plot_groups (plot_group_members (plot_id)),
       purchase_request_plots (plot_id),
       purchase_request_items (material_type_id, quantity_requested, line_status)`
    )
    .eq('project_id', projectId)
    .not('status', 'in', '(rejected,cancelled)')
    .or(filters.join(','))
  if (error) throw new Error(error.message)

  const requested = new Map<number, number>()
  for (const pr of (data || []) as unknown as RequestRow[]) {
    const members =
      pr.plot_id != null
        ? []
        : pr.plot_group_id != null
          ? (asSingle(pr.plot_groups)?.plot_group_members || []).map((m) => m.plot_id)
          : (pr.purchase_request_plots || []).map((x) => x.plot_id)
    const scope: PlotScopeShape = { plotId: pr.plot_id, plotGroupId: pr.plot_group_id, memberPlotIds: members }
    const weight = plotWeight(scope, plotId)
    if (weight <= 0) continue
    for (const item of pr.purchase_request_items || []) {
      if (item.line_status === 'closed') continue
      const qty = Number(item.quantity_requested) || 0
      if (qty <= 0) continue
      requested.set(item.material_type_id, round4((requested.get(item.material_type_id) || 0) + qty * weight))
    }
  }
  return requested
}
