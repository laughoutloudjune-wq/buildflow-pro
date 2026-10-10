'use client'

import { X } from 'lucide-react'
import { useEffect, useId, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

const subscribeNever = () => () => {}

/** Open modals, oldest first. Only the topmost one reacts to Escape and Tab, so
 * a stacked modal closes one layer at a time and focus stays in the front one. */
const modalStack: symbol[] = []

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  panelClassName?: string
  bodyClassName?: string
  /** Rendered as its own shrink-0 flex row below the scrollable body, not
   * inside it - for an action bar that must stay visible regardless of
   * scroll position. A `position: sticky`/`fixed` bar placed inside
   * `children` can't do this reliably: sticky only pins once its own normal
   * flow position is scrolled near, and fixed escapes the panel entirely to
   * the browser viewport. Plain flex layout has neither problem. */
  footer?: React.ReactNode
}

export default function Modal({ isOpen, onClose, title, children, panelClassName, bodyClassName, footer }: ModalProps) {
  // Rendered through a portal straight to <body> - a modal nested inside
  // another component's tree (e.g. a plot's quick-view opened from inside
  // the site-plan preview modal) would otherwise inherit whatever stacking
  // context its ancestors create. In particular this Modal's own panel
  // carries `anim-modal` (globals.css), an animation that applies a
  // `transform` - and ANY ancestor with a transform, even `scale(1)` at
  // rest, establishes a new containing block for `position: fixed`
  // descendants. A nested Modal's "fixed inset-0" would then cover the
  // OUTER modal's panel instead of the real viewport, breaking it exactly
  // the way plain CSS nesting can't fix. Portalling to <body> sidesteps the
  // whole class of bug regardless of where in the tree Modal is used.
  // False on the server and on the client's first render (so hydration
  // matches), true after - the standard way to gate a client-only portal
  // without a manual effect+setState pair, which the same class of hook
  // lint that this whole file is being careful about would flag as an
  // avoidable extra render.
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  )

  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Latest onClose without re-registering the key handler on every render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  const active = isOpen && mounted

  // Escape (topmost modal only), Tab containment, focus in on open, focus
  // back to whatever opened the modal on close.
  useEffect(() => {
    if (!active) return
    const id = Symbol('modal')
    modalStack.push(id)
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) {
      // Prefer a form field over the close button; fall back to the panel itself.
      const first =
        panel.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])') ??
        panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel).focus()
    }

    const handleKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== id) return
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
      if (items.length === 0) {
        e.preventDefault()
        panelRef.current.focus()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const current = document.activeElement
      if (e.shiftKey && (current === firstEl || !panelRef.current.contains(current))) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && (current === lastEl || !panelRef.current.contains(current))) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      const at = modalStack.indexOf(id)
      if (at >= 0) modalStack.splice(at, 1)
      if (opener && opener.isConnected) opener.focus()
    }
  }, [active])

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

  if (!isOpen || !mounted) return null

  const panelExtra = panelClassName || 'max-w-md'
  const hasExplicitHeight =
    /\bh-\[/.test(panelExtra) || /\bh-\d/.test(panelExtra) || panelExtra.includes('max-h-')

  const panelClasses = [
    'relative z-10 flex w-full flex-col overflow-hidden rounded-2xl bg-white elev-modal ring-1 ring-slate-900/5 anim-modal focus:outline-none',
    panelExtra,
    hasExplicitHeight ? '' : 'max-h-[min(90dvh,calc(100vh-2rem))]',
  ]
    .filter(Boolean)
    .join(' ')

  const bodyClasses = ['min-h-0 flex-1 overflow-y-auto overscroll-contain', bodyClassName ?? 'p-4'].filter(Boolean).join(' ')

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain"
      aria-modal="true"
      role="dialog"
      aria-labelledby={title ? titleId : undefined}
    >
      {/* Backdrop (non-clickable — avoids losing form input; use X or Esc) */}
      <div className="fixed inset-0 modal-backdrop anim-backdrop" aria-hidden />

      <div className="relative flex min-h-full items-center justify-center p-4 sm:p-6">
        <div ref={panelRef} tabIndex={-1} className={panelClasses}>
          {title ? (
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white px-4 py-3 sm:px-4 sm:py-4">
              <h3 id={titleId} className="min-w-0 truncate text-lg font-semibold text-slate-800">
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
          {footer ? (
            <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-3 sm:px-6">{footer}</div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}
