'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

export type SearchableSelectOption = {
  value: string
  label: string
  /** Extra text shown under the label and included in the search match (e.g. project name). */
  sublabel?: string
}

type Props = {
  options: SearchableSelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

/** A `<select>` replacement that filters by typing instead of scrolling a long
 * list - meant for option lists that can grow into the hundreds (materials,
 * house models across many projects, etc).
 *
 * The option panel renders through a portal with `position: fixed`, anchored
 * to the trigger button's on-screen position, so it floats above the page
 * instead of being clipped by a scrollable ancestor (e.g. a Modal body) -
 * without this, opening the dropdown near the top of a scrolling container
 * would force that container itself to scroll just to reveal the options. */
export default function SearchableSelect({ options, value, onChange, placeholder, disabled, className }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value) || null

  function updateCoords() {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width })
  }

  function openDropdown() {
    updateCoords()
    setIsOpen(true)
  }

  useEffect(() => {
    if (!isOpen) return

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setIsOpen(false)
      setQuery('')
    }
    function handleReposition() {
      updateCoords()
    }

    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('scroll', handleReposition, true)
    window.addEventListener('resize', handleReposition)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('scroll', handleReposition, true)
      window.removeEventListener('resize', handleReposition)
    }
  }, [isOpen])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sublabel || '').toLowerCase().includes(q)
    )
  }, [options, query])

  return (
    <div ref={containerRef} className={`relative ${className || ''}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => (isOpen ? setIsOpen(false) : openDropdown())}
        className="flex w-full items-center justify-between rounded border border-gray-300 bg-white px-2 py-1.5 text-left text-sm disabled:bg-slate-50 disabled:text-slate-400"
      >
        <span className={selected ? 'truncate text-slate-800' : 'truncate text-slate-400'}>
          {selected ? selected.label : placeholder || '-- เลือก --'}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {isOpen && coords &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width }}
            className="z-50 rounded-md border border-slate-200 bg-white shadow-lg"
          >
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="พิมพ์เพื่อค้นหา..."
              className="w-full rounded-t-md border-b border-slate-200 px-2 py-1.5 text-sm outline-none"
            />
            <div className="max-h-56 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-2 py-2 text-sm text-slate-400">ไม่พบรายการ</div>
              ) : (
                filtered.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange(option.value)
                      setIsOpen(false)
                      setQuery('')
                    }}
                    className={`block w-full px-2 py-1.5 text-left text-sm hover:bg-indigo-50 ${
                      option.value === value ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-700'
                    }`}
                  >
                    <div className="truncate">{option.label}</div>
                    {option.sublabel && <div className="truncate text-xs text-slate-400">{option.sublabel}</div>}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
