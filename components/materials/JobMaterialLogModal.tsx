'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { formatCurrency } from '@/lib/currency'
import {
  deleteMaterialUsageEntry,
  getMaterialTypes,
  getMaterialUsageForJob,
  getMaterialVarianceForJob,
  logMaterialUsage,
} from '@/actions/material-actions'
import type { MaterialType, MaterialUsageLogEntry, MaterialVariance } from '@/lib/types/materials'

type Props = {
  isOpen: boolean
  onClose: () => void
  jobAssignmentId: string
  jobLabel: string
}

function today() {
  return new Date().toISOString().split('T')[0]
}

export default function JobMaterialLogModal({ isOpen, onClose, jobAssignmentId, jobLabel }: Props) {
  const [variance, setVariance] = useState<MaterialVariance[]>([])
  const [logEntries, setLogEntries] = useState<MaterialUsageLogEntry[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedMaterialId, setSelectedMaterialId] = useState('')
  const [quantityUsed, setQuantityUsed] = useState('')
  const [unitPrice, setUnitPrice] = useState('0')
  const [purchaseDate, setPurchaseDate] = useState(today())
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!isOpen) return
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, jobAssignmentId])

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const [varianceRows, logRows, types] = await Promise.all([
        getMaterialVarianceForJob(jobAssignmentId),
        getMaterialUsageForJob(jobAssignmentId),
        getMaterialTypes(),
      ])
      setVariance(varianceRows)
      setLogEntries(logRows)
      setMaterialTypes(types)
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
      })
      setSelectedMaterialId('')
      setQuantityUsed('')
      setUnitPrice('0')
      setNote('')
      setPurchaseDate(today())
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกการใช้วัสดุไม่สำเร็จ')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDeleteEntry(id: string) {
    if (!confirm('ยืนยันลบรายการนี้?')) return
    setIsSaving(true)
    setError(null)
    try {
      await deleteMaterialUsageEntry(id)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ลบรายการไม่สำเร็จ')
    } finally {
      setIsSaving(false)
    }
  }

  const totals = variance.reduce(
    (acc, row) => ({
      planned: acc.planned + row.planned_cost,
      actual: acc.actual + row.actual_cost,
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
            <p className="mb-2 text-sm font-semibold text-slate-700">งบประมาณเทียบกับที่ใช้จริง</p>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">วัสดุ</th>
                    <th className="px-3 py-2 text-right font-semibold">งบ (ปริมาณ)</th>
                    <th className="px-3 py-2 text-right font-semibold">ใช้จริง (ปริมาณ)</th>
                    <th className="px-3 py-2 text-right font-semibold">งบประมาณ</th>
                    <th className="px-3 py-2 text-right font-semibold">ใช้จริง</th>
                    <th className="px-3 py-2 text-right font-semibold">ผลต่าง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {variance.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                        งานนี้ยังไม่มีรายการวัสดุที่ตั้งงบไว้
                      </td>
                    </tr>
                  ) : (
                    variance.map((row) => {
                      const isOverBudget = row.difference > 0
                      const isUnplanned = row.planned_quantity === 0 && row.used_quantity > 0
                      return (
                        <tr key={row.material_type_id} className={isUnplanned ? 'bg-amber-50/60' : ''}>
                          <td className="px-3 py-2 font-medium text-slate-800">
                            {row.material_name}
                            {isUnplanned && (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                ไม่ได้ตั้งงบไว้
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {row.planned_quantity} {row.unit}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {row.used_quantity} {row.unit}
                          </td>
                          <td className="px-3 py-2 text-right">฿{formatCurrency(row.planned_cost)}</td>
                          <td className="px-3 py-2 text-right">฿{formatCurrency(row.actual_cost)}</td>
                          <td className={`px-3 py-2 text-right font-semibold ${isOverBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                            {isOverBudget ? '+' : ''}฿{formatCurrency(row.difference)}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
                {variance.length > 0 && (
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
                <label className="mb-1 block text-xs font-medium text-slate-600">ปริมาณที่ใช้</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={quantityUsed}
                  onChange={(e) => setQuantityUsed(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
                <p className="mt-0.5 h-4 text-[11px] text-slate-400">&nbsp;</p>
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
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">วันที่</th>
                    <th className="px-3 py-2 text-left font-semibold">วัสดุ</th>
                    <th className="px-3 py-2 text-right font-semibold">ปริมาณ</th>
                    <th className="px-3 py-2 text-right font-semibold">ราคา/หน่วย</th>
                    <th className="px-3 py-2 text-right font-semibold">รวม</th>
                    <th className="px-3 py-2 text-left font-semibold">หมายเหตุ</th>
                    <th className="px-3 py-2 w-10"></th>
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
                        <td className="px-3 py-2 font-medium text-slate-800">{entry.material_types?.name || '-'}</td>
                        <td className="px-3 py-2 text-right">
                          {entry.quantity_used} {entry.material_types?.unit || ''}
                        </td>
                        <td className="px-3 py-2 text-right">฿{formatCurrency(entry.unit_price_at_use)}</td>
                        <td className="px-3 py-2 text-right font-semibold">
                          ฿{formatCurrency(entry.quantity_used * entry.unit_price_at_use)}
                        </td>
                        <td className="px-3 py-2 text-slate-500">{entry.note || '-'}</td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteEntry(entry.id)}
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
