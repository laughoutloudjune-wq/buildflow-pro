'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requireAuthRole } from '@/actions/_shared/user-role'
import { translateError } from '@/lib/errors'
import type { LinkLine, LinkOrder, LinkPoItem } from '@/lib/procurement/linkPairing'

type Many<T> = T | T[] | null | undefined
const one = <T,>(v: Many<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

type MaterialEmbed = Many<{ name: string; unit: string | null; generic_material_id: number | null }>

type RawRequestItem = {
  id: string
  material_type_id: number
  quantity_requested: number | string
  unit: string | null
  line_status: string
  material_types: MaterialEmbed
  purchase_request_item_settlements: { reason: string; po_ref: string | null }[] | null
  purchase_request_po_links: { id: string }[] | null
}

const REQUEST_ITEM_SELECT = `
  id, material_type_id, quantity_requested, unit, line_status,
  material_types!purchase_request_items_material_type_id_fkey (name, unit, generic_material_id),
  purchase_request_item_settlements (reason, po_ref),
  purchase_request_po_links (id)
`

type RawOrder = {
  id: string
  po_no: string
  status: string
  order_date: string | null
  suppliers: Many<{ name: string }>
  purchase_order_items:
    | {
        id: string
        material_type_id: number
        quantity_ordered: number | string
        unit: string | null
        material_types: MaterialEmbed
      }[]
    | null
}

const ORDER_SELECT = `
  id, po_no, status, order_date, created_at,
  suppliers (name),
  purchase_order_items (id, material_type_id, quantity_ordered, unit, material_types (name, unit, generic_material_id))
`

/** A line can be linked while it is waiting for an order, or when it was closed
 * the old way (a typed PO number) and has no real link yet. */
function toLinkLine(requestId: string, prNo: string | null, item: RawRequestItem): LinkLine | null {
  const settlements = item.purchase_request_item_settlements || []
  const hasLink = (item.purchase_request_po_links || []).length > 0
  const closedByHand = item.line_status === 'closed' && settlements.some((s) => s.reason === 'ordered') && !hasLink
  if (item.line_status !== 'open' && !closedByHand) return null
  const mt = one(item.material_types)
  return {
    id: item.id,
    requestId,
    prNo,
    name: mt?.name ?? '-',
    materialTypeId: item.material_type_id,
    genericId: mt?.generic_material_id ?? null,
    quantity: Number(item.quantity_requested) || 0,
    unit: (item.unit || mt?.unit || '').trim(),
    typedPoRef: settlements.find((s) => s.reason === 'ordered' && s.po_ref)?.po_ref?.trim() || null,
  }
}

function toLinkOrder(po: RawOrder): LinkOrder {
  return {
    id: po.id,
    poNo: po.po_no,
    status: po.status,
    orderDate: po.order_date,
    supplier: one(po.suppliers)?.name ?? null,
    items: (po.purchase_order_items || []).map<LinkPoItem>((i) => {
      const mt = one(i.material_types)
      return {
        id: i.id,
        name: mt?.name ?? '-',
        materialTypeId: i.material_type_id,
        genericId: mt?.generic_material_id ?? null,
        quantity: Number(i.quantity_ordered) || 0,
        unit: (i.unit || mt?.unit || '').trim(),
      }
    }),
  }
}

/** Request page: this request's lines that still need an order, and the
 * project's orders they could be linked to. */
export async function getRequestLinkCandidates(
  requestId: string
): Promise<{ lines: LinkLine[]; orders: LinkOrder[] } | { error: string }> {
  try {
    await requireModuleAccess('procurement')
    const supabase = await createClient()

    const { data: req, error } = await supabase
      .from('purchase_requests')
      .select(`id, pr_no, project_id, purchase_request_items (${REQUEST_ITEM_SELECT})`)
      .eq('id', requestId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!req) throw new Error('Purchase request not found')

    const raw = req as unknown as { id: string; pr_no: string | null; project_id: string; purchase_request_items: RawRequestItem[] }
    const lines = (raw.purchase_request_items || [])
      .map((i) => toLinkLine(raw.id, raw.pr_no, i))
      .filter((l): l is LinkLine => l != null)

    const { data: recent, error: poError } = await supabase
      .from('purchase_orders')
      .select(ORDER_SELECT)
      .eq('project_id', raw.project_id)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(80)
    if (poError) throw new Error(poError.message)

    const orders = new Map<string, RawOrder>(((recent || []) as unknown as RawOrder[]).map((o) => [o.id, o]))
    // Always include the order a typed PO number points at, however old.
    const typedRefs = Array.from(new Set(lines.map((l) => l.typedPoRef).filter((v): v is string => !!v)))
    if (typedRefs.length > 0) {
      const { data: typed, error: typedError } = await supabase
        .from('purchase_orders')
        .select(ORDER_SELECT)
        .eq('project_id', raw.project_id)
        .neq('status', 'cancelled')
        .in('po_no', typedRefs)
      if (typedError) throw new Error(typedError.message)
      for (const o of (typed || []) as unknown as RawOrder[]) orders.set(o.id, o)
    }

    return { lines, orders: Array.from(orders.values()).map(toLinkOrder) }
  } catch (error) {
    return { error: translateError(error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ') }
  }
}

/** PO page: this order's lines, and the project's request lines still waiting
 * for an order. */
export async function getOrderLinkCandidates(
  orderId: string
): Promise<{ order: LinkOrder; lines: LinkLine[] } | { error: string }> {
  try {
    await requireModuleAccess('procurement')
    const supabase = await createClient()

    const { data: po, error } = await supabase
      .from('purchase_orders')
      .select(`${ORDER_SELECT}, project_id`)
      .eq('id', orderId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!po) throw new Error('Purchase order not found')
    const rawOrder = po as unknown as RawOrder & { project_id: string | null }
    if (!rawOrder.project_id) return { order: toLinkOrder(rawOrder), lines: [] }

    const { data: requests, error: reqError } = await supabase
      .from('purchase_requests')
      .select(`id, pr_no, purchase_request_items (${REQUEST_ITEM_SELECT})`)
      .eq('project_id', rawOrder.project_id)
      .in('status', ['approved', 'ordered'])
      .order('created_at', { ascending: false })
      .limit(120)
    if (reqError) throw new Error(reqError.message)

    const lines = ((requests || []) as unknown as { id: string; pr_no: string | null; purchase_request_items: RawRequestItem[] }[]).flatMap((r) =>
      (r.purchase_request_items || []).map((i) => toLinkLine(r.id, r.pr_no, i)).filter((l): l is LinkLine => l != null)
    )
    return { order: toLinkOrder(rawOrder), lines }
  } catch (error) {
    return { error: translateError(error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ') }
  }
}

/** Link request lines to order lines (PM/Admin). The database pairs them as
 * real links, so the request's status follows the order from here on. */
export async function linkRequestLinesToOrder(
  links: { purchaseRequestItemId: string; purchaseOrderItemId: string }[],
  refresh: { requestId?: string; orderId?: string } = {}
): Promise<{ linked: number } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can link a request to an order')
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('pr_link_to_po', {
      p_payload: {
        links: links.map((l) => ({
          purchase_request_item_id: l.purchaseRequestItemId,
          purchase_order_item_id: l.purchaseOrderItemId,
        })),
      },
    })
    if (error) throw new Error(error.message)
    revalidateLinkPaths(refresh)
    return { linked: (data as { linked: number }).linked }
  } catch (error) {
    return { error: translateError(error instanceof Error ? error.message : 'ผูกไม่สำเร็จ') }
  }
}

export async function unlinkRequestFromOrder(
  linkId: string,
  refresh: { requestId?: string; orderId?: string } = {}
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can remove a link')
    const supabase = await createClient()
    const { error } = await supabase.rpc('pr_unlink_po', { p_link_id: linkId })
    if (error) throw new Error(error.message)
    revalidateLinkPaths(refresh)
    return { ok: true }
  } catch (error) {
    return { error: translateError(error instanceof Error ? error.message : 'ยกเลิกการผูกไม่สำเร็จ') }
  }
}

function revalidateLinkPaths(refresh: { requestId?: string; orderId?: string }) {
  revalidatePath('/dashboard/procurement/requests')
  if (refresh.requestId) revalidatePath(`/dashboard/procurement/requests/${refresh.requestId}`)
  revalidatePath('/dashboard/procurement/orders')
  if (refresh.orderId) revalidatePath(`/dashboard/procurement/orders/${refresh.orderId}`)
}
