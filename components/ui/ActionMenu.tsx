'use client'

import { MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type ActionMenuItem = {
  label: string
  icon?: React.ReactNode
  onClick?: () => void
  href?: string
  /** Destructive actions are separated and drawn in red. */
  danger?: boolean
  disabled?: boolean
}

/** Row-action menu: one labelled "more" button that opens a list of actions.
 * The list is portalled and fixed-positioned so a scrolling table frame never
 * clips it. Arrow keys move between items, Escape closes and returns focus. */
export default function ActionMenu({
  items,
  label = 'ตัวเลือก',
  align = 'right',
}: {
  items: ActionMenuItem[]
  label?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const place = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = 208
    const left = align === 'right' ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8)
    const below = r.bottom + 4
    const estimatedHeight = items.length * 40 + 12
    const top = below + estimatedHeight > window.innerHeight ? Math.max(8, r.top - estimatedHeight - 4) : below
    setPos({ top, left })
  }, [align, items.length])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      place()
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
    })
    const close = () => setOpen(false)
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, place])

  const onMenuKey = (e: React.KeyboardEvent) => {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])
    const at = nodes.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      nodes[(at + 1) % nodes.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      nodes[(at - 1 + nodes.length) % nodes.length]?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const safe = items.filter((i) => !i.danger)
  const danger = items.filter((i) => i.danger)

  const renderItem = (item: ActionMenuItem) => {
    const cls = `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition focus:outline-none disabled:opacity-40 ${
      item.danger ? 'text-red-700 hover:bg-red-50 focus:bg-red-50' : 'text-slate-700 hover:bg-slate-100 focus:bg-slate-100'
    }`
    const content = (
      <>
        {item.icon ? <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden>{item.icon}</span> : null}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </>
    )
    if (item.href && !item.disabled) {
      return (
        <Link key={item.label} href={item.href} role="menuitem" className={cls} onClick={() => setOpen(false)}>
          {content}
        </Link>
      )
    }
    return (
      <button
        key={item.label}
        type="button"
        role="menuitem"
        disabled={item.disabled}
        className={cls}
        onClick={() => {
          setOpen(false)
          item.onClick?.()
        }}
      >
        {content}
      </button>
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              onKeyDown={onMenuKey}
              style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
              className="anim-pop elev-floating fixed z-[60] w-52 rounded-xl bg-white p-1.5 ring-1 ring-slate-900/5"
            >
              {safe.map(renderItem)}
              {safe.length > 0 && danger.length > 0 ? <div className="my-1 border-t border-slate-100" role="separator" /> : null}
              {danger.map(renderItem)}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
