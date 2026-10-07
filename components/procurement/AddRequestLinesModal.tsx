'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { getEligibleRequestLinesForOrder } from '@/actions/procurement-actions'
import type { EligibleRequestLine } from '@/actions/procurement/requests'

const qtyFormat = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 4 })

export type RequestPick = { line: EligibleRequestLine; qty: number }

/**
 * Attach approved purchase request lines to an order that already exists:
 * pick lines (from any project) and how much of each this order buys. The
 * order form folds them into matching lines or adds new ones; the server
 * validates every quantity again when the order is saved.
 */
export default function AddRequestLinesModal({
  isOpen,
  onClose,
  defaultProjectId,
  excludeItemIds,
  onAdd,
}: {
  isOpen: boolean
  onClose: () => void
  /** The order's own project - listed first by default. */
  defaultProjectId: string
  /** Request lines already on this order. */
  excludeItemIds: string[]
  onAdd: (picks: RequestPick[]) => void
}) {
  const toast = useToast()
  const [lines, setLines] = useState<EligibleRequestLine[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [projectFilter, setProjectFilter] = useState(defaultProjectId)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setIsLoading(true)
    setSelected({})
    setProjectFilter(defaultProjectId)
    getEligibleRequestLinesForOrder(null)
      .then((rows) => {
        if (!cancelled) setLines(rows)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'โหลดรายการใบขอซื้อไม่สำเร็จ'))
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const available = useMemo(() => lines.filter((l) => !excludeItemIds.includes(l.purchase_request_item_id)), [lines, excludeItemIds])
  const projects = useMemo(() => {
    const byId = new Map<string, string>()
    for (const l of available) byId.set(l.project_id, l.project_name)
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }))
  }, [available])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return available.filter((l) => {
      if (projectFilter && projectFilter !== '__all__' && l.project_id !== projectFilter) return false
      if (!q) return true
      return (
        l.material_name.toLowerCase().includes(q) ||
        `pr-${l.pr_no}`.includes(q) ||
        (l.plot_label || '').toLowerCase().includes(q) ||
        l.project_name.toLowerCase().includes(q)
      )
    })
  }, [available, projectFilter, search])

  function toggle(line: EligibleRequestLine, checked: boolean) {
    setSelected((prev) => {
      const next = { ...prev }
      if (checked) next[line.purchase_request_item_id] = String(line.remaining)
      else delete next[line.purchase_request_item_id]
      return next
    })
  }

  function handleAdd() {
    const picks: RequestPick[] = []
    for (const line of lines) {
      const raw = selected[line.purchase_request_item_id]
      if (raw === undefined) continue
      const qty = Number(raw) || 0
      if (!(qty > 0)) return toast.error(`กรุณาระบุจำนวนของ ${line.material_name} (PR-${line.pr_no}) ให้มากกว่า 0`)
      if (qty > line.remaining + 1e-9) {
        return toast.error(`${line.material_name} (PR-${line.pr_no}) เพิ่มได้ไม่เกินจำนวนคงเหลือ ${qtyFormat(line.remaining)} ${line.unit}`)
      }
      picks.push({ line, qty })
    }
    if (picks.length === 0) return toast.error('กรุณาเลือกรายการอย่างน้อย 1 รายการ')
    onAdd(picks)
    onClose()
  }

  const pickedCount = Object.keys(selected).length

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="เพิ่มรายการจากใบขอซื้อที่อนุมัติแล้ว" panelClassName="max-w-3xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="text-sm">
            <option value="__all__">ทุกโครงการ</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาวัสดุ / PR / แปลง" className="w-56 text-sm" />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด...
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
            ไม่มีรายการที่ยังสั่งซื้อได้ (ใบขอซื้อต้องอนุมัติแล้ว มียอดคงเหลือ และใช้หน่วยเดียวกับวัสดุ)
          </p>
        ) : (
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2" />
                  <th className="px-3 py-2">ใบขอซื้อ</th>
                  <th className="px-3 py-2">โครงการ</th>
                  <th className="px-3 py-2">วัสดุ</th>
                  <th className="px-3 py-2">แปลง</th>
                  <th className="px-3 py-2 text-right">คงเหลือ</th>
                  <th className="w-36 px-3 py-2 text-right">จำนวนที่สั่ง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((line) => {
                  const checked = selected[line.purchase_request_item_id] !== undefined
                  return (
                    <tr key={line.purchase_request_item_id} className={checked ? 'bg-indigo-50/40' : undefined}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => toggle(line, e.target.checked)}
                          aria-label={`เลือก ${line.material_name} จาก PR-${line.pr_no}`}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">PR-{line.pr_no}</td>
                      <td className="px-3 py-2 text-slate-500">{line.project_name}</td>
                      <td className="px-3 py-2">{line.material_name}</td>
                      <td className="px-3 py-2 text-slate-500">{line.plot_label || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">
                        {qtyFormat(line.remaining)} {line.unit}
                      </td>
                      <td className="px-3 py-2">
                        {checked && (
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              type="number"
                              min="0"
                              max={line.remaining}
                              step="any"
                              value={selected[line.purchase_request_item_id]}
                              onChange={(e) => setSelected((prev) => ({ ...prev, [line.purchase_request_item_id]: e.target.value }))}
                              className="w-24 text-right"
                            />
                            <span className="text-xs text-slate-400">{line.unit}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-sm text-slate-500">{pickedCount > 0 ? `เลือกแล้ว ${pickedCount} รายการ` : 'ยังไม่ได้เลือกรายการ'}</span>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button type="button" size="sm" onClick={handleAdd} disabled={pickedCount === 0}>
              เพิ่มเข้าใบสั่งซื้อ
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
