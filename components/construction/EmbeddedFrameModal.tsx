'use client'

import { useEffect, useRef, useState } from 'react'
import Modal from '@/components/ui/Modal'

/**
 * Opens an existing full page (a form or the bill review) inside a wide modal,
 * so the user stays on the hub they are looking at. The page runs exactly as
 * it does on its own - same validation, same server actions - with the dashboard
 * chrome hidden (DashboardShell hides it inside a frame).
 *
 * The page finishes by navigating somewhere else (a list, the next bill). We
 * watch the frame's path; once it leaves `stayWhile`, the modal closes and
 * onDone runs so the hub can refresh. Client-side navigation inside the frame
 * does not fire a load event, so this polls the (same-origin) path.
 */
export default function EmbeddedFrameModal({
  isOpen,
  title,
  src,
  stayWhile,
  onClose,
  onDone,
}: {
  isOpen: boolean
  title: string
  src: string
  /** The frame stays open while its path matches this. */
  stayWhile: (pathname: string) => boolean
  onClose: () => void
  onDone: () => void
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [loading, setLoading] = useState(true)
  const doneRef = useRef(onDone)
  const stayRef = useRef(stayWhile)
  useEffect(() => {
    doneRef.current = onDone
    stayRef.current = stayWhile
  })

  useEffect(() => {
    if (!isOpen) return
    const timer = setInterval(() => {
      try {
        const path = ref.current?.contentWindow?.location.pathname
        if (path && path !== 'blank' && path !== '/' && !stayRef.current(path)) {
          clearInterval(timer)
          doneRef.current()
        }
      } catch {
        // Cross-origin or not ready yet: keep waiting.
      }
    }, 500)
    return () => clearInterval(timer)
  }, [isOpen, src])

  if (!isOpen) return null
  return (
    <Modal isOpen onClose={onClose} title={title} panelClassName="w-full max-w-[min(1200px,96vw)] h-[90dvh]" bodyClassName="p-0">
      <div className="relative h-full min-h-[24rem]">
        {loading && <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">กำลังโหลด...</p>}
        <iframe ref={ref} src={src} title={title} onLoad={() => setLoading(false)} className="h-full w-full border-0" />
      </div>
    </Modal>
  )
}
