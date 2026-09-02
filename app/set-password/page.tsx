'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'

// Where both invite-link formats land: /auth/confirm forwards here after a
// server-side token_hash verify, and the older hash-fragment link
// (#access_token=...) is auto-detected by the browser Supabase client the
// moment this page's script runs - detectSessionInUrl is on by default (see
// lib/supabase/client.ts), so either way there's a real session by the time
// getSession() below resolves, or there just isn't a valid invite at all.
export default function SetPasswordPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(Boolean(session))
      setChecking(false)
    })
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
      return
    }
    if (password !== confirm) {
      setError('รหัสผ่านไม่ตรงกัน')
      return
    }

    setSubmitting(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSubmitting(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-5 rounded-2xl border border-slate-200/70 bg-white/90 p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_48px_-16px_rgba(0,0,0,0.12)] backdrop-blur-xl"
      >
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[14px] bg-indigo-600 shadow-[0_4px_12px_-2px_rgba(79,70,229,0.5)]">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">ตั้งรหัสผ่าน</h1>
          <p className="mt-1 text-sm text-slate-500">กำหนดรหัสผ่านเพื่อเริ่มใช้งาน BuildFlow Pro</p>
        </div>

        {checking ? (
          <p className="text-center text-sm text-slate-500">กำลังตรวจสอบลิงก์...</p>
        ) : !hasSession ? (
          <div className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            ลิงก์นี้ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาติดต่อผู้ดูแลระบบเพื่อขอลิงก์เชิญใหม่
          </div>
        ) : (
          <>
            {error ? <div className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-slate-600">
                รหัสผ่านใหม่
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="อย่างน้อย 6 ตัวอักษร"
                className="w-full"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirm" className="text-sm font-medium text-slate-600">
                ยืนยันรหัสผ่าน
              </label>
              <input
                id="confirm"
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="กรอกรหัสผ่านอีกครั้ง"
                className="w-full"
              />
            </div>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'กำลังบันทึก...' : 'ตั้งรหัสผ่านและเข้าใช้งาน'}
            </Button>
          </>
        )}
      </form>
    </div>
  )
}
