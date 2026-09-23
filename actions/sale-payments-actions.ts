'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireModuleAccess } from '@/lib/auth/route-access'

export type SalePaymentKind = 'booking' | 'contract' | 'down' | 'transfer' | 'extra'

export type SalePaymentRow = {
  id: string
  plotSaleId: string
  kind: SalePaymentKind
  installmentNo: number | null
  dueDate: string | null
  amountDue: number
  paidAt: string | null
  amountPaid: number | null
  method: string | null
  receiptNo: string | null
  note: string | null
  createdAt: string
  voidedAt: string | null
  voidReason: string | null
}

function toRow(r: Record<string, unknown>): SalePaymentRow {
  return {
    id: r.id as string,
    plotSaleId: r.plot_sale_id as string,
    kind: r.kind as SalePaymentKind,
    installmentNo: r.installment_no as number | null,
    dueDate: r.due_date as string | null,
    amountDue: Number(r.amount_due) || 0,
    paidAt: r.paid_at as string | null,
    amountPaid: r.amount_paid == null ? null : Number(r.amount_paid),
    method: r.method as string | null,
    receiptNo: r.receipt_no as string | null,
    note: r.note as string | null,
    createdAt: r.created_at as string,
    voidedAt: r.voided_at as string | null,
    voidReason: r.void_reason as string | null,
  }
}

export async function getSalePaymentsForSale(plotSaleId: string): Promise<SalePaymentRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sale_payments')
    .select('*')
    .eq('plot_sale_id', plotSaleId)
    .order('installment_no', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(toRow)
}

/**
 * RC-YYYYMMDD###. Delegates to sale_receipt_next_number() rather than doing
 * the counter increment via the JS client - .upsert() can't express
 * `counter = counter + 1` atomically (it replaces the conflicting row with
 * whatever literal value is passed, which would reset every receipt back to
 * #1 instead of incrementing), so this needs the same SQL-side
 * `on conflict do update set counter = counter + 1 returning counter`
 * every other document counter in this app already uses.
 */
async function nextReceiptNo(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { data, error } = await supabase.rpc('sale_receipt_next_number')
  if (error || !data) throw new Error(error?.message || 'สร้างเลขที่ใบเสร็จไม่สำเร็จ')
  return data as string
}

export type CreateSalePaymentResult = { success: true; id: string } | { success: false; error: string }

export async function createSalePayment(formData: FormData): Promise<CreateSalePaymentResult> {
  await requireModuleAccess('sales')
  const supabase = await createClient()

  const plotSaleId = String(formData.get('plot_sale_id') || '')
  const kind = String(formData.get('kind') || '') as SalePaymentKind
  const amountDue = Number(formData.get('amount_due') || 0)
  const dueDate = String(formData.get('due_date') || '').trim() || null
  const note = String(formData.get('note') || '').trim() || null
  const markPaidNow = formData.get('mark_paid_now') === 'on'
  const method = String(formData.get('method') || '').trim() || null
  const amountPaidRaw = String(formData.get('amount_paid') || '').trim()

  if (!plotSaleId || !kind) return { success: false, error: 'ข้อมูลไม่ครบ' }

  const insert: Record<string, unknown> = {
    plot_sale_id: plotSaleId,
    kind,
    amount_due: amountDue,
    due_date: dueDate,
    note,
  }

  if (markPaidNow) {
    insert.paid_at = new Date().toISOString().slice(0, 10)
    insert.amount_paid = amountPaidRaw ? Number(amountPaidRaw) : amountDue
    insert.method = method
    insert.receipt_no = await nextReceiptNo(supabase)
  }

  const { data, error } = await supabase.from('sale_payments').insert(insert).select('id').single()
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/projects')
  revalidatePath('/dashboard/sales')
  return { success: true, id: data.id }
}

export type MarkPaidResult = { success: true; receiptNo: string } | { success: false; error: string }

