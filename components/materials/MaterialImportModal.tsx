'use client'

import { useState } from 'react'
import { CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import {
  importMaterialTypes,
  parseMaterialImportFile,
  type MaterialImportItem,
  type MaterialImportPreview,
  type MaterialImportResult,
} from '@/actions/material-actions'

type Step = 'select' | 'configure' | 'done'

export default function MaterialImportModal({
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
  const [preview, setPreview] = useState<MaterialImportPreview | null>(null)
  const [unitByCategory, setUnitByCategory] = useState<Record<string, string>>({})
  const [onDuplicate, setOnDuplicate] = useState<'update' | 'skip'>('update')
  const [result, setResult] = useState<MaterialImportResult | null>(null)
  const toast = useToast()

  function reset() {
    setStep('select')
    setPreview(null)
    setUnitByCategory({})
    setOnDuplicate('update')
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
      const parsed = await parseMaterialImportFile(formData)
      if (parsed.rows.length === 0) {
        toast.error('ไม่พบรายการวัสดุที่ใช้ได้ในไฟล์นี้')
        return
      }
      setPreview(parsed)
      setUnitByCategory(Object.fromEntries(parsed.categories.map((c) => [c.name, ''])))
      setStep('configure')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'อ่านไฟล์ไม่สำเร็จ')
    } finally {
      setIsBusy(false)
    }
  }

  function handleConfirmImport() {
    if (!preview) return
    setIsBusy(true)
    const items: MaterialImportItem[] = preview.rows.map((row) => ({
      name: row.name,
      category: row.category,
      price: row.price,
      unit: unitByCategory[row.category] || '',
    }))
    importMaterialTypes(items, onDuplicate)
      .then((res) => {
        setResult(res)
        setStep('done')
        onImported()
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'นำเข้าไม่สำเร็จ'))
      .finally(() => setIsBusy(false))
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="นำเข้ารายการวัสดุจากไฟล์ Excel" panelClassName="max-w-2xl">
      {step === 'select' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            รองรับไฟล์ .xlsx ที่มีคอลัมน์เรียงตามนี้: <span className="font-medium text-slate-700">คอลัมน์ A = ชื่อวัสดุ</span>,{' '}
            <span className="font-medium text-slate-700">คอลัมน์ B = ราคา</span>,{' '}
            <span className="font-medium text-slate-700">คอลัมน์ C = หมวดหมู่</span> (แถวแรกเป็นหัวตาราง)
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

      {step === 'configure' && preview && (
        <div className="space-y-5">
          <div className="rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
            พบ <span className="font-semibold">{preview.rows.length}</span> รายการ ใน{' '}
            <span className="font-semibold">{preview.categories.length}</span> หมวดหมู่
            {preview.skippedRows > 0 && <> · ข้าม {preview.skippedRows} แถว (ไม่มีชื่อ/ราคาไม่ถูกต้อง/เป็นหัวข้อหมวดหมู่)</>}
            {preview.duplicateNamesInFile > 0 && <> · ชื่อซ้ำในไฟล์ {preview.duplicateNamesInFile} รายการ (ใช้แถวล่าสุด)</>}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">หน่วยของแต่ละหมวดหมู่</label>
              <span className="text-xs text-slate-400">เว้นว่างได้ - จะใช้ &quot;unit&quot; ชั่วคราวและแก้ทีหลังได้</span>
            </div>
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3">
              {preview.categories.map((cat) => (
                <div key={cat.name} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1 truncate text-sm text-slate-700" title={cat.name}>
                    {cat.name} <span className="text-xs text-slate-400">({cat.count})</span>
                  </div>
                  <input
                    value={unitByCategory[cat.name] || ''}
                    onChange={(e) => setUnitByCategory((prev) => ({ ...prev, [cat.name]: e.target.value }))}
                    className="w-32 shrink-0 text-sm"
                    placeholder="เช่น ถุง, ก้อน"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">ถ้าชื่อวัสดุซ้ำกับที่มีอยู่แล้วในระบบ</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="flex flex-1 cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50/60">
                <input type="radio" name="onDuplicate" checked={onDuplicate === 'update'} onChange={() => setOnDuplicate('update')} className="mt-0.5" />
                <span>
                  <span className="font-medium text-slate-800">อัปเดตทับของเดิม</span>
                  <br />
                  <span className="text-xs text-slate-500">ราคาและหมวดหมู่จะถูกแทนที่ด้วยค่าจากไฟล์</span>
                </span>
              </label>
              <label className="flex flex-1 cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50/60">
                <input type="radio" name="onDuplicate" checked={onDuplicate === 'skip'} onChange={() => setOnDuplicate('skip')} className="mt-0.5" />
                <span>
                  <span className="font-medium text-slate-800">ข้ามรายการที่ซ้ำ</span>
                  <br />
                  <span className="text-xs text-slate-500">ของเดิมในระบบจะไม่ถูกแก้ไข</span>
                </span>
              </label>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">ตัวอย่าง (10 รายการแรก)</label>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">ชื่อ</th>
                    <th className="px-3 py-2 font-medium">หมวดหมู่</th>
                    <th className="px-3 py-2 font-medium">หน่วย</th>
                    <th className="px-3 py-2 text-right font-medium">ราคา</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.rows.slice(0, 10).map((row) => (
                    <tr key={row.name}>
                      <td className="max-w-[220px] truncate px-3 py-1.5 text-slate-700" title={row.name}>
                        {row.name}
                      </td>
                      <td className="px-3 py-1.5 text-slate-500">{row.category}</td>
                      <td className="px-3 py-1.5 text-slate-500">{unitByCategory[row.category] || 'unit'}</td>
                      <td className="px-3 py-1.5 text-right text-slate-700">{row.price.toLocaleString('th-TH')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={reset} disabled={isBusy}>
              เลือกไฟล์ใหม่
            </Button>
            <Button type="button" onClick={handleConfirmImport} disabled={isBusy}>
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
              <div>
                <div className="text-2xl font-bold text-slate-400">{result.skipped}</div>
                <div>ข้าม</div>
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
