'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { getCurrentUser, requireAuthRole } from '@/actions/_shared/user-role'
import type { PurchaseRequest, PurchaseRequestStatus } from '@/lib/types/procurement'

const SELECT_WITH_RELATIONS = `
  *,
  projects (name),
  plots (name),
  requester:profiles!purchase_requests_requested_by_fkey (full_name, email),
  purchase_request_items (*, material_types (*))
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
      note: input.note?.trim() || null,
      needed_by_date: input.needed_by_date || null,
      items,
    },
  })

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/procurement/requests')
  return data as { id: string; pr_no: string }
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
