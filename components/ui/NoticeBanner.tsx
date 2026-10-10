'use client'

import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'

export type NoticeTone = 'success' | 'error' | 'warning' | 'info'

const toneClasses: Record<NoticeTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
}

const toneIcons: Record<NoticeTone, typeof Info> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

export default function NoticeBanner({
  tone = 'info',
  message,
  onClose,
}: {
  tone?: NoticeTone
  message: string
  onClose?: () => void
}) {
  const Icon = toneIcons[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-[10px] border px-4 py-3 text-sm ${toneClasses[tone]}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">{message}</p>
        {onClose ? (
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg px-1 text-xs font-semibold opacity-80 hover:opacity-100">
            ปิด
          </button>
        ) : null}
      </div>
    </div>
  )
}
