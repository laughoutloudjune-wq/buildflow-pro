'use client'

import { ChevronDown, LogOut, User } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const ROLE_LABEL: Record<string, string> = {
  admin: 'ผู้ดูแลระบบ (Admin)',
  pm: 'ผู้จัดการโครงการ (PM)',
  foreman: 'หัวหน้าไซต์ (Foreman)',
  sales_exec: 'หัวหน้าฝ่ายขาย',
  sales: 'ฝ่ายขาย',
  accountant: 'บัญชี',
  procurement: 'จัดซื้อ',
}

/** Header account menu: who is signed in, their role, and sign-out. */
export default function UserMenu({ userEmail, role }: { userEmail?: string; role?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function signOut() {
    setBusy(true)
    await createClient().auth.signOut()
    router.push('/')
    router.refresh()
  }

  const roleLabel = role ? ROLE_LABEL[role] ?? role : null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="เมนูบัญชีผู้ใช้"
        className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 transition hover:bg-slate-100 sm:gap-3"
      >
        <span className="hidden min-w-0 text-right sm:block">
          <span className="block text-sm font-medium text-slate-700">{roleLabel ?? 'ผู้ใช้งาน'}</span>
          <span className="block max-w-[11rem] truncate text-xs text-slate-500">{userEmail || '…'}</span>
        </span>
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 sm:h-10 sm:w-10"
          aria-hidden
        >
          <User className="h-5 w-5" />
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="anim-pop elev-floating absolute right-0 top-full z-50 mt-2 w-64 rounded-xl bg-white p-1.5 ring-1 ring-slate-900/5">
          <div className="border-b border-slate-100 px-3 pb-2 pt-1.5">
            <p className="text-xs text-slate-500">เข้าสู่ระบบด้วย</p>
            <p className="truncate text-sm font-medium text-slate-800" title={userEmail || undefined}>
              {userEmail || '—'}
            </p>
            {roleLabel && <p className="text-xs text-slate-500">{roleLabel}</p>}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            disabled={busy}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {busy ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'}
          </button>
        </div>
      )}
    </div>
  )
}
