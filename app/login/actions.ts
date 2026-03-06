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

export async function signup(formData: FormData) {
  const supabase = await createClient()

  const fullName = String(formData.get('full_name') || '').trim()
  const email = String(formData.get('email') || '').trim()
  const password = String(formData.get('password') || '')

  if (!email || !password) {
    redirect('/register?error=กรุณากรอกข้อมูลให้ครบ')
  }

  if (password.length < 6) {
    redirect('/register?error=รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName || email,
      },
    },
  })

  if (error) {
    redirect(`/register?error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/', 'layout')
  redirect('/login?success=ลงทะเบียนสำเร็จ กรุณาเข้าสู่ระบบ')
}
