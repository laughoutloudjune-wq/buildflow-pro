'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function login(formData: FormData) {
  const supabase = await createClient()

  const email = String(formData.get('email') || '').trim()
  const password = String(formData.get('password') || '')

  if (!email || !password) {
    redirect('/login?error=กรุณากรอกอีเมลและรหัสผ่าน')
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    redirect('/login?error=อีเมลหรือรหัสผ่านไม่ถูกต้อง')
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
