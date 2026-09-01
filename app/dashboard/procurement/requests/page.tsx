'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { getProjects } from '@/actions/project-actions'
import { getPlotsByProjectId } from '@/actions/plot-actions'
import { getMaterialTypes } from '@/actions/material-actions'
import { createPurchaseRequest, getPurchaseRequests } from '@/actions/procurement-actions'
import type { PurchaseRequest, PurchaseRequestStatus } from '@/lib/types/procurement'
import type { MaterialType } from '@/lib/types/materials'

const STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  pending_review: 'รอตรวจสอบ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ปฏิเสธ',
  ordered: 'สั่งซื้อแล้ว',
  received: 'รับของครบ',
  cancelled: 'ยกเลิก',
}

const STATUS_TONE: Record<PurchaseRequestStatus, string> = {
  pending_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-indigo-50 text-indigo-700',
  rejected: 'bg-red-50 text-red-700',
  ordered: 'bg-violet-50 text-violet-700',
  received: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
}

const FILTERS: { key: PurchaseRequestStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'pending_review', label: 'รอตรวจสอบ' },
  { key: 'approved', label: 'อนุมัติแล้ว' },
  { key: 'ordered', label: 'สั่งซื้อแล้ว' },
  { key: 'received', label: 'รับของครบ' },
  { key: 'rejected', label: 'ปฏิเสธ' },
]

type Line = { material_type_id: number; quantity_requested: string; note: string }

export default function PurchaseRequestsPage() {
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [filter, setFilter] = useState<PurchaseRequestStatus | 'all'>('all')
  const [isLoading, setIsLoading] = useState(true)
  const toast = useToast()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [projects, setProjects] = useState<{ id: string; name: string; location: string | null }[]>([])
  const [plots, setPlots] = useState<{ id: string; name: string }[]>([])
  const [materials, setMaterials] = useState<MaterialType[]>([])
  const [projectId, setProjectId] = useState('')
  const [plotId, setPlotId] = useState('')
  const [note, setNote] = useState('')
  const [neededByDate, setNeededByDate] = useState('')
  const [lines, setLines] = useState<Line[]>([])

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setIsLoading(true)
    try {
      setRequests(await getPurchaseRequests())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลคำขอซื้อไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  const filtered = useMemo(
    () => (filter === 'all' ? requests : requests.filter((r) => r.status === filter)),
    [requests, filter]
  )

  async function openCreateModal() {
    setProjectId('')
    setPlotId('')
    setNote('')
    setNeededByDate('')
    setLines([])
    setIsModalOpen(true)
    if (projects.length === 0 || materials.length === 0) {
      const [p, m] = await Promise.all([getProjects(), getMaterialTypes()])
      setProjects(p as any)
      setMaterials(m)
    }
  }

  useEffect(() => {
    if (!projectId) {
      setPlots([])
      setPlotId('')
      return
    }
    void getPlotsByProjectId(projectId).then((p) => setPlots(p as any))
  }, [projectId])

  function addLine() {
    setLines((prev) => [...prev, { material_type_id: 0, quantity_requested: '', note: '' }])
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  function handleSubmit() {
    if (!projectId) {
      toast.error('กรุณาเลือกโครงการ')
      return
    }
    const validLines = lines.filter((l) => l.material_type_id && Number(l.quantity_requested) > 0)
    if (validLines.length === 0) {
      toast.error('กรุณาเพิ่มรายการวัสดุอย่างน้อย 1 รายการ')
      return
    }

    startTransition(async () => {
      try {
        await createPurchaseRequest({
          project_id: projectId,
          plot_id: plotId || null,
          note,
          needed_by_date: neededByDate,
          items: validLines.map((l) => ({
            material_type_id: l.material_type_id,
            quantity_requested: Number(l.quantity_requested),
            note: l.note,
          })),
        })
        setIsModalOpen(false)
        await load()
        toast.success('ส่งใบขอซื้อเรียบร้อยแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ส่งใบขอซื้อไม่สำเร็จ')
      }
    })
  }

  const materialOptions = materials.map((m) => ({ value: String(m.id), label: `${m.name} (${m.unit})` }))
  const projectOptions = projects.map((p) => ({ value: p.id, label: p.name, sublabel: p.location || undefined }))
  const plotOptions = plots.map((p) => ({ value: p.id, label: p.name }))

  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดคำขอซื้อ...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="คำขอซื้อ (Purchase Requests)"
        subtitle="คำขอซื้อที่ส่งเข้ามา รอตรวจสอบและอนุมัติก่อนออกใบสั่งซื้อ"
        actions={
          <Button onClick={openCreateModal}>
            <Plus className="h-4 w-4" /> สร้างคำขอซื้อ
          </Button>
        }
      />


      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
              filter === f.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">เลขที่</th>
                <th className="px-4 py-3 font-semibold">โครงการ</th>
                <th className="px-4 py-3 font-semibold">ผู้ขอซื้อ</th>
                <th className="px-4 py-3 font-semibold">รายการ</th>
                <th className="px-4 py-3 font-semibold">สถานะ</th>
                <th className="px-4 py-3 font-semibold">วันที่</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center italic text-slate-400">
                    ไม่มีคำขอซื้อในสถานะนี้
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/procurement/requests/${r.id}`} className="font-mono font-medium text-indigo-600 hover:underline">
                        #{String(r.pr_no).padStart(4, '0')}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{r.projects?.name || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{r.requester?.full_name || r.requester?.email || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{r.purchase_request_items?.length || 0} รายการ</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{new Date(r.created_at).toLocaleDateString('th-TH')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="สร้างคำขอซื้อ" panelClassName="max-w-2xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">โครงการ</label>
              <SearchableSelect options={projectOptions} value={projectId} onChange={setProjectId} placeholder="เลือกโครงการ" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">แปลง (ถ้ามี)</label>
              <SearchableSelect options={plotOptions} value={plotId} onChange={setPlotId} placeholder="ไม่ระบุแปลง" disabled={!projectId} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ต้องการภายในวันที่</label>
            <input type="date" value={neededByDate} onChange={(e) => setNeededByDate(e.target.value)} className="w-full" />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">รายการวัสดุ</label>
              <Button type="button" variant="secondary" size="sm" onClick={addLine}>
                <Plus className="h-3.5 w-3.5" /> เพิ่มรายการ
              </Button>
            </div>
            {lines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
                ยังไม่มีรายการ กดเพิ่มรายการเพื่อเริ่มต้น
              </p>
            ) : (
              <div className="space-y-2">
                {lines.map((line, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1">
                      <SearchableSelect
                        options={materialOptions}
                        value={line.material_type_id ? String(line.material_type_id) : ''}
                        onChange={(v) => updateLine(i, { material_type_id: Number(v) })}
                        placeholder="เลือกวัสดุ"
                      />
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity_requested}
                      onChange={(e) => updateLine(i, { quantity_requested: e.target.value })}
                      placeholder="จำนวน"
                      className="w-28"
                    />
                    <button type="button" onClick={() => removeLine(i)} className="rounded p-2 text-slate-300 hover:bg-red-50 hover:text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">หมายเหตุ</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} className="w-full" rows={2} />
          </div>

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ส่งคำขอซื้อ'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
