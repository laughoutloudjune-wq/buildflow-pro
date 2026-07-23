'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck } from 'lucide-react'
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from '@/actions/notifications-actions'

const TYPE_LABEL: Record<NotificationItem['type'], string> = {
  new_request: 'มีคำขอเบิกใหม่รอตรวจสอบ',
  billing_approved: 'คำขอเบิกได้รับการอนุมัติ',
  billing_rejected: 'คำขอเบิกถูกปฏิเสธ',
}

const POLL_INTERVAL_MS = 45_000

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'เมื่อสักครู่'
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`
  const days = Math.floor(hours / 24)
  return `${days} วันที่แล้ว`
}

function notificationSubtitle(item: NotificationItem): string {
  const billing = item.billing
  if (!billing) return ''
  const parts = [
    billing.doc_no != null ? `#${String(billing.doc_no).padStart(4, '0')}` : null,
    billing.type === 'extra_work' ? 'DC' : null,
    billing.contractor_name,
    billing.project_name,
  ].filter(Boolean)
  return parts.join(' • ')
}

export default function NotificationBell({ role }: { role?: string }) {
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const { items: nextItems, unreadCount: nextUnread } = await getMyNotifications()
      setItems(nextItems)
      setUnreadCount(nextUnread)
    } catch {
      // Silent — the bell just keeps its last known state rather than
      // interrupting whatever page the user is actually looking at.
    }
  }, [])

  useEffect(() => {
    void load()
    const interval = setInterval(load, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const linkFor = (item: NotificationItem): string | null => {
    if (!item.billing) return null
    return role === 'foreman' ? '/dashboard/foreman/history' : `/dashboard/billing/${item.billing.id}/review`
  }

  const handleItemClick = async (item: NotificationItem) => {
    setOpen(false)
    if (!item.read_at) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)))
      setUnreadCount((c) => Math.max(0, c - 1))
      void markNotificationRead(item.id)
    }
    const href = linkFor(item)
    if (href) router.push(href)
  }

  const handleMarkAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })))
    setUnreadCount(0)
    await markAllNotificationsRead()
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative hidden rounded-full p-2 text-slate-500 hover:bg-slate-100 sm:block"
        aria-label="การแจ้งเตือน"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-800">การแจ้งเตือน</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                <CheckCheck className="h-3.5 w-3.5" /> อ่านทั้งหมด
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">ไม่มีการแจ้งเตือน</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleItemClick(item)}
                  className={`flex w-full items-start gap-2 border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50 ${
                    !item.read_at ? 'bg-indigo-50/40' : ''
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${!item.read_at ? 'bg-indigo-500' : 'bg-transparent'}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-800">{TYPE_LABEL[item.type]}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">{notificationSubtitle(item)}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(item.created_at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
