'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireModuleAccess, getDashboardSession } from '@/lib/auth/route-access'

// TR (transfer request / ใบขอโอน): one numbered document per plot sale.
// draft -> submitted -> approved (sales exec/admin) -> done, or rejected.
// All writes go through the transfer_request_* RPCs (numbering, commission
// snapshot, notifications, role checks live there).

export type TransferRequestStatus = 'draft' | 'submitted' | 'approved' | 'done' | 'rejected'

export type TransferRequestRow = {
  id: string
  requestNo: string | null
  plotSaleId: string
  plotId: string
  plotName: string
  projectId: string
  projectName: string
  customerName: string | null
  status: TransferRequestStatus
  price: number
  discount: number
  promotionTotal: number
  commissionAmount: number
  notes: string | null
  rejectReason: string | null
  requestedByName: string | null
  approvedByName: string | null
  submittedAt: string | null
  approvedAt: string | null
  doneAt: string | null
  createdAt: string
}

type Joined<T> = T | T[] | null
type RawRow = {
  id: string
  request_no: string | null
  plot_sale_id: string
  plot_id: string
  status: TransferRequestStatus
  price: number
  discount: number
  promotion_total: number
  commission_amount: number
  notes: string | null
  reject_reason: string | null
  submitted_at: string | null
  approved_at: string | null
  done_at: string | null
  created_at: string
  plots: Joined<{ name: string; project_id: string; projects: Joined<{ id: string; name: string }> }>
  plot_sales: Joined<{ customers: Joined<{ full_name: string }> }>
  requester: Joined<{ full_name: string | null }>
  approver: Joined<{ full_name: string | null }>
}

const SELECT = `
  id, request_no, plot_sale_id, plot_id, status, price, discount, promotion_total, commission_amount,
  notes, reject_reason, submitted_at, approved_at, done_at, created_at,
  plots ( name, project_id, projects ( id, name ) ),
  plot_sales ( customers ( full_name ) ),
  requester:profiles!transfer_requests_requested_by_fkey ( full_name ),
  approver:profiles!transfer_requests_approved_by_fkey ( full_name )
`

function one<T>(v: Joined<T>): T | null {
  return Array.isArray(v) ? v[0] || null : v
}

function toRow(r: RawRow): TransferRequestRow {
  const plot = one(r.plots)
  const project = plot ? one(plot.projects) : null
  const sale = one(r.plot_sales)
  const customer = sale ? one(sale.customers) : null
  return {
    id: r.id,
    requestNo: r.request_no,
    plotSaleId: r.plot_sale_id,
    plotId: r.plot_id,
    plotName: plot?.name || '',
    projectId: plot?.project_id || '',
    projectName: project?.name || '',
    customerName: customer?.full_name || null,
    status: r.status,
    price: Number(r.price),
    discount: Number(r.discount),
    promotionTotal: Number(r.promotion_total),
    commissionAmount: Number(r.commission_amount),
    notes: r.notes,
    rejectReason: r.reject_reason,
    requestedByName: one(r.requester)?.full_name || null,
    approvedByName: one(r.approver)?.full_name || null,
    submittedAt: r.submitted_at,
    approvedAt: r.approved_at,
    doneAt: r.done_at,
    createdAt: r.created_at,
  }
}

const APPROVER_ROLES = ['admin', 'sales_exec']

export async function getTransferRequests(): Promise<
  { rows: TransferRequestRow[]; canApprove: boolean } | { error: string }
> {
  const { role } = await requireModuleAccess('sales')
  const supabase = await createClient()
  const { data, error } = await supabase.from('transfer_requests').select(SELECT).order('created_at', { ascending: false })
  if (error) return { error: 'โหลดใบขอโอนไม่สำเร็จ' }
  return { rows: ((data || []) as unknown as RawRow[]).map(toRow), canApprove: APPROVER_ROLES.includes(role) }
}

/** Not gated with requireModuleAccess - same reasoning as getPlotSaleDetail
 * (shared plot page; RLS returns nothing for construction viewers). */
export async function getTransferRequestForSale(
  plotSaleId: string
): Promise<{ request: TransferRequestRow | null; canApprove: boolean }> {
  const supabase = await createClient()
  const { role } = await getDashboardSession()
  const { data } = await supabase
    .from('transfer_requests')
    .select(SELECT)
    .eq('plot_sale_id', plotSaleId)
    .order('created_at', { ascending: false })
    .limit(1)
  const row = ((data || []) as unknown as RawRow[])[0]
  return { request: row ? toRow(row) : null, canApprove: APPROVER_ROLES.includes(role) }
}

function refresh() {
  revalidatePath('/dashboard/sales/transfer-requests')
  revalidatePath('/dashboard/projects')
}

export async function createTransferRequest(plotSaleId: string, notes?: string): Promise<{ ok: true; id: string } | { error: string }> {
  await requireModuleAccess('sales')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('transfer_request_create', {
    p_payload: { plot_sale_id: plotSaleId, notes: notes?.trim() || null },
  })
  if (error) return { error: error.message }
  refresh()
  return { ok: true, id: (data as { id: string }).id }
}

export type TransferRequestEdit = {
  price?: number
  discount?: number
  promotionTotal?: number
  commissionAmount?: number
  notes?: string
  /** Re-read price/discount/promotion/commission from the deal's current data. */
  refresh?: boolean
}

export async function updateTransferRequest(id: string, edit: TransferRequestEdit): Promise<{ ok: true } | { error: string }> {
  await requireModuleAccess('sales')
  for (const v of [edit.price, edit.discount, edit.promotionTotal, edit.commissionAmount]) {
    if (v !== undefined && (!Number.isFinite(v) || v < 0)) return { error: 'จำนวนเงินไม่ถูกต้อง' }
  }
  const supabase = await createClient()
  const payload: Record<string, unknown> = { refresh: Boolean(edit.refresh) }
  if (edit.price !== undefined) payload.price = edit.price
  if (edit.discount !== undefined) payload.discount = edit.discount
  if (edit.promotionTotal !== undefined) payload.promotion_total = edit.promotionTotal
  if (edit.commissionAmount !== undefined) payload.commission_amount = edit.commissionAmount
  if (edit.notes !== undefined) payload.notes = edit.notes.trim()
  const { error } = await supabase.rpc('transfer_request_update', { p_id: id, p_payload: payload })
  if (error) return { error: error.message }
  refresh()
  return { ok: true }
}

export async function setTransferRequestStatus(
  id: string,
  status: TransferRequestStatus,
  rejectReason?: string
): Promise<{ ok: true } | { error: string }> {
  await requireModuleAccess('sales')
  if (status === 'rejected' && !rejectReason?.trim()) return { error: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('transfer_request_set_status', {
    p_id: id,
    p_payload: { status, reject_reason: rejectReason?.trim() || null },
  })
  if (error) return { error: error.message }
  refresh()
  return { ok: true }
}
