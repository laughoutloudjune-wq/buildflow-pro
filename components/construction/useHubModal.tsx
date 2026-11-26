'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import EmbeddedFrameModal from '@/components/construction/EmbeddedFrameModal'

type Opened = { href: string; title: string; form: boolean }

/**
 * Opens a hub (plot, batch, contractor) or a form in a wide popup over the
 * current page, so the page underneath keeps its filters and scroll position.
 *
 *   const hub = useHubModal()
 *   <Link href={href} onClick={hub.click(href, 'แปลง 103')}>...   // plain click = popup, Cmd/Ctrl-click = new tab
 *   {hub.node}
 *
 * A hub popup stays open while the frame moves between plots, batches and
 * contractors. A form popup (`form: true`) closes when the form finishes and
 * navigates away, then `onDone` runs (default: refresh the page behind it).
 */
export function useHubModal(onDone?: () => void) {
  const router = useRouter()
  const [opened, setOpened] = useState<Opened | null>(null)

  const open = (href: string, title: string, form = false) => setOpened({ href, title, form })
  const click = (href: string, title: string, form = false) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    open(href, title, form)
  }
  const done = () => {
    setOpened(null)
    if (onDone) onDone()
    else router.refresh()
  }

  const node = opened ? (
    <EmbeddedFrameModal
      isOpen
      title={opened.title}
      src={opened.href}
      stayWhile={(p) => (opened.form ? p === opened.href.split('?')[0] : p.startsWith('/dashboard/projects/') || p.startsWith('/dashboard/contractors/'))}
      onClose={() => setOpened(null)}
      onDone={done}
    />
  ) : null

  return { open, click, node }
}
