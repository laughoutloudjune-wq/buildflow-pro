'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// [UPDATED] บันทึกการจ่ายเงิน และส่งข้อมูลกลับ (Return Data)
export async function createPayment(formData: FormData, projectId: string, plotId: string) {
  const supabase = await createClient()
  
  const job_assignment_id = formData.get('job_assignment_id') as string
  const amount = formData.get('amount') as string
  const note = formData.get('note') as string
  const payment_date = formData.get('payment_date') as string

  if (!amount || !job_assignment_id) return null

  // เปลี่ยนจาก insert เฉยๆ เป็น select().single() เพื่อดึงข้อมูลที่เพิ่งสร้างกลับมา
  const { data, error } = await supabase.from('payments').insert([{
    job_assignment_id,
    amount: parseFloat(amount),
    note,
    payment_date: payment_date || new Date().toISOString()
  }]).select().single()

  if (error) throw new Error(error.message)
  
  // revalidatePath เอาไว้ update ข้อมูลหลังบ้าน แต่หน้าบ้านเราจะใช้ State อัปเดตเอง
  revalidatePath(`/dashboard/projects/${projectId}/${plotId}`)
  
  return data // ✅ ส่งข้อมูลกลับไปให้หน้าเว็บ
}

// ลบประวัติการจ่ายเงิน
export async function deletePayment(id: string, projectId: string, plotId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('payments').delete().match({ id })
  
  if (error) throw new Error(error.message)
  revalidatePath(`/dashboard/projects/${projectId}/${plotId}`)
}