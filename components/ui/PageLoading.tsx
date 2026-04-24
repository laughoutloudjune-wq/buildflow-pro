import { Loader2 } from 'lucide-react'

/**
 * Centered loading state for client pages. Uses role="status" for screen readers.
 */
export default function PageLoading({ label = 'กำลังโหลด...' }: { label?: string }) {
  return (
    <div
      className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-500"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-8 w-8 animate-spin text-indigo-500" aria-hidden />
      <p className="text-sm font-medium text-slate-600">{label}</p>
    </div>
  )
}