export async function markSalePaymentPaid(paymentId: string, formData: FormData): Promise<MarkPaidResult> {
  await requireModuleAccess('sales')
  const supabase = await createClient()

  const method = String(formData.get('method') || '').trim() || null
  const amountPaidRaw = String(formData.get('amount_paid') || '').trim()
  const paidAt = String(formData.get('paid_at') || '').trim() || new Date().toISOString().slice(0, 10)

  const { data: existing, error: fetchError } = await supabase
    .from('sale_payments')
    .select('amount_due, receipt_no, paid_at, voided_at')
    .eq('id', paymentId)
    .maybeSingle()
  if (fetchError || !existing) return { success: false, error: fetchError?.message || 'ไม่พบรายการ' }
  if (existing.voided_at) return { success: false, error: 'รายการนี้ถูกยกเลิกไปแล้ว' }
  if (existing.paid_at) return { success: false, error: 'รายการนี้ชำระแล้ว ไม่สามารถบันทึกการชำระซ้ำได้' }

  const receiptNo = existing.receipt_no || (await nextReceiptNo(supabase))

  const { error } = await supabase
    .from('sale_payments')
    .update({
      paid_at: paidAt,
      amount_paid: amountPaidRaw ? Number(amountPaidRaw) : existing.amount_due,
      method,
      receipt_no: receiptNo,
    })
    .eq('id', paymentId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/projects')
  revalidatePath('/dashboard/sales')
  return { success: true, receiptNo }
}

export type GenerateScheduleResult = { success: true; count: number } | { success: false; error: string }

/**
 * Splits plot_sales.down_total into N monthly installments from contract_at
 * (§7.7 - "split ยอดผ่อนดาวน์ into N monthly งวด from the contract date").
 * Due dates are contract_at + 1..N months (first installment due one month
 * after the contract, not on the contract date itself - the conventional
 * shape for a down-payment plan). Amounts are floor-divided with the
 * rounding remainder absorbed into the LAST installment, so the schedule
 * always sums to exactly down_total, never a few satang short.
 *
 * Refuses if a schedule already exists for this deal rather than silently
 * duplicating or overwriting - regenerating means clearing the existing
 * unpaid installments first, a deliberate separate action.
 */
export async function generateDownPaymentSchedule(plotSaleId: string, installmentCount: number): Promise<GenerateScheduleResult> {
  await requireModuleAccess('sales')
  if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 60) {
    return { success: false, error: 'จำนวนงวดต้องเป็นจำนวนเต็ม 1-60' }
  }

  const supabase = await createClient()
  const { data: sale, error: saleError } = await supabase
    .from('plot_sales')
    .select('down_total, contract_at')
    .eq('id', plotSaleId)
    .maybeSingle()
  if (saleError || !sale) return { success: false, error: saleError?.message || 'ไม่พบข้อมูลการขาย' }
  if (!sale.down_total || sale.down_total <= 0) return { success: false, error: 'กรุณาระบุยอดผ่อนดาวน์รวมก่อน' }
  if (!sale.contract_at) return { success: false, error: 'กรุณาระบุวันทำสัญญาก่อน' }

  const { count: existingCount } = await supabase
    .from('sale_payments')
    .select('id', { count: 'exact', head: true })
    .eq('plot_sale_id', plotSaleId)
    .eq('kind', 'down')
  if (existingCount && existingCount > 0) {
    return { success: false, error: 'มีตารางผ่อนดาวน์อยู่แล้ว - ลบรายการเดิมก่อนถ้าต้องการสร้างใหม่' }
  }

  const total = sale.down_total
  const base = Math.floor((total / installmentCount) * 100) / 100
  const contractDate = new Date(sale.contract_at)

  const rows = Array.from({ length: installmentCount }, (_, i) => {
    const n = i + 1
    const due = new Date(contractDate)
    due.setMonth(due.getMonth() + n)
    const isLast = n === installmentCount
    const amount = isLast ? Math.round((total - base * (installmentCount - 1)) * 100) / 100 : base
    return {
      plot_sale_id: plotSaleId,
      kind: 'down' as const,
      installment_no: n,
      due_date: due.toISOString().slice(0, 10),
      amount_due: amount,
    }
  })

  const { error } = await supabase.from('sale_payments').insert(rows)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/projects')
  revalidatePath('/dashboard/sales')
  return { success: true, count: rows.length }
}

export type DeletePaymentResult = { success: true } | { success: false; error: string }

export async function deleteSalePayment(paymentId: string): Promise<DeletePaymentResult> {
  await requireModuleAccess('sales')
  const supabase = await createClient()

  const { data: existing, error: fetchError } = await supabase
    .from('sale_payments')
    .select('receipt_no')
    .eq('id', paymentId)
    .maybeSingle()
  if (fetchError || !existing) return { success: false, error: fetchError?.message || 'ไม่พบรายการ' }
  if (existing.receipt_no) {
    return { success: false, error: 'รายการนี้ออกใบเสร็จแล้ว ลบไม่ได้ กรุณาใช้การยกเลิกใบเสร็จแทน' }
  }

  const { error } = await supabase.from('sale_payments').delete().eq('id', paymentId)
  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/projects')
  revalidatePath('/dashboard/sales')
  return { success: true }
}

