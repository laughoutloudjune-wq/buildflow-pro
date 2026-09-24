'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requireAuthRole } from '@/actions/_shared/user-role'
import { translateError as translatePoError } from '@/lib/errors'
import type { LastMaterialOrderPrice, PurchaseOrder, PurchaseOrderInput, PurchaseOrderStatus } from '@/lib/types/procurement'

const SELECT_WITH_RELATIONS = `
  *,
  suppliers (*),
  supplier_branches (*),
  companies (*),
  projects (name, location),
  plots!purchase_orders_plot_id_fkey (name),
  plot_groups (name),
  purchase_order_plots (plot_id, plots (name)),
  purchase_requests (pr_no),
  creator:profiles!purchase_orders_created_by_fkey (full_name),
  receiver:profiles!purchase_orders_received_by_fkey (full_name),
  payer:profiles!purchase_orders_paid_by_fkey (full_name),
  purchase_order_items (*, material_types (*), projects (name), plots (name), plot_groups (name))
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
      supplier_branch_id: input.supplier_branch_id || null,
      company_id: input.company_id,
      project_id: input.project_id,
      plot_id: input.plot_id || null,
      plot_group_id: input.plot_group_id || null,
      plot_ids: input.plot_ids && input.plot_ids.length > 0 ? input.plot_ids : [],
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
      is_outside_boq: Boolean(input.is_outside_boq),
      outside_boq_reason: input.outside_boq_reason?.trim() || null,
      items: items.map((i) => ({
        id: i.id || null,
        material_type_id: i.material_type_id,
        purchase_request_item_id: i.purchase_request_item_id || null,
        quantity_ordered: Number(i.quantity_ordered),
        unit: i.unit?.trim() || null,
        closes_request_line: Boolean(i.closes_request_line),
        unit_price: Math.max(0, Number(i.unit_price) || 0),
        description: i.description?.trim() || null,
        discount_type: i.discount_type || 'none',
        discount_value: Math.max(0, Number(i.discount_value) || 0),
        project_id: i.project_id || null,
        plot_id: i.plot_id || null,
        plot_group_id: i.plot_group_id || null,
        intended_destination: i.intended_destination || null,
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

// Draft/cancelled orders were never actually fulfilled, so they're skipped
// in favour of the most recent order that was - looking a few rows back
// (rather than filtering server-side through the purchase_orders!inner
// embed, whose cross-table filter syntax is easy to get subtly wrong) keeps
// this simple and correct even if the last couple of orders for a material
// happened to be drafts or got cancelled.
export async function getLastMaterialOrderPrice(
  materialTypeId: number,
  excludeOrderId?: string
): Promise<LastMaterialOrderPrice | null> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()

  let query = supabase
    .from('purchase_order_items')
    .select('unit_price, purchase_order_id, purchase_orders!inner(po_no, order_date, status)')
    .eq('material_type_id', materialTypeId)
    .order('order_date', { foreignTable: 'purchase_orders', ascending: false })
    .limit(10)

  if (excludeOrderId) query = query.neq('purchase_order_id', excludeOrderId)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  type Row = {
    unit_price: number
    purchase_order_id: string
    purchase_orders: { po_no: number; order_date: string; status: string } | { po_no: number; order_date: string; status: string }[]
  }

  for (const row of (data || []) as unknown as Row[]) {
    const po = Array.isArray(row.purchase_orders) ? row.purchase_orders[0] : row.purchase_orders
    if (po && po.status !== 'draft' && po.status !== 'cancelled') {
      return { unitPrice: row.unit_price, orderDate: po.order_date, poNo: po.po_no, purchaseOrderId: row.purchase_order_id }
    }
  }
  return null
}

// Next.js strips the message off anything thrown across a Server Action
// boundary in production (replaced with a generic digest, to avoid leaking
// server internals by default) - so a plain `throw` here would turn even a
// clean, expected validation message like "already has goods received" into
// an unreadable "An error occurred in the Server Components render" toast
// for the user. Returning `{ error }` as normal data instead sidesteps that
// sanitization. translatePoError (imported above as lib/errors's shared
// translateError) covers the raw RPC exception text (English, from the SQL
// function) with the Thai the rest of the form is in.

export async function createPurchaseOrder(
  input: PurchaseOrderInput & { status?: 'draft' | 'sent' }
): Promise<{ id: string; po_no: string } | { error: string }> {
  try {
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
  } catch (error) {
    return { error: translatePoError(error instanceof Error ? error.message : 'Failed to create purchase order') }
  }
}

export async function updatePurchaseOrder(
  id: string,
  input: PurchaseOrderInput
): Promise<{ id: string; po_no: string } | { error: string }> {
  try {
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
  } catch (error) {
    return { error: translatePoError(error instanceof Error ? error.message : 'Failed to update purchase order') }
  }
}

export async function setPurchaseOrderStatus(id: string, status: 'draft' | 'sent'): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can change purchase order status')
    const supabase = await createClient()
    const { error } = await supabase.rpc('po_set_status', { p_id: id, p_status: status })
    if (error) return { error: translatePoError(error.message) }
    revalidatePath('/dashboard/procurement/orders')
    revalidatePath(`/dashboard/procurement/orders/${id}`)
    return { ok: true }
  } catch (error) {
    return { error: translatePoError(error instanceof Error ? error.message : 'เปลี่ยนสถานะไม่สำเร็จ') }
  }
}

export async function cancelPurchaseOrder(id: string, reason?: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can cancel a purchase order')
    const supabase = await createClient()
    const { error } = await supabase.rpc('po_cancel', { p_id: id, p_reason: reason?.trim() || null })
    if (error) return { error: translatePoError(error.message) }
    revalidatePath('/dashboard/procurement/orders')
    revalidatePath(`/dashboard/procurement/orders/${id}`)
    return { ok: true }
  } catch (error) {
    return { error: translatePoError(error instanceof Error ? error.message : 'ยกเลิกไม่สำเร็จ') }
  }
}

/** From partially_received: shrinks every short line's ordered quantity
 * down to what arrived, recomputes totals, gives the un-ordered remainder
 * back to the linked purchase request, and closes the PO as 'received' -
 * see 202609230008_po_close_short.sql (M-04). */
export async function closePurchaseOrderShort(id: string, reason: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can close a purchase order')
    const supabase = await createClient()
    const { error } = await supabase.rpc('po_close_short', { p_id: id, p_reason: reason.trim() })
    if (error) return { error: translatePoError(error.message) }
    revalidatePath('/dashboard/procurement/orders')
    revalidatePath(`/dashboard/procurement/orders/${id}`)
    revalidatePath('/dashboard/procurement/requests')
    return { ok: true }
  } catch (error) {
    return { error: translatePoError(error instanceof Error ? error.message : 'ปิดใบสั่งซื้อไม่สำเร็จ') }
  }
}

/** Fully reverses everything this PO has ever received: every line's
 * quantity_received goes back to 0, the goods_receipts/goods_receipt_items
 * rows are gone, and the stock those receipts added (or, for a direct-to-
 * site line, netted to zero) is reversed - not just the status label. See
 * 202609230003_po_unmark_received_full_undo.sql for why and what it
 * refuses (a receipt already paid, or material already withdrawn). */
export async function unmarkPurchaseOrderReceived(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can unmark a purchase order as received')
    const supabase = await createClient()
    const { error } = await supabase.rpc('po_unmark_received', { p_id: id })
    if (error) return { error: translatePoError(error.message) }
    revalidatePath('/dashboard/procurement/orders')
    revalidatePath(`/dashboard/procurement/orders/${id}`)
    revalidatePath('/dashboard/procurement/requests')
    revalidatePath('/dashboard/procurement/receipts')
    revalidatePath('/dashboard/stock')
    return { ok: true }
  } catch (error) {
    return { error: translatePoError(error instanceof Error ? error.message : 'ยกเลิกการรับของไม่สำเร็จ') }
  }
}

/** Only draft/sent/cancelled orders with no goods_receipts can be deleted -
 * po_delete enforces this server-side; this just surfaces its error. */
export async function deletePurchaseOrder(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can delete a purchase order')
    const supabase = await createClient()
    const { error } = await supabase.rpc('po_delete', { p_id: id })
    if (error) return { error: translatePoError(error.message) }
    revalidatePath('/dashboard/procurement/orders')
    revalidatePath('/dashboard/procurement/requests')
    return { ok: true }
  } catch (error) {
    return { error: translatePoError(error instanceof Error ? error.message : 'ลบไม่สำเร็จ') }
  }
}

/** Deletes each id independently (no partial-batch rollback) and reports how
 * many succeeded - the list page's bulk "delete selected" action. */
export async function deletePurchaseOrders(ids: string[]) {
  const results = await Promise.all(ids.map((id) => deletePurchaseOrder(id)))
  const errors = results.filter((r): r is { error: string } => 'error' in r).map((r) => r.error)
  return { deleted: ids.length - errors.length, failed: errors.length, errors }
}

/** Copies a PO's vendor/terms/line items into a brand-new draft - a fresh
 * po_no, today's date, and no link back to the source order's purchase
 * request (that request was already consumed by the original order). */
export async function duplicatePurchaseOrder(id: string): Promise<{ id: string; po_no: string } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can duplicate a purchase order')
  } catch (error) {
    return { error: translatePoError(error instanceof Error ? error.message : 'ทำสำเนาไม่สำเร็จ') }
  }
  const source = await getPurchaseOrderById(id)
  if (!source) return { error: translatePoError('Purchase order not found') }

  return createPurchaseOrder({
    supplier_id: source.supplier_id,
    supplier_branch_id: source.supplier_branch_id,
    company_id: source.company_id,
    project_id: source.project_id,
    plot_id: source.plot_id,
    plot_group_id: source.plot_group_id,
    delivery_address: source.delivery_address || undefined,
    vat_percent: source.vat_percent,
    vat_type: source.vat_type,
    payment_terms: source.payment_terms || undefined,
    discount_type: source.discount_type,
    discount_value: source.discount_value,
    note: source.note || undefined,
    status: 'draft',
    items: (source.purchase_order_items || []).map((i) => ({
      material_type_id: i.material_type_id,
      quantity_ordered: i.quantity_ordered,
      unit: i.unit || undefined,
      // closes_request_line deliberately not copied - it answered the source
      // order's own (now-dropped) request link, and a fresh unlinked line
      // has no request to answer.
      unit_price: i.unit_price,
      description: i.description || undefined,
      discount_type: i.discount_type,
      discount_value: i.discount_value,
      project_id: i.project_id,
      plot_id: i.plot_id,
      plot_group_id: i.plot_group_id,
      intended_destination: i.intended_destination,
    })),
  })
}

/** Duplicates each id independently and reports how many succeeded - the
 * list page's bulk "duplicate selected" action. */
export async function duplicatePurchaseOrders(ids: string[]) {
  const results = await Promise.all(ids.map((id) => duplicatePurchaseOrder(id)))
  const created = results.filter((r): r is { id: string; po_no: string } => !('error' in r))
  const errors = results.filter((r): r is { error: string } => 'error' in r).map((r) => r.error)
  return { created, failed: errors.length, errors }
}
