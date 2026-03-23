'use client'

export type NoticeTone = 'success' | 'error' | 'warning' | 'info'

const toneClasses: Record<NoticeTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
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
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${toneClasses[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <p>{message}</p>
        {onClose ? (
          <button type="button" onClick={onClose} className="text-xs font-semibold opacity-80 hover:opacity-100">
            Close
          </button>
        ) : null}
      </div>
    </div>
  )
}
