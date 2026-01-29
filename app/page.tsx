import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function Home() {
  // สร้าง Supabase Client ฝั่ง Server
  const supabase = await createClient()

  // เช็คว่ามี User ล็อกอินอยู่ไหม
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    // ถ้ามี -> ไป Dashboard
    redirect('/dashboard')
  } else {
    // ถ้าไม่มี -> ไป Login
    redirect('/login')
  }
  
  // (โค้ดตรงนี้จะไม่ถูกรัน เพราะโดน redirect ไปก่อนแล้ว)
  return null
}