'use client'

import { Bell, User } from 'lucide-react'

export default function Header({ userEmail }: { userEmail?: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b bg-white px-6 shadow-sm">
      <div className="text-sm text-slate-500">
        // Breadcrumb หรือ Title หน้าปัจจุบัน (อนาคต)
      </div>
      
      <div className="flex items-center gap-4">
        <button className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100">
          <Bell className="h-5 w-5" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
        </button>
        
        <div className="flex items-center gap-3 border-l pl-4">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-medium text-slate-700">ผู้ใช้งาน</div>
            <div className="text-xs text-slate-500">{userEmail || 'Loading...'}</div>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
            <User className="h-5 w-5" />
          </div>
        </div>
      </div>
    </header>
  )
}