export type VoidPaymentResult = { success: true } | { success: false; error: string }

/** Keeps the row and its receipt number so the numbering sequence and the
 * paid history stay intact (an audit/tax requirement) - only marks it
 * cancelled instead of deleting or re-marking it, unlike deleteSalePayment/
 * markSalePaymentPaid above (H-07). */
export async function voidSalePayment(paymentId: string, reason: string): Promise<VoidPaymentResult> {
  await requireModuleAccess('sales')
  const supabase = await createClient()
  const user = (await supabase.auth.getUser()).data.user

  const trimmedReason = reason.trim()
  if (!trimmedReason) return { success: false, error: 'กรุณาระบุเหตุผลที่ยกเลิก' }

  const { data: existing, error: fetchError } = await supabase
    .from('sale_payments')
    .select('receipt_no, voided_at')
    .eq('id', paymentId)
    .maybeSingle()
  if (fetchError || !existing) return { success: false, error: fetchError?.message || 'ไม่พบรายการ' }
  if (!existing.receipt_no) return { success: false, error: 'รายการนี้ยังไม่ได้ออกใบเสร็จ' }
  if (existing.voided_at) return { success: false, error: 'รายการนี้ถูกยกเลิกไปแล้ว' }

  const { error } = await supabase
    .from('sale_payments')
    .update({
      voided_at: new Date().toISOString(),
      voided_by: user?.id ?? null,
      void_reason: trimmedReason,
    })
    .eq('id', paymentId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/dashboard/projects')
  revalidatePath('/dashboard/sales')
  return { success: true }
}

export type OverdueSalePayment = SalePaymentRow & {
  plotId: string
  plotName: string
  projectId: string
  projectName: string
  customerName: string | null
  daysOverdue: number
}

export async function getOverdueSalePayments(): Promise<OverdueSalePayment[]> {
  const supabase = await createClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('sale_payments')
    .select(`
      *,
      plot_sales ( plot_id, plots ( name, project_id, projects ( name ) ), customers ( full_name ) )
    `)
    .is('paid_at', null)
    .is('voided_at', null)
    .lt('due_date', today)
    .order('due_date', { ascending: true })

  if (error) throw new Error(error.message)

  return (data || []).map((r) => {
    const sale = r.plot_sales as unknown as {
      plot_id: string
      plots: { name: string; project_id: string; projects: { name: string } | null } | null
      customers: { full_name: string } | null
    } | null
    const days = Math.floor((Date.now() - new Date(r.due_date as string).getTime()) / (1000 * 60 * 60 * 24))
    return {
      ...toRow(r),
      plotId: sale?.plot_id || '',
      plotName: sale?.plots?.name || '',
      projectId: sale?.plots?.project_id || '',
      projectName: sale?.plots?.projects?.name || '',
      customerName: sale?.customers?.full_name || null,
      daysOverdue: days,
    }
  })
}

export type SaleReceiptData = {
  payment: SalePaymentRow
  statusLabel: string
  plotName: string
  projectName: string
  customerName: string | null
  customerPhone: string | null
  customerAddress: string | null
}

/** Not gated - same reasoning as getPlotSaleDetail/getWorkRequestsForPlot:
 * RLS (admin/pm/sales) is the real authority, and the print route is
 * already unreachable without a login by virtue of living under
 * /dashboard. */
export async function getSalePaymentForReceipt(paymentId: string): Promise<SaleReceiptData | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sale_payments')
    .select(`
      *,
      plot_sales (
        status_code,
        sale_statuses ( label ),
        plots ( name, project_id, projects ( name ) ),
        customers ( full_name, phone, address )
      )
    `)
    .eq('id', paymentId)
    .maybeSingle()

  if (error || !data) return null

  const sale = data.plot_sales as unknown as {
    status_code: string
    sale_statuses: { label: string } | null
    plots: { name: string; projects: { name: string } | null } | null
    customers: { full_name: string; phone: string | null; address: string | null } | null
  } | null

  return {
    payment: toRow(data),
    statusLabel: sale?.sale_statuses?.label || sale?.status_code || '',
    plotName: sale?.plots?.name || '',
    projectName: sale?.plots?.projects?.name || '',
    customerName: sale?.customers?.full_name || null,
    customerPhone: sale?.customers?.phone || null,
    customerAddress: sale?.customers?.address || null,
  }
}
