'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, MapPinOff, Minus, Plus, RotateCcw } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { getProjectById } from '@/actions/project-actions'

const MIN_ZOOM = 50
const MAX_ZOOM = 400
const ZOOM_STEP = 25

/** Just the uploaded site-plan picture for a project, opened from the
 * header's quick switcher - no markers, no click-through, no editing.
 * Zoom changes the image's actual rendered width (not a CSS transform), so
 * the scroll container's overflow-auto naturally grows real scrollbars to
 * pan around once it's bigger than the panel - a transform-based zoom
 * wouldn't do that, since transforms don't affect layout size. Dragging
 * just moves those same scroll offsets directly, rather than a separate
 * transform-based pan, so the two never fight over what "position" means. */
export default function ProjectSitePlanModal({
  projectId,
  onClose,
}: {
  projectId: string | null
  onClose: () => void
}) {
  const [project, setProject] = useState<Awaited<ReturnType<typeof getProjectById>> | null>(null)
  const [zoom, setZoom] = useState(100)
  const [isDragging, setIsDragging] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isLoading = Boolean(projectId) && project?.id !== projectId

  // Resets zoom back to 100% whenever a different project opens. Adjusted
  // during render (React's documented pattern for this) rather than in an
  // effect, which would need an extra render pass and trips
  // react-hooks/set-state-in-effect.
  const [prevProjectId, setPrevProjectId] = useState(projectId)
  if (projectId !== prevProjectId) {
    setPrevProjectId(projectId)
    setZoom(100)
  }

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    getProjectById(projectId).then((res) => {
      if (!cancelled) setProject(res)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current
    if (!el) return
    const startX = e.clientX
    const startY = e.clientY
    const startScrollLeft = el.scrollLeft
    const startScrollTop = el.scrollTop
    setIsDragging(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)

    function onMove(ev: PointerEvent) {
      if (!el) return
      el.scrollLeft = startScrollLeft - (ev.clientX - startX)
      el.scrollTop = startScrollTop - (ev.clientY - startY)
    }
    function onUp() {
      setIsDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <Modal
      isOpen={Boolean(projectId)}
      onClose={onClose}
      title={project?.name || 'แผนผังโครงการ'}
      panelClassName="max-w-5xl h-[90dvh]"
      bodyClassName="p-0"
      footer={
        project?.site_plan_url ? (
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
              disabled={zoom <= MIN_ZOOM}
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="ซูมออก"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-12 text-center text-sm text-slate-600">{zoom}%</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
              disabled={zoom >= MAX_ZOOM}
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="ซูมเข้า"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(100)}
              disabled={zoom === 100}
              className="ml-2 flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" /> รีเซ็ต
            </button>
          </div>
        ) : undefined
      }
    >
      {isLoading || !project ? (
        <div className="flex h-full items-center justify-center text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : project.site_plan_url ? (
        <div
          ref={scrollRef}
          onPointerDown={handlePointerDown}
          className={`h-full w-full overflow-auto p-4 sm:p-6 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={project.site_plan_url}
            alt={`แผนผัง ${project.name}`}
            draggable={false}
            className="select-none rounded-lg"
            style={{ width: `${zoom}%`, maxWidth: 'none' }}
          />
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
          <MapPinOff className="h-8 w-8" />
          <p>โครงการนี้ยังไม่มีแผนผัง</p>
        </div>
      )}
    </Modal>
  )
}
