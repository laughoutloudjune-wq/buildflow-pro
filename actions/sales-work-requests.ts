'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { todayInBangkok } from '@/lib/utils'

export type WorkRequestCategory = 'extra_work' | 'defect' | 'expedite' | 'handover_prep' | 'other'
export type WorkRequestPriority = 'low' | 'normal' | 'urgent'
export type WorkRequestStatus = 'new' | 'accepted' | 'in_progress' | 'done' | 'rejected'

export type WorkRequestRow = {
  id: string
  requestNo: string | null
  plotId: string
  plotName: string
  projectId: string
  projectName: string
  category: WorkRequestCategory
  title: string
  detail: string | null
  photoUrls: string[]
  priority: WorkRequestPriority
  neededBy: string | null
  status: WorkRequestStatus
  chargeTo: string | null
  quotedAmount: number | null
  assignedContractorId: string | null
  assignedContractorName: string | null
  billingId: string | null
  requestedByName: string | null
  acceptedByName: string | null
  rejectReason: string | null
  completedAt: string | null
  createdAt: string
}

type RawRow = {
  id: string
  request_no: string | null
  plot_id: string
  category: WorkRequestCategory
  title: string
  detail: string | null
  photo_urls: string[] | null
  priority: WorkRequestPriority
  needed_by: string | null
  status: WorkRequestStatus
  charge_to: string | null
  quoted_amount: number | null
  assigned_contractor_id: string | null
  billing_id: string | null
  reject_reason: string | null
  completed_at: string | null
  created_at: string
  plots: { name: string; project_id: string; projects: { id: string; name: string } | null } | null
  contractors: { name: string } | null
  requester: { full_name: string | null } | null
  accepter: { full_name: string | null } | null
}

const SELECT = `
  id, request_no, plot_id, category, title, detail, photo_urls, priority, needed_by, status,
  charge_to, quoted_amount, assigned_contractor_id, billing_id, reject_reason, completed_at, created_at,
  plots ( name, project_id, projects ( id, name ) ),
  contractors ( name ),
  requester:profiles!sales_work_requests_requested_by_fkey ( full_name ),
  accepter:profiles!sales_work_requests_accepted_by_fkey ( full_name )
`

function toRow(r: RawRow): WorkRequestRow {
  return {
    id: r.id,
    requestNo: r.request_no,
    plotId: r.plot_id,
    plotName: r.plots?.name || '',
    projectId: r.plots?.project_id || '',
    projectName: r.plots?.projects?.name || '',
    category: r.category,
    title: r.title,
    detail: r.detail,
    photoUrls: r.photo_urls || [],
    priority: r.priority,
    neededBy: r.needed_by,
    status: r.status,
    chargeTo: r.charge_to,
    quotedAmount: r.quoted_amount,
    assignedContractorId: r.assigned_contractor_id,
    assignedContractorName: r.contractors?.name || null,
    billingId: r.billing_id,
    requestedByName: r.requester?.full_name || null,
    acceptedByName: r.accepter?.full_name || null,
    rejectReason: r.reject_reason,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  }
}

/** Not gated with requireModuleAccess, same reasoning as the plot-detail
 * reads in sales-actions.ts - RLS (admin/pm/sales/foreman) is the real
 * authority, and this needs to work for every role that reaches the plot
 * page without redirecting the ones this table doesn't apply to. */
export async function getWorkRequestsForPlot(plotId: string): Promise<WorkRequestRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sales_work_requests')
    .select(SELECT)
    .eq('plot_id', plotId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data || []) as unknown as RawRow[]).map(toRow)
}

export type WorkRequestQueueFilter = {
  status?: WorkRequestStatus[]
  projectId?: string
}

export async function getWorkRequestQueue(filter: WorkRequestQueueFilter = {}): Promise<WorkRequestRow[]> {
  const supabase = await createClient()
  let query = supabase.from('sales_work_requests').select(SELECT)

  if (filter.status && filter.status.length > 0) query = query.in('status', filter.status)
  else query = query.in('status', ['new', 'accepted', 'in_progress'])

  const { data, error } = await query.order('needed_by', { ascending: true, nullsFirst: false })
  if (error) throw new Error(error.message)

  let rows = ((data || []) as unknown as RawRow[]).map(toRow)
  if (filter.projectId) rows = rows.filter((r) => r.projectId === filter.projectId)
  return rows
}

