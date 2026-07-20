'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2, Users } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { formatCurrency } from '@/lib/currency'
import {
  deleteMaterialUsageEntry,
  getMaterialTypes,
  getMaterialUsageForJob,
  getMaterialVarianceForJob,
  getPlotGroupContextForJob,
  logMaterialUsage,
} from '@/actions/material-actions'
import type { MaterialType, MaterialUsageLogEntry, MaterialVariance, PlotGroupContext } from '@/lib/types/materials'

type Props = {
  isOpen: boolean
  onClose: () => void
  jobAssignmentId: string
  jobLabel: string
}

function today() {
  return new Date().toISOString().split('T')[0]
}

function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export default function JobMaterialLogModal({ isOpen, onClose, jobAssignmentId, jobLabel }: Props) {
  const [variance, setVariance] = useState<MaterialVariance[]>([])
  const [logEntries, setLogEntries] = useState<MaterialUsageLogEntry[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [groupContext, setGroupContext] = useState<PlotGroupContext | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedMaterialId, setSelectedMaterialId] = useState('')
  const [quantityUsed, setQuantityUsed] = useState('')
  const [unitPrice, setUnitPrice] = useState('0')
  const [purchaseDate, setPurchaseDate] = useState(today())
  const [note, setNote] = useState('')
  const [logScope, setLogScope] = useState<'plot' | 'group'>('plot')

  useEffect(() => {
    if (!isOpen) return
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, jobAssignmentId])

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const [varianceRows, logRows, types, group] = await Promise.all([
        getMaterialVarianceForJob(jobAssignmentId),
        getMaterialUsageForJob(jobAssignmentId),
        getMaterialTypes(),
        getPlotGroupContextForJob(jobAssignmentId),
      ])
      setVariance(varianceRows)
      setLogEntries(logRows)
      setMaterialTypes(types)
      setGroupContext(group)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลวัสดุไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  const selectedMaterial = useMemo(
    () => materialTypes.find((mt) => String(mt.id) === selectedMaterialId) || null,
    [materialTypes, selectedMaterialId]
  )

  function handleMaterialSelect(id: string) {
    setSelectedMaterialId(id)
    const mt = materialTypes.find((m) => String(m.id) === id)
    if (mt) setUnitPrice(String(mt.current_price))
  }

  async function handleLogUsage() {
    setError(null)
    if (!selectedMaterialId) {
      setError('กรุณาเลือกวัสดุ')
      return
    }
    const qty = parseFloat(quantityUsed)
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('กรุณาใส่ปริมาณที่ถูกต้อง')
      return
    }
    const price = parseFloat(unitPrice)
    if (!Number.isFinite(price) || price < 0) {
      setError('กรุณาใส่ราคาที่ถูกต้อง')
      return
    }

    setIsSaving(true)
    try {
      await logMaterialUsage({
        job_assignment_id: jobAssignmentId,
        material_type_id: Number(selectedMaterialId),
        quantity_used: qty,
        unit_price_at_use: price,
        purchase_date: purchaseDate,
        note,
        for_group: logScope === 'group',
      })
      setSelectedMaterialId('')
      setQuantityUsed('')
      setUnitPrice('0')
      setNote('')
      setPurchaseDate(today())
      setLogScope('plot')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกการใช้วัสดุไม่สำเร็จ')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDeleteEntry(entry: MaterialUsageLogEntry) {
    const message = entry.plot_group
      ? `รายการนี้บันทึกไว้สำหรับทั้งกลุ่ม "${entry.plot_group.name}" การลบจะมีผลกับทุกแปลงในกลุ่ม ยืนยันหรือไม่?`
      : 'ยืนยันลบรายการนี้?'
    if (!confirm(message)) return
    setIsSaving(true)
    setError(null)
    try {
      await deleteMaterialUsageEntry(entry.id)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ลบรายการไม่สำเร็จ')
    } finally {
      setIsSaving(false)
    }
  }

  // Live preview: while a draft entry is being filled in, the row for the
  // material being logged shows what this plot's numbers would become if
  // saved right now. A group-scoped draft contributes only this plot's
  // share (quantity / member count); the budget column is always the
  // plot's own BOQ quantity.
  const memberCount = groupContext?.member_count || 1
  const draftQty = parseFloat(quantityUsed) || 0
  const draftPrice = parseFloat(unitPrice) || 0
  const draftShareQty = logScope === 'group' ? draftQty / memberCount : draftQty
  const draftMaterialTypeId = selectedMaterialId ? Number(selectedMaterialId) : null

  const displayRows = variance.map((row) => {
    const isDraftRow = row.material_type_id === draftMaterialTypeId && draftQty > 0
    const previewUsedQuantity = isDraftRow ? row.used_quantity + draftShareQty : row.used_quantity
    const previewActualCost = isDraftRow ? row.actual_cost + draftShareQty * draftPrice : row.actual_cost
    return {
      ...row,
      hasPreview: isDraftRow,
      previewUsedQuantity,
      previewActualCost,
      previewDifference: previewActualCost - row.planned_cost,
    }
  })

  const totals = displayRows.reduce(
    (acc, row) => ({
      planned: acc.planned + row.planned_cost,
      actual: acc.actual + row.previewActualCost,
    }),
    { planned: 0, actual: 0 }
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`บันทึกวัสดุ: ${jobLabel}`} panelClassName="max-w-3xl">
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-5">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">งบประมาณเทียบกับที่ใช้จริง (ต่อแปลงนี้)</p>
              {groupContext && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-indigo-600">
                  <Users className="h-3 w-3" />
                  อยู่ในกลุ่ม {groupContext.name} ({groupContext.member_count} แปลง)
                </span>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">วัสดุ</th>
                    <th className="w-28 px-3 py-2 text-right font-semibold">งบ (ปริมาณ)</th>
                    <th className="w-32 px-3 py-2 text-right font-semibold">ใช้จริง (ปริมาณ)</th>
                    <th className="w-28 px-3 py-2 text-right font-semibold">งบประมาณ</th>
                    <th className="w-28 px-3 py-2 text-right font-semibold">ใช้จริง</th>
                    <th className="w-28 px-3 py-2 text-right font-semibold">ผลต่าง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                        งานนี้ยังไม่มีรายการวัสดุที่ตั้งงบไว้
                      </td>
                    </tr>
                  ) : (
                    displayRows.map((row) => {
                      const isOverBudget = row.previewDifference > 0
                      const isUnplanned = row.planned_quantity === 0 && row.previewUsedQuantity > 0
                      return (
                        <tr
                          key={row.material_type_id}
                          className={row.hasPreview ? 'bg-indigo-50/60' : isUnplanned ? 'bg-amber-50/60' : ''}
                        >
                          <td className="px-3 py-2 font-medium text-slate-800">
                            {row.material_name}
                            {isUnplanned && (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                ไม่ได้ตั้งงบไว้
                              </span>
                            )}
                            {row.group && (
                              <div className="mt-0.5 text-[11px] font-normal text-indigo-600">
                                ทั้งกลุ่ม ({row.group.member_count} แปลง): ใช้ {formatQty(row.group.total_quantity)} /
                                งบ {formatQty(row.group.planned_quantity)} {row.unit}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {formatQty(row.planned_quantity)} {row.unit}
                          </td>
                          <td className={`px-3 py-2 text-right ${row.hasPreview ? 'font-semibold text-indigo-700' : 'text-slate-600'}`}>
                            {formatQty(row.previewUsedQuantity)} {row.unit}
                          </td>
                          <td className="px-3 py-2 text-right">฿{formatCurrency(row.planned_cost)}</td>
                          <td className={`px-3 py-2 text-right ${row.hasPreview ? 'font-semibold text-indigo-700' : ''}`}>
                            ฿{formatCurrency(row.previewActualCost)}
                          </td>
                          <td className={`px-3 py-2 text-right font-semibold ${isOverBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                            {isOverBudget ? '+' : ''}฿{formatCurrency(row.previewDifference)}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
                {displayRows.length > 0 && (
                  <tfoot className="bg-slate-50 font-bold text-slate-800">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-right">รวม</td>
                      <td className="px-3 py-2 text-right">฿{formatCurrency(totals.planned)}</td>
                      <td className="px-3 py-2 text-right">฿{formatCurrency(totals.actual)}</td>
                      <td className={`px-3 py-2 text-right ${totals.actual > totals.planned ? 'text-red-600' : 'text-emerald-600'}`}>
                        {totals.actual > totals.planned ? '+' : ''}฿{formatCurrency(totals.actual - totals.planned)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-700">บันทึกการใช้วัสดุ</p>

            {groupContext && (
              <div className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50/50 p-2.5">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-indigo-800">
                  <Users className="h-3.5 w-3.5" />
                  บันทึกสำหรับ
                </div>
                <div className="flex flex-wrap gap-3">
                  <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="log-scope"
                      checked={logScope === 'plot'}
                      onChange={() => setLogScope('plot')}
                    />
                    เฉพาะแปลงนี้
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="log-scope"
                      checked={logScope === 'group'}
                      onChange={() => setLogScope('group')}
                    />
                    ทั้งกลุ่ม {groupContext.name} ({groupContext.member_count} แปลง)
                  </label>
                </div>
                {logScope === 'group' && (
                  <p className="mt-1.5 text-[11px] text-indigo-700">
                    ใส่ยอดรวมที่ซื้อทั้งกลุ่ม - ระบบจะเฉลี่ยต่อแปลงให้เอง (÷ {groupContext.member_count})
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <div className="lg:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">วัสดุ</label>
                <SearchableSelect
                  value={selectedMaterialId}
                  onChange={handleMaterialSelect}
                  placeholder="-- เลือกวัสดุ --"
                  options={materialTypes.map((mt) => ({
                    value: String(mt.id),
                    label: `${mt.name} (${mt.unit})`,
                  }))}
                />
                <p className="mt-0.5 h-4 text-[11px] text-slate-400">&nbsp;</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  {logScope === 'group' ? 'ปริมาณรวมทั้งกลุ่ม' : 'ปริมาณที่ใช้'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={quantityUsed}
                  onChange={(e) => setQuantityUsed(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
                <p className="mt-0.5 h-4 truncate text-[11px] text-slate-400">
                  {logScope === 'group' && draftQty > 0 ? `เฉลี่ยแปลงละ ${formatQty(draftShareQty)}` : <>&nbsp;</>}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">ราคา/หน่วย</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
                <p className="mt-0.5 h-4 truncate text-[11px] text-slate-400">
                  {selectedMaterial ? 'ราคาล่าสุด (แก้ไขได้)' : <>&nbsp;</>}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">วันที่ซื้อ</label>
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
                <p className="mt-0.5 h-4 text-[11px] text-slate-400">&nbsp;</p>
              </div>
            </div>
            <div className="mt-2 flex items-end gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-600">หมายเหตุ (ถ้ามี)</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="เช่น ซื้อเพิ่มเพราะของเดิมไม่พอ"
                />
              </div>
              <button
                type="button"
                onClick={handleLogUsage}
                disabled={isSaving}
                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" /> บันทึก
              </button>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-700">ประวัติการบันทึก</p>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="w-24 px-3 py-2 text-left font-semibold">วันที่</th>
                    <th className="px-3 py-2 text-left font-semibold">วัสดุ</th>
                    <th className="w-24 px-3 py-2 text-right font-semibold">ปริมาณ</th>
                    <th className="w-28 px-3 py-2 text-right font-semibold">ราคา/หน่วย</th>
                    <th className="w-28 px-3 py-2 text-right font-semibold">รวม</th>
                    <th className="w-32 px-3 py-2 text-left font-semibold">หมายเหตุ</th>
                    <th className="w-10 px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logEntries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                        ยังไม่มีประวัติการบันทึก
                      </td>
                    </tr>
                  ) : (
                    logEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-3 py-2 text-slate-500">
                          {new Date(entry.purchase_date).toLocaleDateString('th-TH')}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {entry.material_types?.name || '-'}
                          {entry.plot_group && (
                            <div className="mt-0.5 flex items-center gap-1 text-[11px] font-normal text-indigo-600">
                              <Users className="h-3 w-3" />
                              ทั้งกลุ่ม {entry.plot_group.name} · เฉลี่ยแปลงละ{' '}
                              {formatQty(entry.share_quantity ?? entry.quantity_used / entry.plot_group.member_count)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatQty(entry.quantity_used)} {entry.material_types?.unit || ''}
                        </td>
                        <td className="px-3 py-2 text-right">฿{formatCurrency(entry.unit_price_at_use)}</td>
                        <td className="px-3 py-2 text-right font-semibold">
                          ฿{formatCurrency(entry.quantity_used * entry.unit_price_at_use)}
                        </td>
                        <td className="truncate px-3 py-2 text-slate-500">{entry.note || '-'}</td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteEntry(entry)}
                            disabled={isSaving}
                            className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
