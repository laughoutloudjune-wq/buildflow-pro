'use client'

import { useEffect, useRef, useState } from 'react'
import { Map, Search } from 'lucide-react'
import { getProjects } from '@/actions/project-actions'
import ProjectSitePlanModal from '@/components/layout/ProjectSitePlanModal'

type ProjectOption = { id: string; name: string; location: string | null; status: string }

/** A quick way to see a project's site plan without going through the
 * sidebar's "โครงการ" list and picking a card - projects fetch lazily on
 * first open rather than on every page load, since most pages never open
 * this. Picking one opens a read-only picture of that project's plan
 * (ProjectSitePlanModal), not a navigation to its full management page. */
export default function ProjectQuickSwitcher() {
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectOption[] | null>(null)
  const [search, setSearch] = useState('')
  const [viewProjectId, setViewProjectId] = useState<string | null>(null)
  // Derived rather than a separate state var set synchronously in the
  // effect below (that pattern trips react-hooks/set-state-in-effect) -
  // still loading exactly when the panel is open but no data has arrived.
  const isLoading = open && projects === null

  useEffect(() => {
    if (!open || projects !== null) return
    getProjects({ onlyProjectsPage: true })
      .then((data) => setProjects((data as ProjectOption[]) || []))
      .catch(() => setProjects([]))
  }, [open, projects])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const q = search.trim().toLowerCase()
  const filtered = (projects || []).filter(
    (p) => !q || p.name.toLowerCase().includes(q) || (p.location || '').toLowerCase().includes(q)
  )
  const ongoing = filtered.filter((p) => p.status !== 'completed')
  const closed = filtered.filter((p) => p.status === 'completed')

  function openPlan(id: string) {
    setOpen(false)
    setSearch('')
    setViewProjectId(id)
  }

  function renderGroup(label: string, list: ProjectOption[]) {
    if (list.length === 0) return null
    return (
      <div>
        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        {list.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => openPlan(p.id)}
            className="flex w-full flex-col items-start px-3 py-2 text-left transition hover:bg-slate-50"
          >
            <span className="text-sm font-medium text-slate-800">{p.name}</span>
            <span className="text-xs text-slate-400">{p.location || 'ไม่ระบุทำเล'}</span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 sm:flex"
        title="ดูแผนผังของแต่ละโครงการ"
      >
        <Map className="h-4 w-4" aria-hidden />
        แผนผัง
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-72 rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาโครงการ..."
                className="w-full pl-8 text-sm"
              />
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto py-1">
            {isLoading ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">กำลังโหลด...</p>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">ไม่พบโครงการ</p>
            ) : (
              <>
                {renderGroup('กำลังดำเนินการ', ongoing)}
                {renderGroup('ปิดโครงการแล้ว', closed)}
              </>
            )}
          </div>
        </div>
      )}

      <ProjectSitePlanModal projectId={viewProjectId} onClose={() => setViewProjectId(null)} />
    </div>
  )
}
