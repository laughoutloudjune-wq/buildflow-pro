'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MapPinOff, Move, Upload, X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { updatePlotMapPosition, uploadSitePlan } from '@/actions/sales-actions'
import PlotDetailModal from '@/components/plots/PlotDetailModal'
import type { PlotDetailTab } from '@/app/dashboard/projects/[id]/[plotId]/PlotDetailPageClient'

const MAX_BYTES = 1_900_000 // margin under the assets bucket's 2 MB cap
const MAX_DIMENSION = 2400

function loadImage(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ img, url })
    img.onerror = () => reject(new Error('อ่านไฟล์ภาพไม่สำเร็จ'))
    img.src = url
  })
}

/**
 * SVG is vector and already small - uploaded as-is. A raster scan over the
 * bucket's 2 MB cap (a printed plan photographed or scanned at high DPI is
 * routinely 5-10 MB) is redrawn through a canvas capped on the long side and
 * re-encoded as JPEG, stepping quality down until it actually fits rather
 * than guessing one compression factor.
 */
async function prepareSitePlanFile(file: File): Promise<{ file: File; width: number; height: number }> {
  if (file.type === 'image/svg+xml') {
    const { img, url } = await loadImage(file)
    URL.revokeObjectURL(url)
    return { file, width: img.naturalWidth || 1000, height: img.naturalHeight || 1000 }
  }

  const { img, url } = await loadImage(file)
  const { naturalWidth: width, naturalHeight: height } = img

  if (file.size <= MAX_BYTES && width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
    URL.revokeObjectURL(url)
    return { file, width, height }
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
  const targetWidth = Math.round(width * scale)
  const targetHeight = Math.round(height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('ย่อภาพไม่สำเร็จ')
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
  URL.revokeObjectURL(url)

  let quality = 0.9
  let blob: Blob | null = null
  for (let i = 0; i < 6; i++) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.size <= MAX_BYTES) break
    quality -= 0.15
  }
  if (!blob) throw new Error('ย่อภาพไม่สำเร็จ')

  return {
    file: new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }),
    width: targetWidth,
    height: targetHeight,
  }
}

type Pos = { mapX: number; mapY: number }

export type SitePlanMarker = {
  id: string
  label: string
  colorClass: string
  meta?: string
  mapX: number | null
  mapY: number | null
  dimmed?: boolean
}

/**
 * Shared by the sales board's map view and the construction project page's
 * map view - both are "an uploaded image + plots pinned to normalised 0-1
 * coordinates on it", differing only in what each marker looks like and
 * where it links. Mount with `key={projectId}` from the caller so switching
 * projects resets all local state (armed/dragging plot, positions) instead
 * of carrying it over into the wrong project's board.
 */
