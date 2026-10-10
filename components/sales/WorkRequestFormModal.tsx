'use client'

import { useMemo, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { createWorkRequest } from '@/actions/sales-work-requests'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { NEW_REQUEST_CATEGORIES } from '@/lib/sales/workRequestCategories'

export type WorkRequestFormOptions = {
  projects: { id: string; name: string }[]
  plots: { id: string; name: string; project_id: string }[]
}

/**
 * The sale-request (SR) form. Used from the SR queue page, where the plot is
 * picked here, and from a plot's own tab, where it is fixed via `plotId`.
 */
export default function WorkRequestFormModal({
  isOpen,
  onClose,
  plotId,
  options,
  onCreated,
}: {
  isOpen: boolean
  onClose: () => void
  plotId?: string
  options?: WorkRequestFormOptions
  onCreated: (formData: FormData) => void
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [projectId, setProjectId] = useState('')
  const [selectedPlot, setSelectedPlot] = useState('')
  const projects = options?.projects ?? []
  const activeProjectId = projectId || projects[0]?.id || ''
  const plotChoices = useMemo(
    () =>
      (options?.plots ?? [])
        .filter((p) => p.project_id === activeProjectId)
        .map((p) => ({ value: p.id, label: p.name })),
    [options, activeProjectId],
  )

  function handleSubmit(formData: FormData) {
    if (plotId) formData.set('plot_id', plotId)
    if (!formData.get('plot_id')) {
      toast.error('กรุณาเลือกแปลง')
      return
    }
    startTransition(async () => {
      const res = await createWorkRequest(formData)
      if (!res.success) {
        toast.error(res.error || 'ส่งคำขอไม่สำเร็จ')
        return
      }
      toast.success('ส่งคำขอแล้ว รอหัวหน้าฝ่ายขายอนุมัติก่อนส่งให้หน่วยงานก่อสร้าง')
      onCreated(formData)
      setSelectedPlot('')
      onClose()
    })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="แจ้งคำขอใหม่ (SR)">
      <form action={handleSubmit} className="space-y-4">
        {!plotId && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">โครงการ</label>
              <select
                value={activeProjectId}
                onChange={(e) => {
                  setProjectId(e.target.value)
                  setSelectedPlot('')
                }}
                className="w-full"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">แปลง</label>
<SearchableSelect
                options={plotChoices}
                value={selectedPlot}
                onChange={setSelectedPlot}
                placeholder="พิมพ์เลขแปลงเพื่อค้นหา"
              />
              <input type="hidden" name="plot_id" value={selectedPlot} />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ประเภท</label>
            <select name="category" required defaultValue="" className="w-full">
              <option value="" disabled>เลือกประเภท</option>
              {NEW_REQUEST_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ความสำคัญ</label>
            <select name="priority" defaultValue="normal" className="w-full">
              <option value="low">ต่ำ</option>
              <option value="normal">ปกติ</option>
              <option value="urgent">ด่วน</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">เรื่อง</label>
          <input name="title" required className="w-full" placeholder="เช่น ก๊อกน้ำห้องน้ำชั้น 2 รั่ว" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">รายละเอียด</label>
          <textarea name="detail" rows={3} className="w-full" placeholder="รายละเอียดเพิ่มเติม" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ต้องเสร็จก่อนวันที่</label>
            <input type="date" name="needed_by" className="w-full" />
            <p className="mt-1 text-[11px] text-slate-500">เว้นว่างได้ - จะใช้วันนัดตรวจบ้านของดีลนี้แทน</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ผู้รับผิดชอบค่าใช้จ่าย</label>
            <select name="charge_to" defaultValue="" className="w-full">
              <option value="">ยังไม่ระบุ</option>
              <option value="customer">ลูกค้า</option>
              <option value="company">บริษัท</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>ยกเลิก</Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            ส่งคำขอ
          </Button>
        </div>
      </form>
    </Modal>
  )
}
