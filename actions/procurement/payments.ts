'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requireAuthRole } from '@/actions/_shared/user-role'
import { translateError as translatePpError } from '@/lib/errors'
import type { PaymentMethod, PaymentVoucher } from '@/lib/types/procurement'

const SELECT_WITH_RELATIONS = `
  *,
  suppliers (*),
  companies (*),
  payment_voucher_receipts (*, goods_receipts (ri_no, purchase_orders (po_no)))
`

export async function getPaymentVouchers(): Promise<PaymentVoucher[]> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('payment_vouchers')
    .select(SELECT_WITH_RELATIONS)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data as unknown as PaymentVoucher[]) || []
}

export async function getPaymentVoucherById(id: string): Promise<PaymentVoucher | null> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  const { data, error } = await supabase.from('payment_vouchers').select(SELECT_WITH_RELATIONS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as unknown as PaymentVoucher | null
}

export async function createPaymentVoucher(input: {
  supplier_id: string
  company_id: string
  payment_date?: string
  payment_method?: PaymentMethod
  note?: string
  receipt_ids: string[]
}): Promise<{ id: string; pp_no: string; total_amount: number } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can create a payment voucher')
    const supabase = await createClient()

    if (!input.supplier_id) throw new Error('Supplier is required')
    if (!input.company_id) throw new Error('Company is required')
    if (!input.receipt_ids || input.receipt_ids.length === 0) throw new Error('Select at least one receipt to pay')

    const { data, error } = await supabase.rpc('payment_voucher_create', {
      p_payload: {
        supplier_id: input.supplier_id,
        company_id: input.company_id,
        payment_date: input.payment_date || null,
        payment_method: input.payment_method || 'cash',
        note: input.note?.trim() || null,
        receipt_ids: input.receipt_ids,
      },
    })

    if (error) throw new Error(error.message)
    revalidatePath('/dashboard/procurement/receipts')
    revalidatePath('/dashboard/procurement/payments')
    revalidatePath('/dashboard/procurement/orders')
    return data as { id: string; pp_no: string; total_amount: number }
  } catch (error) {
    return { error: translatePpError(error instanceof Error ? error.message : 'Failed to create payment voucher') }
  }
}

export async function voidPaymentVoucher(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can void a payment voucher')
    const supabase = await createClient()
    const { error } = await supabase.rpc('payment_voucher_void', { p_id: id })
    if (error) return { error: translatePpError(error.message) }
    revalidatePath('/dashboard/procurement/receipts')
    revalidatePath('/dashboard/procurement/payments')
    revalidatePath('/dashboard/procurement/orders')
    return { ok: true }
  } catch (error) {
    return { error: translatePpError(error instanceof Error ? error.message : 'ยกเลิกใบสำคัญจ่ายไม่สำเร็จ') }
  }
}
