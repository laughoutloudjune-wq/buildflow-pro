'use client'

import { useState } from 'react'
import { CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { bulkUpsertBoqMaterialItems, parseBoqMaterialImportFile } from '@/actions/material-actions'
import type { BoqMaterialImportPreview } from '@/lib/types/materials'

type Step = 'select' | 'preview' | 'done'

/** Imports a sheet of "house model | boq job | material | quantity | waste %"
 * rows into boq_material_items across many house models/jobs at once - the
 * bulk alternative to entering each job's materials by hand. Modeled on
 * MaterialImportModal.tsx: same parse-then-preview-then-commit shape. See
 * BOQ_CONTROL_PLAN.md 7.1 for the matching rules. */
export default function BoqMaterialImportModal({
  isOpen,
  onClose,
  onImported,
}: {
  isOpen: boolean
  onClose: () => void
  onImported: () => void
}) {
  const [step, setStep] = useState<Step>('select')
  const [isBusy, setIsBusy] = useState(false)
  const [preview, setPreview] = useState<BoqMaterialImportPreview | null>(null)
  const [result, setResult] = useState<{ inserted: number; updated: number } | null>(null)
  const toast = useToast()

  function reset() {
    setStep('select')
    setPreview(null)
    setResult(null)
  }

  function handleClose() {
    if (isBusy) return
    reset()
    onClose()
  }

  async function handleFileSelect(file: File | undefined) {
    if (!file) return
    setIsBusy(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const parsed = await parseBoqMaterialImportFile(formData)
      if (parsed.rows.length === 0 && parsed.skipped.length === 0) {
        toast.error('ไม่พบข้อมูลในไฟล์นี้')
        return
      }
      setPreview(parsed)
      setStep('preview')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'อ่านไฟล์ไม่สำเร็จ')
    } finally {
      setIsBusy(false)
    }
  }

  function handleConfirmImport() {
    if (!preview || preview.rows.length === 0) return
    setIsBusy(true)
    bulkUpsertBoqMaterialItems(
      preview.rows.map((r) => ({
        boqId: r.boqId,
        materialTypeId: r.materialTypeId,
        plannedQuantity: r.quantity,
        wastePercent: r.wastePercent,
      }))
    )
      .then((res) => {
        setResult(res)
        setStep('done')
        onImported()
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'นำเข้าไม่สำเร็จ'))
      .finally(() => setIsBusy(false))
  }

  const insertCount = preview?.rows.filter((r) => r.status === 'insert').length ?? 0
  const updateCount = preview?.rows.filter((r) => r.status === 'update').length ?? 0

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="นำเข้าวัสดุ BOQ จากไฟล์ Excel" panelClassName="max-w-3xl">
      {step === 'select' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            รองรับไฟล์ .xlsx ที่มีคอลัมน์หัวตาราง (ภาษาไทยหรืออังกฤษก็ได้):{' '}
            <span className="font-medium text-slate-700">house model / แบบบ้าน</span>,{' '}
            <span className="font-medium text-slate-700">boq job / รายการงาน</span>,{' '}
            <span className="font-medium text-slate-700">material / วัสดุ</span>,{' '}
            <span className="font-medium text-slate-700">quantity / จำนวน</span> และ{' '}
            <span className="font-medium text-slate-700">waste % / เผื่อ</span> (ไม่บังคับ)
          </p>
          <p className="text-xs text-slate-400">
            ชื่อแบบบ้าน รายการงาน และวัสดุ ต้องตรงกับที่มีอยู่ในระบบ (จับคู่แบบเป๊ะก่อน แล้วจึงลองแบบไม่สนตัวพิมพ์เล็ก-ใหญ่/เว้นวรรค) - ถ้าไม่พบจะข้ามแถวนั้นและบอกเหตุผลในหน้าพรีวิว
          </p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center transition hover:border-indigo-300 hover:bg-indigo-50/40">
            {isBusy ? (
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            ) : (
              <FileSpreadsheet className="h-8 w-8 text-slate-400" />
            )}
            <span className="text-sm font-medium text-slate-700">{isBusy ? 'กำลังอ่านไฟล์...' : 'เลือกไฟล์ .xlsx'}</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              disabled={isBusy}
              onChange={(e) => handleFileSelect(e.target.files?.[0])}
            />
          </label>
          <div className="flex justify-end border-t pt-4">
            <Button type="button" variant="secondary" onClick={handleClose}>
              ยกเลิก
            </Button>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              เพิ่มใหม่ <span className="font-semibold">{insertCount}</span> รายการ
            </span>
            <span className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
              อัปเดต <span className="font-semibold">{updateCount}</span> รายการ
            </span>
            {preview.skipped.length > 0 && (
              <span className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                ข้าม <span className="font-semibold">{preview.skipped.length}</span> แถว
              </span>
            )}
          </div>

          {preview.rows.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">รายการที่จะนำเข้า</label>
              <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">แบบบ้าน</th>
                      <th className="px-3 py-2 font-medium">รายการงาน</th>
                      <th className="px-3 py-2 font-medium">วัสดุ</th>
                      <th className="px-3 py-2 text-right font-medium">จำนวน</th>
                      <th className="px-3 py-2 text-right font-medium">เผื่อ %</th>
                      <th className="px-3 py-2 font-medium">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.rows.map((row) => (
                      <tr key={`${row.boqId}-${row.materialTypeId}`}>
                        <td className="max-w-[140px] truncate px-3 py-1.5 text-slate-700" title={row.houseModelName}>
                          {row.houseModelName}
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-1.5 text-slate-700" title={row.boqJobName}>
                          {row.boqJobName}
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-1.5 text-slate-700" title={row.materialName}>
                          {row.materialName}
                        </td>
                        <td className="px-3 py-1.5 text-right text-slate-700">{row.quantity.toLocaleString('th-TH')}</td>
                        <td className="px-3 py-1.5 text-right text-slate-500">{row.wastePercent || 0}</td>
                        <td className="px-3 py-1.5">
                          {row.status === 'insert' ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">ใหม่</span>
                          ) : (
                            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700" title={`เดิม ${row.previousQuantity}`}>
                              อัปเดต ({row.previousQuantity} → {row.quantity})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.skipped.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">แถวที่ข้าม</label>
              <div className="max-h-48 overflow-auto rounded-lg border border-amber-200 bg-amber-50/40">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-amber-50 text-amber-700">
                    <tr>
                      <th className="px-3 py-2 font-medium">แถวที่</th>
                      <th className="px-3 py-2 font-medium">แบบบ้าน</th>
                      <th className="px-3 py-2 font-medium">รายการงาน</th>
                      <th className="px-3 py-2 font-medium">วัสดุ</th>
                      <th className="px-3 py-2 font-medium">เหตุผล</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {preview.skipped.map((row) => (
                      <tr key={row.line}>
                        <td className="px-3 py-1.5 text-amber-800">{row.line}</td>
                        <td className="max-w-[120px] truncate px-3 py-1.5 text-slate-600">{row.houseModelName}</td>
                        <td className="max-w-[140px] truncate px-3 py-1.5 text-slate-600">{row.boqJobName}</td>
                        <td className="max-w-[140px] truncate px-3 py-1.5 text-slate-600">{row.materialName}</td>
                        <td className="px-3 py-1.5 text-amber-800">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={reset} disabled={isBusy}>
              เลือกไฟล์ใหม่
            </Button>
            <Button type="button" onClick={handleConfirmImport} disabled={isBusy || preview.rows.length === 0}>
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {isBusy ? 'กำลังนำเข้า...' : `นำเข้า ${preview.rows.length} รายการ`}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <p className="text-lg font-semibold text-slate-800">นำเข้าเสร็จแล้ว</p>
            <div className="flex gap-6 text-sm text-slate-600">
              <div>
                <div className="text-2xl font-bold text-emerald-600">{result.inserted}</div>
                <div>เพิ่มใหม่</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-indigo-600">{result.updated}</div>
                <div>อัปเดต</div>
              </div>
            </div>
          </div>
          <div className="flex justify-end border-t pt-4">
            <Button type="button" onClick={handleClose}>
              เสร็จสิ้น
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
