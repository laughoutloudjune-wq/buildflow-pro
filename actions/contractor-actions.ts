'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ดึงรายชื่อผู้รับเหมาทั้งหมด (พร้อมชื่อประเภทช่าง)
export async function getContractors() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contractors')
    .select(`
      *,
      contractor_types (name)
    `)
    .order('created_at', { ascending: false })
  
  if (error) throw new Error(error.message)

  const { data: assignments, error: assignmentsError } = await supabase
    .from('job_assignments')
    .select(`
      contractor_id,
      payments (amount)
    `)
    .not('contractor_id', 'is', null)

  if (assignmentsError) throw new Error(assignmentsError.message)

  const paidByContractor = new Map<string, number>()

  for (const assignment of assignments || []) {
    const contractorId = assignment.contractor_id as string | null
    if (!contractorId) continue

    const totalForAssignment = (assignment.payments || []).reduce(
      (sum: number, payment: { amount: number | null }) => sum + (payment.amount || 0),
      0
    )
    paidByContractor.set(contractorId, (paidByContractor.get(contractorId) || 0) + totalForAssignment)
  }

  return (data || []).map((contractor) => ({
    ...contractor,
    total_paid: paidByContractor.get(contractor.id) || 0,
  }))
}

// เพิ่มผู้รับเหมาใหม่
export async function createContractor(formData: FormData) {
  const supabase = await createClient()
  
  const name = formData.get('name') as string
  const type_id = formData.get('type_id') as string
  const phone = formData.get('phone') as string
  const bank_account = formData.get('bank_account') as string
  const tax_id = formData.get('tax_id') as string

  if (!name || !type_id) return

  const { error } = await supabase
    .from('contractors')
    .insert([{ 
      name, 
      type_id: parseInt(type_id), 
      phone, 
      bank_account,
      tax_id 
    }])

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/contractors')
}

// ลบผู้รับเหมา
export async function deleteContractor(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('contractors').delete().match({ id })
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/contractors')
}

// อัปเดตผู้รับเหมา
export async function updateContractor(id: string, formData: FormData) {
  const supabase = await createClient()

  const name = formData.get('name') as string
  const type_id = formData.get('type_id') as string
  const phone = formData.get('phone') as string
  const bank_account = formData.get('bank_account') as string
  const tax_id = formData.get('tax_id') as string

  if (!name || !type_id) return

  const { error } = await supabase
    .from('contractors')
    .update({
      name,
      type_id: parseInt(type_id),
      phone,
      bank_account,
      tax_id
    })
    .match({ id })

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/contractors')
}
