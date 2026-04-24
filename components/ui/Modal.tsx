'use client'

import { X } from 'lucide-react'
import { useEffect } from 'react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  panelClassName?: string
  bodyClassName?: string
}

export default function Modal({ isOpen, onClose, title, children, panelClassName, bodyClassName }: ModalProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    const prevHtmlOverflow = document.documentElement.style.overflow
    const prevBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow
      document.body.style.overflow = prevBodyOverflow
    }
  }, [isOpen])

  if (!isOpen) return null

  const panelExtra = panelClassName || 'max-w-md'
  const hasExplicitHeight =
    /\bh-\[/.test(panelExtra) || /\bh-\d/.test(panelExtra) || panelExtra.includes('max-h-')

  const panelClasses = [
    'relative z-10 flex w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-900/5 animate-in fade-in zoom-in-95 duration-200',
    panelExtra,
    hasExplicitHeight ? '' : 'max-h-[min(90dvh,calc(100vh-2rem))]',
  ]
    .filter(Boolean)
    .join(' ')

  const bodyClasses = ['min-h-0 flex-1 overflow-y-auto overscroll-contain', bodyClassName ?? 'p-4'].filter(Boolean).join(' ')

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain"
      aria-modal="true"
      role="dialog"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      {/* Backdrop (non-clickable — avoids losing form input; use X or Esc) */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" aria-hidden />

      <div className="relative flex min-h-full justify-center p-4 sm:p-6">
        <div className={panelClasses}>
          {title ? (
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-4 sm:py-4">
              <h3 id="modal-title" className="min-w-0 truncate text-lg font-semibold text-slate-800">
                {title}
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="ปิด"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
          ) : null}
          <div className={bodyClasses}>{children}</div>
        </div>
      </div>
    </div>
  )
}
