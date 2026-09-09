'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { getCurrentUser, requireAuthRole } from '@/actions/_shared/user-role'
import type { PurchaseRequest, PurchaseRequestStatus } from '@/lib/types/procurement'

const SELECT_WITH_RELATIONS = `
  *,
  projects (name),
  plots!purchase_requests_plot_id_fkey (name),
  plot_groups (name),
  purchase_request_plots (plot_id, plots (name)),
  requester:profiles!purchase_requests_requested_by_fkey (full_name, email),
  reviewer:profiles!purchase_requests_reviewed_by_fkey (full_name, email),
  purchase_request_items (*, material_types (*)),
  purchase_orders (po_no, status)
`

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
  return (data as unknown as PurchaseRequest[]) || []
}

export async function getPurchaseRequestById(id: string): Promise<PurchaseRequest | null> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  const { data, error } = await supabase.from('purchase_requests').select(SELECT_WITH_RELATIONS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as unknown as PurchaseRequest | null
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
  items: { material_type_id: number; quantity_requested: number; note?: string }[]
}) {
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
}

const PR_ERROR_TRANSLATIONS: [string, string][] = [
  ['Cannot edit a purchase request that has already been reviewed', 'ไม่สามารถแก้ไขคำขอซื้อนี้ได้ เนื่องจากถูกตรวจสอบไปแล้ว กรุณาโหลดหน้าใหม่เพื่อดูข้อมูลล่าสุด'],
  ['Choose either a single plot or a plot group, not both', 'กรุณาเลือกแปลงเดียวหรือกลุ่มแปลงอย่างใดอย่างหนึ่งเท่านั้น'],
  ['Purchase request not found', 'ไม่พบคำขอซื้อนี้'],
  ['No permission to edit this purchase request', 'ไม่มีสิทธิ์แก้ไขคำขอซื้อนี้'],
  ['Not authenticated', 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง'],
]

function translatePrError(message: string): string {
  return PR_ERROR_TRANSLATIONS.find(([needle]) => message.includes(needle))?.[1] || message
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
    items: { material_type_id: number; quantity_requested: number; note?: string }[]
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

export async function approvePurchaseRequest(id: string) {
  await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can approve a purchase request')
  const supabase = await createClient()
  const { error } = await supabase.rpc('pr_approve', { p_id: id })
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/procurement/requests')
  revalidatePath(`/dashboard/procurement/requests/${id}`)
}

export async function rejectPurchaseRequest(id: string, note?: string) {
  await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can reject a purchase request')
  const supabase = await createClient()
  const { error } = await supabase.rpc('pr_reject', { p_id: id, p_note: note?.trim() || null })
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/procurement/requests')
  revalidatePath(`/dashboard/procurement/requests/${id}`)
}

export async function getApprovedRequestsForOrder(projectId?: string): Promise<PurchaseRequest[]> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  let query = supabase.from('purchase_requests').select(SELECT_WITH_RELATIONS).eq('status', 'approved').order('created_at', { ascending: false })
  if (projectId) query = query.eq('project_id', projectId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data as unknown as PurchaseRequest[]) || []
}

// Exposed so the current user's own id is available client-side when needed
// (e.g. to label "your request").
export async function getCurrentRequesterId(): Promise<string | null> {
  const user = await getCurrentUser()
  return user?.id || null
}