export default function SitePlanMap({
  projectId,
  sitePlanUrl,
  sitePlanWidth,
  sitePlanHeight,
  canEdit,
  markers,
  unplacedEmptyLabel = 'วางครบทุกแปลงแล้ว',
  plotDetailTabs,
}: {
  projectId: string
  sitePlanUrl: string | null
  sitePlanWidth: number | null
  sitePlanHeight: number | null
  canEdit: boolean
  markers: SitePlanMarker[]
  unplacedEmptyLabel?: string
  /** Passed straight through to the marker-click quick-view modal - see
   * PlotDetailPageClient's visibleTabs for why. */
  plotDetailTabs?: PlotDetailTab[]
}) {
  const router = useRouter()
  const toast = useToast()
  const containerRef = useRef<HTMLDivElement>(null)

  const [editMode, setEditMode] = useState(false)
  const [armedPlotId, setArmedPlotId] = useState<string | null>(null)
  const [draggingPlotId, setDraggingPlotId] = useState<string | null>(null)
  const [positions, setPositions] = useState<Record<string, Pos | null>>({})
  const [isUploading, setIsUploading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [viewPlotId, setViewPlotId] = useState<string | null>(null)

  useEffect(() => {
    setPositions(
      Object.fromEntries(markers.map((m) => [m.id, m.mapX != null && m.mapY != null ? { mapX: m.mapX, mapY: m.mapY } : null]))
    )
  }, [markers])

  const placedMarkers = markers.filter((m) => positions[m.id])
  const unplacedMarkers = markers.filter((m) => !positions[m.id])

  async function savePosition(plotId: string, mapX: number, mapY: number) {
    setIsSaving(true)
    const res = await updatePlotMapPosition(plotId, mapX, mapY)
    setIsSaving(false)
    if (!res.success) {
      toast.error(res.error || 'บันทึกตำแหน่งไม่สำเร็จ')
      return
    }
    router.refresh()
  }

  async function handleRemoveFromMap(plotId: string) {
    setPositions((prev) => ({ ...prev, [plotId]: null }))
    setIsSaving(true)
    const res = await updatePlotMapPosition(plotId, null, null)
    setIsSaving(false)
    if (!res.success) toast.error(res.error || 'ลบตำแหน่งไม่สำเร็จ')
    router.refresh()
  }

  function relativePosition(e: { clientX: number; clientY: number }): Pos | null {
    if (!containerRef.current) return null
    const rect = containerRef.current.getBoundingClientRect()
    const mapX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const mapY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    return { mapX, mapY }
  }

  function handleContainerClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!editMode || !armedPlotId || draggingPlotId) return
    const pos = relativePosition(e)
    if (!pos) return
    setPositions((prev) => ({ ...prev, [armedPlotId]: pos }))
    void savePosition(armedPlotId, pos.mapX, pos.mapY)
    setArmedPlotId(null)
  }

  function handleMarkerPointerDown(e: React.PointerEvent, plotId: string) {
    if (!editMode) return
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDraggingPlotId(plotId)
  }

  function handleContainerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingPlotId) return
    const pos = relativePosition(e)
    if (!pos) return
    setPositions((prev) => ({ ...prev, [draggingPlotId]: pos }))
  }

  function handleContainerPointerUp() {
    if (!draggingPlotId) return
    const pos = positions[draggingPlotId]
    const plotId = draggingPlotId
    setDraggingPlotId(null)
    if (pos) void savePosition(plotId, pos.mapX, pos.mapY)
  }

  async function handleFileSelect(file: File | undefined) {
    if (!file) return
    setIsUploading(true)
    try {
      const prepared = await prepareSitePlanFile(file)
      const formData = new FormData()
      formData.append('project_id', projectId)
      formData.append('file', prepared.file)
      formData.append('width', String(prepared.width))
      formData.append('height', String(prepared.height))
      const res = await uploadSitePlan(formData)
      if (!res.success) {
        toast.error(res.error)
        return
      }
      toast.success('อัปโหลดผังโครงการแล้ว')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'อัปโหลดไม่สำเร็จ')
    } finally {
      setIsUploading(false)
    }
  }

  if (!sitePlanUrl) {
    return (
      <Card className="p-8 text-center">
        <MapPinOff className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-3 text-slate-500">โครงการนี้ยังไม่มีผังโครงการ</p>
        {canEdit ? (
          <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {isUploading ? 'กำลังอัปโหลด...' : 'อัปโหลดผังโครงการ'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              disabled={isUploading}
              onChange={(e) => handleFileSelect(e.target.files?.[0])}
            />
          </label>
        ) : (
          <p className="mt-1 text-xs text-slate-400">ให้แอดมินอัปโหลดผังโครงการก่อน</p>
        )}
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <Card className="overflow-hidden p-0">
        {canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-indigo-600">
              <Upload className="h-3.5 w-3.5" /> เปลี่ยนผัง
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                disabled={isUploading}
                onChange={(e) => handleFileSelect(e.target.files?.[0])}
              />
            </label>
            <Button
              type="button"
              size="sm"
              variant={editMode ? 'primary' : 'secondary'}
              onClick={() => {
                setEditMode((v) => !v)
                setArmedPlotId(null)
              }}
            >
              <Move className="h-3.5 w-3.5" /> {editMode ? 'เสร็จแก้ไข' : 'แก้ไขตำแหน่งแปลง'}
            </Button>
          </div>
        )}

        <div
          ref={containerRef}
          onClick={handleContainerClick}
          onPointerMove={handleContainerPointerMove}
          onPointerUp={handleContainerPointerUp}
          className="relative w-full select-none bg-slate-100"
          style={{
            aspectRatio: sitePlanWidth && sitePlanHeight ? `${sitePlanWidth} / ${sitePlanHeight}` : '4 / 3',
            cursor: editMode && armedPlotId ? 'crosshair' : 'default',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sitePlanUrl} alt="ผังโครงการ" className="pointer-events-none absolute inset-0 h-full w-full object-contain" draggable={false} />

          {placedMarkers.map((m) => {
            const pos = positions[m.id]
            if (!pos) return null
            return (
              <div
                key={m.id}
                onPointerDown={(e) => handleMarkerPointerDown(e, m.id)}
                onClick={(e) => {
                  if (editMode) return
                  e.stopPropagation()
                  setViewPlotId(m.id)
                }}
                className={`absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[10px] font-bold text-white shadow ring-2 ring-white transition-opacity ${m.colorClass} ${
                  m.dimmed ? 'opacity-30' : 'opacity-100'
                } ${editMode ? 'cursor-move' : 'cursor-pointer'}`}
                style={{ left: `${pos.mapX * 100}%`, top: `${pos.mapY * 100}%` }}
                title={m.meta ? `${m.label} - ${m.meta}` : m.label}
              >
                {m.label}
                {editMode && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleRemoveFromMap(m.id)
                    }}
                    className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white text-slate-500 shadow ring-1 ring-slate-200 hover:text-red-600"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        {isSaving && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-3 w-3 animate-spin" /> กำลังบันทึก...
          </div>
        )}
        <Card className="p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            ยังไม่ได้วางผัง ({unplacedMarkers.length})
          </h3>
          {unplacedMarkers.length === 0 ? (
            <p className="text-xs text-slate-400">{unplacedEmptyLabel}</p>
          ) : (
            <div className="max-h-[420px] space-y-1 overflow-y-auto">
              {unplacedMarkers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={!editMode}
                  onClick={() => setArmedPlotId(m.id === armedPlotId ? null : m.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                    !editMode
                      ? 'text-slate-500'
                      : armedPlotId === m.id
                        ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
                        : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${m.colorClass}`} />
                  <span className="flex-1 truncate">{m.label}</span>
                  {m.meta && <span className="text-slate-400">{m.meta}</span>}
                </button>
              ))}
            </div>
          )}
          {editMode && unplacedMarkers.length > 0 && (
            <p className="mt-2 text-[11px] text-slate-400">
              {armedPlotId ? 'คลิกตำแหน่งบนผังเพื่อวางแปลงนี้' : 'เลือกแปลงแล้วคลิกบนผังเพื่อวาง'}
            </p>
          )}
        </Card>
      </div>

      <PlotDetailModal projectId={projectId} plotId={viewPlotId} onClose={() => setViewPlotId(null)} visibleTabs={plotDetailTabs} />
    </div>
  )
}
