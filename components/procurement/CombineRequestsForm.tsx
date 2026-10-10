'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Layers, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useToast } from '@/components/ui/Toast'
import { getEligibleRequestLinesForOrder } from '@/actions/procurement-actions'
import type { EligibleRequestLine } from '@/actions/procurement/requests'
import { saveCombineDraft, type CombineDraftLine } from '@/lib/procurement/combineDraft'

const qtyFormat = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 4 })

/** Step 1 of a multi-request purchase order: pick the supplier, tick the
 * approved request lines to buy now, say how much of each. Lines for the same
 * material are grouped into one supplier-facing line whose per-request
 * breakdown is kept - the PO form (step 2) prices it and creates the order.
 * Every quantity here is re-validated by the server when the order is saved;
 * the checks below are only for early feedback. */
export default function CombineRequestsForm({
  projects,
  suppliers,
}: {
  projects: { id: string; name: string }[]
  suppliers: { id: string; name: string }[]
}) {
  const router = useRouter()
  const toast = useToast()
  const ALL_PROJECTS = '__all__'
  /** The project the order is raised under (billing, delivery address). */
  const [projectId, setProjectId] = useState('')
  /** Which projects' requests are listed: one project, or all of them. */
  const [sourceFilter, setSourceFilter] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [lines, setLines] = useState<EligibleRequestLine[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [search, setSearch] = useState('')
  /** purchase_request_item_id -> quantity to order (as typed). Presence = ticked. */
  const [selected, setSelected] = useState<Record<string, string>>({})

  async function handleSourceChange(id: string) {
    setSourceFilter(id)
    setSelected({})
    setLines([])
    // A single project is also the order's project; "all projects" leaves the
    // order's own project to be chosen separately.
    if (id !== ALL_PROJECTS) setProjectId(id)
    if (!id) return
    setIsLoading(true)
    try {
      setLines(await getEligibleRequestLinesForOrder(id === ALL_PROJECTS ? null : id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดรายการคำขอซื้อไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return lines
    return lines.filter(
      (l) =>
        l.material_name.toLowerCase().includes(q) ||
        `pr-${l.pr_no}`.includes(q) ||
        (l.plot_label || '').toLowerCase().includes(q) ||
        l.project_name.toLowerCase().includes(q)
    )
  }, [lines, search])

  function toggle(line: EligibleRequestLine, checked: boolean) {
    setSelected((prev) => {
      const next = { ...prev }
      if (checked) next[line.purchase_request_item_id] = String(line.remaining)
      else delete next[line.purchase_request_item_id]
      return next
    })
  }

  function setQuantity(id: string, value: string) {
    setSelected((prev) => ({ ...prev, [id]: value }))
  }

  /** Selected lines grouped by material (the unit is the material's own for
   * every eligible line, so material alone is the grouping key). */
  const groups = useMemo(() => {
    const byMaterial = new Map<number, { materialName: string; unit: string; unitPrice: number; rows: { line: EligibleRequestLine; qty: number }[] }>()
    for (const line of lines) {
      const raw = selected[line.purchase_request_item_id]
      if (raw === undefined) continue
      const qty = Number(raw) || 0
      const group = byMaterial.get(line.material_type_id) || {
        materialName: line.material_name,
        unit: line.unit,
        unitPrice: line.unit_price,
        rows: [],
      }
      group.rows.push({ line, qty })
      byMaterial.set(line.material_type_id, group)
    }
    return Array.from(byMaterial.entries()).map(([materialId, g]) => ({
      materialId,
      ...g,
      total: g.rows.reduce((sum, r) => sum + r.qty, 0),
    }))
  }, [lines, selected])

  const requestCount = new Set(groups.flatMap((g) => g.rows.map((r) => r.line.purchase_request_id))).size

  function handleContinue() {
    if (!projectId) return toast.error(sourceFilter === ALL_PROJECTS ? 'กรุณาเลือกโครงการของใบสั่งซื้อ' : 'กรุณาเลือกโครงการ')
    if (!supplierId) return toast.error('กรุณาเลือกผู้จำหน่าย')
    if (groups.length === 0) return toast.error('กรุณาเลือกรายการจากคำขอซื้ออย่างน้อย 1 รายการ')
    for (const g of groups) {
      for (const r of g.rows) {
        if (!(r.qty > 0)) return toast.error(`กรุณาระบุจำนวนที่สั่งของ ${g.materialName} (PR-${r.line.pr_no}) ให้มากกว่า 0`)
        if (r.qty > r.line.remaining + 1e-9) {
          return toast.error(`${g.materialName} (PR-${r.line.pr_no}) สั่งได้ไม่เกินจำนวนคงเหลือ ${qtyFormat(r.line.remaining)} ${g.unit}`)
        }
      }
    }

    // The order's own plot scope covers only the order's project; requests
    // from other projects are attributed through their allocations.
    const plotIds = Array.from(
      new Set(groups.flatMap((g) => g.rows.filter((r) => r.line.project_id === projectId).flatMap((r) => r.line.plot_ids)))
    )
    const draftLines: CombineDraftLine[] = groups.map((g) => ({
      material_type_id: g.materialId,
      material_name: g.materialName,
      material_unit: g.unit,
      unit_price: g.unitPrice,
      allocations: g.rows.map((r) => ({
        purchase_request_item_id: r.line.purchase_request_item_id,
        quantity: String(r.qty),
        pr_no: r.line.pr_no,
        plot_label: r.line.plot_label,
      })),
    }))

    try {
      saveCombineDraft({ projectId, supplierId, plotIds, lines: draftLines })
    } catch (error) {
      return toast.error(error instanceof Error ? error.message : 'ไม่สามารถดำเนินการต่อได้')
    }
    router.push('/dashboard/procurement/orders/create?combined=1')
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-24">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/procurement/orders" className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="กลับ">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <Layers className="h-5 w-5 text-indigo-600" /> รวมคำขอซื้อเป็นใบสั่งซื้อเดียว
          </h1>
          <p className="text-sm text-slate-500">
            เลือกรายการจากคำขอซื้อที่อนุมัติแล้วหลายใบ (ข้ามโครงการได้) วัสดุเดียวกันจะถูกรวมเป็นบรรทัดเดียวในใบสั่งซื้อ โดยเก็บที่มาของแต่ละแปลงไว้
          </p>
        </div>
      </div>

      <Card className="p-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-indigo-700">1. โครงการและผู้จำหน่าย</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">คำขอซื้อจากโครงการ</label>
            <SearchableSelect
              options={[{ value: ALL_PROJECTS, label: 'ทุกโครงการ (รวมข้ามโครงการ)' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
              value={sourceFilter}
              onChange={(v) => void handleSourceChange(v)}
              placeholder="เลือกโครงการ"
            />
          </div>
          {sourceFilter === ALL_PROJECTS && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">ออกใบสั่งซื้อภายใต้โครงการ</label>
              <SearchableSelect
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                value={projectId}
                onChange={setProjectId}
                placeholder="เลือกโครงการของใบสั่งซื้อ"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">ผู้จำหน่าย</label>
            <SearchableSelect
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              value={supplierId}
              onChange={setSupplierId}
              placeholder="เลือกผู้จำหน่าย"
            />
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className={`mb-0 text-xs font-semibold uppercase tracking-wide text-indigo-700`}>2. เลือกรายการจากคำขอซื้อ</div>
          {lines.length > 0 && (
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาวัสดุ / PR / แปลง"
              className="w-56 text-sm"
            />
          )}
        </div>

        {!sourceFilter ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">เลือกโครงการเพื่อดูรายการที่ยังสั่งซื้อได้</p>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด...
          </div>
        ) : lines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
            ไม่มีรายการที่ยังสั่งซื้อได้ในโครงการนี้ (คำขอซื้อต้องอนุมัติแล้วและมียอดคงเหลือ)
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="w-10 px-3 py-2.5" />
                  <th className="px-3 py-2.5">คำขอซื้อ</th>
                  {sourceFilter === ALL_PROJECTS && <th className="px-3 py-2.5">โครงการ</th>}
                  <th className="px-3 py-2.5">วัสดุ</th>
                  <th className="px-3 py-2.5">แปลง / กลุ่มแปลง</th>
                  <th className="px-3 py-2.5 text-right">คงเหลือ</th>
                  <th className="w-40 px-3 py-2.5 text-right">จำนวนที่สั่ง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {visible.map((line) => {
                  const checked = selected[line.purchase_request_item_id] !== undefined
                  const over = checked && Number(selected[line.purchase_request_item_id]) > line.remaining + 1e-9
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
                      {sourceFilter === ALL_PROJECTS && <td className="px-3 py-2 text-slate-500">{line.project_name}</td>}
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
                              onChange={(e) => setQuantity(line.purchase_request_item_id, e.target.value)}
                              className={`w-24 text-right ${over ? 'border-rose-400' : ''}`}
                            />
                            <span className="text-xs text-slate-500">{line.unit}</span>
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
      </Card>

      <Card className="p-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-indigo-700">3. ตรวจสอบรายการที่จะรวมในใบสั่งซื้อ</div>
        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">ยังไม่ได้เลือกรายการ</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.materialId} className="rounded-xl border border-slate-100 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="font-medium text-slate-800">{g.materialName}</div>
                  <div className="whitespace-nowrap font-semibold text-slate-900">
                    {qtyFormat(g.total)} {g.unit}
                  </div>
                </div>
                <ul className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                  {g.rows.map((r) => (
                    <li key={r.line.purchase_request_item_id} className="flex justify-between gap-3">
                      <span>
                        PR-{r.line.pr_no}
                        {sourceFilter === ALL_PROJECTS ? ` · ${r.line.project_name}` : ''}
                        {r.line.plot_label ? ` · ${r.line.plot_label}` : ''}
                      </span>
                      <span className="whitespace-nowrap">
                        {qtyFormat(r.qty)} {g.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="text-xs text-slate-500">
              {groups.length} รายการสั่งซื้อ จาก {requestCount} คำขอซื้อ - ใบสั่งซื้อที่ส่งให้ผู้จำหน่ายจะแสดงเฉพาะยอดรวมต่อวัสดุ ส่วนที่มาของแต่ละแปลงเก็บไว้ภายใน
            </p>
          </div>
        )}
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <span className="text-sm text-slate-500">
            {groups.length > 0 ? `เลือกแล้ว ${groups.length} วัสดุ จาก ${requestCount} คำขอซื้อ` : 'ยังไม่ได้เลือกรายการ'}
          </span>
          <Button type="button" onClick={handleContinue} disabled={groups.length === 0 || !supplierId}>
            ถัดไป: กรอกราคาและรายละเอียด <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
