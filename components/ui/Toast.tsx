'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

export type ToastTone = 'success' | 'error' | 'warning' | 'info'

export type Toast = {
  id: number
  tone: ToastTone
  message: string
  /** Milliseconds before auto-dismiss. 0 keeps the toast until dismissed. */
  duration: number
}

type ToastOptions = { duration?: number }

type ToastApi = {
  show: (tone: ToastTone, message: string, options?: ToastOptions) => number
  success: (message: string, options?: ToastOptions) => number
  error: (message: string, options?: ToastOptions) => number
  warning: (message: string, options?: ToastOptions) => number
  info: (message: string, options?: ToastOptions) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

// Errors stay up longer than confirmations - a failure usually carries a
// reason the user needs time to read, while a success is just an ack.
const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 3500,
  info: 4000,
  warning: 5000,
  error: 6000,
}

const TONE_STYLES: Record<ToastTone, { ring: string; icon: string; Icon: typeof CheckCircle2 }> = {
  success: { ring: 'ring-emerald-200', icon: 'text-emerald-600', Icon: CheckCircle2 },
  error: { ring: 'ring-red-200', icon: 'text-red-600', Icon: XCircle },
  warning: { ring: 'ring-amber-200', icon: 'text-amber-600', Icon: AlertTriangle },
  info: { ring: 'ring-sky-200', icon: 'text-sky-600', Icon: Info },
}

const MAX_VISIBLE = 4

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const show = useCallback(
    (tone: ToastTone, message: string, options?: ToastOptions) => {
      const id = nextId.current++
      const duration = options?.duration ?? DEFAULT_DURATION[tone]

      setToasts((prev) => {
        // Repeating the same message (double-click, retry loop) should refresh
        // the existing toast rather than stack duplicates.
        const withoutDuplicate = prev.filter((t) => t.message !== message)
        return [...withoutDuplicate, { id, tone, message, duration }].slice(-MAX_VISIBLE)
      })

      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration)
        )
      }
      return id
    },
    [dismiss]
  )

  // Clear any pending timers if the provider unmounts mid-flight.
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach(clearTimeout)
      pending.clear()
    }
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message, options) => show('success', message, options),
      error: (message, options) => show('error', message, options),
      warning: (message, options) => show('warning', message, options),
      info: (message, options) => show('info', message, options),
      dismiss,
    }),
    [show, dismiss]
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return createPortal(
    <div
      // aria-live so screen readers announce toasts without moving focus.
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
    >
      {toasts.map((toast) => {
        const { ring, icon, Icon } = TONE_STYLES[toast.tone]
        return (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-sm animate-[toast-in_160ms_ease-out] items-start gap-3 rounded-xl bg-white px-4 py-3 shadow-lg ring-1 ${ring}`}
          >
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${icon}`} />
            <p className="flex-1 text-sm leading-snug text-slate-700">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="ปิดการแจ้งเตือน"
              className="-mr-1 shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>,
    document.body
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>')
  return context
}
