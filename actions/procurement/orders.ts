'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requireAuthRole } from '@/actions/_shared/user-role'
import type { PurchaseOrder, PurchaseOrderInput, PurchaseOrderStatus } from '@/lib/types/procurement'

const SELECT_WITH_RELATIONS = `
  *,
  suppliers (*),
  companies (*),
  projects (name, location),
  plots (name),
  purchase_requests (pr_no),
  creator:profiles!purchase_orders_created_by_fkey (full_name),
  receiver:profiles!purchase_orders_received_by_fkey (full_name),
  payer:profiles!purchase_orders_paid_by_fkey (full_name),
  purchase_order_items (*, material_types (*))
`

export type PurchaseOrderFilters = {
  projectId?: string
  supplierId?: string
  status?: PurchaseOrderStatus
}

function buildPayload(input: PurchaseOrderInput) {
  const items = input.items.filter((i) => i.material_type_id && Number(i.quantity_ordered) > 0)
  return {
    payload: {
      supplier_id: input.supplier_id,
      company_id: input.company_id,
      project_id: input.project_id,
      plot_id: input.plot_id || null,
      purchase_request_id: input.purchase_request_id || null,
      order_date: input.order_date || null,
      expected_delivery_date: input.expected_delivery_date || null,
      delivery_address: input.delivery_address?.trim() || null,
      vat_percent: Math.max(0, Number(input.vat_percent) || 0),
      vat_type: input.vat_type === 'inclusive' ? 'inclusive' : 'exclusive',
      payment_terms: input.payment_terms?.trim() || null,
      discount_type: input.discount_type || 'none',
      discount_value: Math.max(0, Number(input.discount_value) || 0),
      note: input.note?.trim() || null,
      items: items.map((i) => ({
        material_type_id: i.material_type_id,
        purchase_request_item_id: i.purchase_request_item_id || null,
        quantity_ordered: Number(i.quantity_ordered),
        unit_price: Math.max(0, Number(i.unit_price) || 0),
        description: i.description?.trim() || null,
        discount_type: i.discount_type || 'none',
        discount_value: Math.max(0, Number(i.discount_value) || 0),
      })),
    },
    itemCount: items.length,
  }
}

export async function getPurchaseOrders(filters: PurchaseOrderFilters = {}): Promise<PurchaseOrder[]> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()

  let query = supabase.from('purchase_orders').select(SELECT_WITH_RELATIONS).order('created_at', { ascending: false })
  if (filters.projectId) query = query.eq('project_id', filters.projectId)
  if (filters.supplierId) query = query.eq('supplier_id', filters.supplierId)
  if (filters.status) query = query.eq('status', filters.status)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data as unknown as PurchaseOrder[]) || []
}

export async function getPurchaseOrderById(id: string): Promise<PurchaseOrder | null> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  const { data, error } = await supabase.from('purchase_orders').select(SELECT_WITH_RELATIONS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as unknown as PurchaseOrder | null
}

export async function createPurchaseOrder(input: PurchaseOrderInput & { status?: 'draft' | 'sent' }) {
  await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can create a purchase order')
  const supabase = await createClient()

  if (!input.supplier_id) throw new Error('Supplier is required')
  if (!input.company_id) throw new Error('Company is required')
  if (!input.project_id) throw new Error('Project is required')
  const { payload, itemCount } = buildPayload(input)
  if (itemCount === 0) throw new Error('At least one material line is required')

  const { data, error } = await supabase.rpc('po_create', {
    p_payload: { ...payload, status: input.status || 'sent' },
  })

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/procurement/orders')
  revalidatePath('/dashboard/procurement/requests')
  return data as { id: string; po_no: string }
}

export async function updatePurchaseOrder(id: string, input: PurchaseOrderInput) {
  await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can edit a purchase order')
  const supabase = await createClient()

  if (!input.supplier_id) throw new Error('Supplier is required')
  if (!input.company_id) throw new Error('Company is required')
  if (!input.project_id) throw new Error('Project is required')
  const { payload, itemCount } = buildPayload(input)
  if (itemCount === 0) throw new Error('At least one material line is required')

  const { data, error } = await supabase.rpc('po_update', { p_id: id, p_payload: payload })

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/procurement/orders')
  revalidatePath(`/dashboard/procurement/orders/${id}`)
  return data as { id: string; po_no: string }
}

export async function setPurchaseOrderStatus(id: string, status: 'draft' | 'sent') {
  await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can change purchase order status')
  const supabase = await createClient()
  const { error } = await supabase.rpc('po_set_status', { p_id: id, p_status: status })
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/procurement/orders')
  revalidatePath(`/dashboard/procurement/orders/${id}`)
}

export async function cancelPurchaseOrder(id: string, reason?: string) {
  await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can cancel a purchase order')
  const supabase = await createClient()
  const { error } = await supabase.rpc('po_cancel', { p_id: id, p_reason: reason?.trim() || null })
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/procurement/orders')
  revalidatePath(`/dashboard/procurement/orders/${id}`)
}

export async function markPurchaseOrderReceived(id: string, receivedAt: string) {
  await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can mark a purchase order as received')
  const supabase = await createClient()
  const { error } = await supabase.rpc('po_mark_received', { p_id: id, p_received_at: receivedAt })
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/procurement/orders')
  revalidatePath(`/dashboard/procurement/orders/${id}`)
}

export async function unmarkPurchaseOrderReceived(id: string) {
  await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can unmark a purchase order as received')
  const supabase = await createClient()
  const { error } = await supabase.rpc('po_unmark_received', { p_id: id })
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/procurement/orders')
  revalidatePath(`/dashboard/procurement/orders/${id}`)
}

export async function markPurchaseOrdersAsPaid(ids: string[], paidAt: string) {
  await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can mark purchase orders as paid')
  const supabase = await createClient()
  const { error } = await supabase.rpc('po_mark_paid', { p_ids: ids, p_paid_at: paidAt })
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/procurement/orders')
}

export async function unmarkPurchaseOrderPaid(id: string) {
  await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can unmark a purchase order as paid')
  const supabase = await createClient()
  const { error } = await supabase.rpc('po_unmark_paid', { p_id: id })
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/procurement/orders')
  revalidatePath(`/dashboard/procurement/orders/${id}`)
}