export type WorkRequestCounts = { newCount: number; overdueCount: number }

export async function getWorkRequestCounts(): Promise<WorkRequestCounts> {
  const supabase = await createClient()
  const today = todayInBangkok()

  const [newRes, overdueRes] = await Promise.all([
    supabase.from('sales_work_requests').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    supabase
      .from('sales_work_requests')
      .select('id', { count: 'exact', head: true })
      .in('status', ['new', 'accepted', 'in_progress'])
      .lt('needed_by', today),
  ])
  if (newRes.error) throw new Error(newRes.error.message)
  if (overdueRes.error) throw new Error(overdueRes.error.message)

  return { newCount: newRes.count || 0, overdueCount: overdueRes.count || 0 }
}

export async function createWorkRequest(formData: FormData) {
  await requireModuleAccess('sales')
  const supabase = await createClient()

  const photoUrlsRaw = String(formData.get('photo_urls') || '')
  const photoUrls = photoUrlsRaw ? photoUrlsRaw.split(',').map((s) => s.trim()).filter(Boolean) : []

  const { data, error } = await supabase.rpc('sales_work_request_create', {
    p_payload: {
      plot_id: String(formData.get('plot_id') || ''),
      category: String(formData.get('category') || ''),
      title: String(formData.get('title') || '').trim(),
      detail: String(formData.get('detail') || '').trim() || null,
      priority: String(formData.get('priority') || 'normal'),
      needed_by: String(formData.get('needed_by') || '').trim() || null,
      charge_to: String(formData.get('charge_to') || '').trim() || null,
      quoted_amount: formData.get('quoted_amount') ? Number(formData.get('quoted_amount')) : null,
      photo_urls: photoUrls,
    },
  })
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/sales-requests')
  revalidatePath('/dashboard/projects')
  return { success: true, data }
}

export async function setWorkRequestStatus(id: string, status: 'accepted' | 'in_progress' | 'done' | 'rejected', rejectReason?: string) {
  // 'projects' alone is exactly {admin,pm,foreman} under the locked Phase 1
  // defaults - the same set the sales_work_request_set_status() RPC checks
  // internally - so an OR with 'foreman' would just re-admit roles already
  // let in by 'projects'.
  await requireModuleAccess('projects')
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('sales_work_request_set_status', {
    p_id: id,
    p_payload: { status, reject_reason: rejectReason || null },
  })
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/sales-requests')
  revalidatePath('/dashboard/projects')
  revalidatePath('/dashboard')
  return { success: true, data }
}

export async function assignWorkRequestContractor(id: string, contractorId: string | null) {
  await requireModuleAccess('projects')
  const supabase = await createClient()
  const { error } = await supabase
    .from('sales_work_requests')
    .update({ assigned_contractor_id: contractorId })
    .eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/sales-requests')
  return { success: true }
}

export async function linkWorkRequestBilling(id: string, billingId: string | null) {
  await requireModuleAccess('projects')
  const supabase = await createClient()
  const { error } = await supabase
    .from('sales_work_requests')
    .update({ billing_id: billingId })
    .eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/sales-requests')
  return { success: true }
}

/** DCs (billings.type='extra_work') for a plot with no work request linked
 * yet - the options list for "link an existing DC" on a request row. */
export async function getUnlinkedDcBillingsForPlot(plotId: string): Promise<{ id: string; docNo: number | string | null; billingDate: string | null; netAmount: number | null }[]> {
  const supabase = await createClient()
  const [{ data: billings, error }, { data: linked }] = await Promise.all([
    supabase
      .from('billings')
      .select('id, doc_no, billing_date, net_amount')
      .eq('plot_id', plotId)
      .eq('type', 'extra_work')
      .order('billing_date', { ascending: false }),
    supabase.from('sales_work_requests').select('billing_id').eq('plot_id', plotId).not('billing_id', 'is', null),
  ])
  if (error) throw new Error(error.message)

  const linkedIds = new Set((linked || []).map((r) => r.billing_id))
  return (billings || [])
    .filter((b) => !linkedIds.has(b.id))
    .map((b) => ({ id: b.id, docNo: b.doc_no, billingDate: b.billing_date, netAmount: b.net_amount }))
}
