import { Boxes, User } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { PlotJobRow } from '@/lib/types/plotDetail'

const STATUS_LABEL: Record<string, string> = {
  pending: 'รอเริ่ม',
  in_progress: 'กำลังทำ',
  completed: 'เสร็จสิ้น',
}
const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-500',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
}

type Contractor = { id: string; name: string }

export default function PlotConstructionTab({
  jobs,
  contractors,
  canEdit,
  isPending,
  priceDrafts,
  onPriceDraftChange,
  onSaveVariablePrice,
  onResetVariablePrice,
  onAssign,
  onStatusChange,
  onOpenMaterialsLog,
}: {
  jobs: PlotJobRow[]
  contractors: Contractor[]
  canEdit: boolean
  isPending: boolean
  priceDrafts: Record<string, string>
  onPriceDraftChange: (jobId: string, value: string) => void
  onSaveVariablePrice: (job: PlotJobRow) => void
  onResetVariablePrice: (job: PlotJobRow) => void
  onAssign: (jobId: string, contractorId: string) => void
  onStatusChange: (jobId: string, status: string) => void
  onOpenMaterialsLog: (job: { id: string; label: string }) => void
}) {
  // Sales (canSeeCost=false, so every job.cost is null) sees job name and
  // status only - no contractor column, no price/budget/paid columns at
  // all, per SALES_MODULE_PLAN.md §8.3. Not blanked cells: the columns
  // themselves don't exist in this table.
  const showCostColumns = jobs.length === 0 || jobs.some((j) => j.cost)

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-700 border-b">
            <tr>
              <th className="px-4 py-3 font-semibold">รายการงาน</th>
              {showCostColumns && <th className="px-4 py-3 font-semibold w-[220px]">Variable Price / Unit</th>}
              {showCostColumns && <th className="px-4 py-3 font-semibold text-right">งบประมาณ (BOQ)</th>}
              {showCostColumns && <th className="px-4 py-3 font-semibold text-right">จ่ายแล้ว</th>}
              <th className="px-4 py-3 font-semibold w-[200px]">ผู้รับเหมา</th>
              <th className="px-4 py-3 font-semibold w-[120px]">สถานะ</th>
              <th className="px-4 py-3 font-semibold w-[80px] text-center">วัสดุ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {jobs.map((job) => {
              const isOverBudget = job.cost ? job.cost.paid > job.cost.totalBoq : false

              return (
                <tr key={job.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{job.itemName}</div>
                    <div className="text-xs text-slate-400">
                      {job.quantity} {job.unit}
                      {job.cost && ` x ${formatCurrency(job.cost.boqPricePerUnit)}`}
                    </div>
                  </td>

                  {showCostColumns && (
                    <td className="px-4 py-3">
                      {job.cost && canEdit ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder={String(job.cost.boqPricePerUnit || 0)}
                              value={priceDrafts[job.id] ?? ''}
                              onChange={(e) => onPriceDraftChange(job.id, e.target.value)}
                              className="w-28 rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => onSaveVariablePrice(job)}
                              disabled={isPending}
                              className="rounded-lg bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => onResetVariablePrice(job)}
                              disabled={isPending}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                            >
                              Reset
                            </button>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {job.cost.agreedPricePerUnit != null
                              ? `ใช้ราคาตกลง: ฿${formatCurrency(job.cost.effectivePrice)}`
                              : `ใช้ราคา BOQ: ฿${formatCurrency(job.cost.effectivePrice)}`}
                          </div>
                        </div>
                      ) : job.cost ? (
                        <div className="text-xs text-slate-500">฿{formatCurrency(job.cost.effectivePrice)} / หน่วย</div>
                      ) : null}
                    </td>
                  )}

                  {showCostColumns && (
                    <td className="px-4 py-3 text-right text-slate-600 font-medium">
                      {job.cost ? `฿${formatCurrency(job.cost.totalBoq)}` : '—'}
                    </td>
                  )}
                  {showCostColumns && (
                    <td className={`px-4 py-3 text-right font-bold ${isOverBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                      {job.cost ? `฿${formatCurrency(job.cost.paid)}` : '—'}
                    </td>
                  )}

                  <td className="px-4 py-3">
                    {!job.cost ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : canEdit ? (
                      <div className="relative">
                        <User className="absolute left-2 top-2.5 h-3 w-3 text-slate-400" />
                        <select
                          value={job.contractorId || ''}
                          onChange={(e) => onAssign(job.id, e.target.value)}
                          className={`w-full pl-7 pr-2 py-1.5 rounded border text-xs cursor-pointer outline-none ${
                            job.contractorId ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200'
                          }`}
                        >
                          <option value="">-- ว่าง --</option>
                          {contractors.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">{job.cost.contractorName || '— ว่าง —'}</span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {canEdit ? (
                      <select
                        value={job.status}
                        onChange={(e) => onStatusChange(job.id, e.target.value)}
                        disabled={!job.contractorId}
                        className={`w-full px-2 py-1.5 rounded text-xs font-bold border-0 cursor-pointer ${STATUS_CLASS[job.status] || STATUS_CLASS.pending}`}
                      >
                        <option value="pending">รอเริ่ม</option>
                        <option value="in_progress">กำลังทำ</option>
                        <option value="completed">เสร็จสิ้น</option>
                      </select>
                    ) : (
                      <span className={`inline-flex rounded px-2 py-1 text-xs font-bold ${STATUS_CLASS[job.status] || STATUS_CLASS.pending}`}>
                        {STATUS_LABEL[job.status] || job.status}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-center">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => onOpenMaterialsLog({ id: job.id, label: job.itemName })}
                        className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition"
                        title="บันทึกวัสดุ"
                      >
                        <Boxes className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {jobs.length === 0 && <div className="py-12 text-center text-slate-400">ยังไม่มีรายการงาน</div>}
      </div>
    </Card>
  )
}
