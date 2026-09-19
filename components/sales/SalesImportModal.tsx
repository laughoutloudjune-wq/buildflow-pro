'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import {
  importSalesRecords,
  parseSalesImportFile,
  type SalesImportCommitRow,
  type SalesImportPreview,
  type SalesImportResult,
  type SalesImportRow,
} from '@/actions/sales-actions'

type Step = 'select' | 'configure' | 'done'

type RowState = { plotId: string | null; statusCode: string | null; included: boolean }

function isRowResolved(row: SalesImportRow, state: RowState): boolean {
  return Boolean(state.plotId) && Boolean(state.statusCode)
}

export default function SalesImportModal({
  isOpen,
  onClose,
  projectId,
  onImported,
}: {
  isOpen: boolean
  onClose: () => void
  projectId: string
  onImported: () => void
}) {
  const [step, setStep] = useState<Step>('select')
  const [isBusy, setIsBusy] = useState(false)
  const [preview, setPreview] = useState<SalesImportPreview | null>(null)
  const [rowStates, setRowStates] = useState<Record<number, RowState>>({})
  const [result, setResult] = useState<SalesImportResult | null>(null)
  const toast = useToast()

  function reset() {
    setStep('select')
    setPreview(null)
    setRowStates({})
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
      formData.append('project_id', projectId)
      const parsed = await parseSalesImportFile(formData)
      if (parsed.rows.length === 0) {
        toast.error('ไม่พบแถวข้อมูลที่ใช้ได้ในไฟล์นี้')
        return
      }
      setPreview(parsed)
      setRowStates(
        Object.fromEntries(
          parsed.rows.map((row) => [
            row.rowIndex,
            { plotId: row.plotId, statusCode: row.statusCode, included: !row.alreadyHasDeal },
          ])
        )
      )
      setStep('configure')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'อ่านไฟล์ไม่สำเร็จ')
    } finally {
      setIsBusy(false)
    }
  }

  function updateRowState(rowIndex: number, patch: Partial<RowState>) {
    setRowStates((prev) => ({ ...prev, [rowIndex]: { ...prev[rowIndex], ...patch } }))
  }

  const readyRows = useMemo(() => {
    if (!preview) return []
    return preview.rows.filter((row) => rowStates[row.rowIndex]?.included && isRowResolved(row, rowStates[row.rowIndex]))
  }, [preview, rowStates])

  const unresolvedCount = useMemo(() => {
    if (!preview) return 0
    return preview.rows.filter((row) => rowStates[row.rowIndex]?.included && !isRowResolved(row, rowStates[row.rowIndex])).length
  }, [preview, rowStates])

  function handleConfirmImport() {
    if (!preview) return
    setIsBusy(true)
    const items: SalesImportCommitRow[] = readyRows.map((row) => {
      const state = rowStates[row.rowIndex]
      return {
        plotId: state.plotId as string,
        statusCode: state.statusCode as string,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        salePrice: row.salePrice,
        bookedAt: row.bookedAt,
        contractAt: row.contractAt,
        inspectionAt: row.inspectionAt,
        transferAt: row.transferAt,
        note: row.note,
      }
    })
    importSalesRecords(items)
      .then((res) => {
        setResult(res)
        setStep('done')
        onImported()
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'นำเข้าไม่สำเร็จ'))
      .finally(() => setIsBusy(false))
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="นำเข้าข้อมูลการขายเดิม" panelClassName="max-w-4xl">
      {step === 'select' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            รองรับไฟล์ .xlsx / .csv ที่มีคอลัมน์เรียงตามนี้ (แถวแรกเป็นหัวตาราง):
          </p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <span className="font-medium text-slate-700">A</span> ชื่อแปลง/บ้านเลขที่ ·{' '}
            <span className="font-medium text-slate-700">B</span> ชื่อลูกค้า ·{' '}
            <span className="font-medium text-slate-700">C</span> เบอร์โทร ·{' '}
            <span className="font-medium text-slate-700">D</span> สถานะ ·{' '}
            <span className="font-medium text-slate-700">E</span> ราคาขาย ·{' '}
            <span className="font-medium text-slate-700">F</span> วันที่จอง ·{' '}
            <span className="font-medium text-slate-700">G</span> วันที่ทำสัญญา ·{' '}
            <span className="font-medium text-slate-700">H</span> วันที่นัดตรวจ ·{' '}
            <span className="font-medium text-slate-700">I</span> วันที่โอน ·{' '}
            <span className="font-medium text-slate-700">J</span> หมายเหตุ
          </div>
          <p className="text-xs text-slate-400">
            ชื่อแปลงและสถานะต้องตรงกับที่มีอยู่ในระบบ — แถวที่จับคู่ไม่ได้จะให้เลือกเองในขั้นตอนถัดไป ไม่มีการเดาให้อัตโนมัติ
          </p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center transition hover:border-indigo-300 hover:bg-indigo-50/40">
            {isBusy ? (
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            ) : (
              <FileSpreadsheet className="h-8 w-8 text-slate-400" />
            )}
            <span className="text-sm font-medium text-slate-700">{isBusy ? 'กำลังอ่านไฟล์...' : 'เลือกไฟล์ .xlsx หรือ .csv'}</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
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
        <div className="space-y-4">
          <div className="rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
            พบ <span className="font-semibold">{preview.rows.length}</span> แถว · พร้อมนำเข้า{' '}
            <span className="font-semibold">{readyRows.length}</span> แถว
            {unresolvedCount > 0 && (
              <span className="ml-1 text-amber-700">· ยังจับคู่ไม่ได้ {unresolvedCount} แถว (เลือกเองด้านล่าง)</span>
            )}
          </div>

          <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2 py-2 font-medium">นำเข้า</th>
                  <th className="px-2 py-2 font-medium">แถว</th>
                  <th className="px-2 py-2 font-medium">แปลง</th>
                  <th className="px-2 py-2 font-medium">ลูกค้า</th>
                  <th className="px-2 py-2 font-medium">สถานะ</th>
                  <th className="px-2 py-2 text-right font-medium">ราคา</th>
                  <th className="px-2 py-2 font-medium">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.rows.map((row) => {
                  const state = rowStates[row.rowIndex]
                  if (!state) return null
                  const resolved = isRowResolved(row, state)
                  return (
                    <tr key={row.rowIndex} className={!resolved ? 'bg-amber-50/60' : row.alreadyHasDeal ? 'bg-slate-50 text-slate-400' : ''}>
                      <td className="px-2 py-1.5 align-top">
                        <input
                          type="checkbox"
                          checked={state.included}
                          onChange={(e) => updateRowState(row.rowIndex, { included: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </td>
                      <td className="px-2 py-1.5 align-top text-slate-400">{row.rowIndex}</td>
                      <td className="px-2 py-1.5 align-top">
                        {row.plotId ? (
                          <span className="text-slate-700">{row.plotNameRaw}</span>
                        ) : (
                          <div>
                            <div className="mb-1 flex items-center gap-1 text-amber-700">
                              <AlertTriangle className="h-3 w-3" /> &ldquo;{row.plotNameRaw}&rdquo; ไม่พบ
                            </div>
                            <select
                              value={state.plotId || ''}
                              onChange={(e) => updateRowState(row.rowIndex, { plotId: e.target.value || null })}
                              className="w-40 text-xs"
                            >
                              <option value="">-- เลือกแปลง --</option>
                              {preview.plotOptions.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        {row.alreadyHasDeal && (
                          <div className="mt-1 text-[11px] text-slate-400">มีข้อมูลการขายอยู่แล้ว - จะข้าม</div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top text-slate-600">
                        {row.customerName || '—'}
                        {row.customerPhone && <div className="text-[11px] text-slate-400">{row.customerPhone}</div>}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        {row.statusCode ? (
                          <span className="text-slate-700">{row.statusRaw}</span>
                        ) : (
                          <div>
                            <div className="mb-1 flex items-center gap-1 text-amber-700">
                              <AlertTriangle className="h-3 w-3" /> &ldquo;{row.statusRaw || '(ว่าง)'}&rdquo; ไม่พบ
                            </div>
                            <select
                              value={state.statusCode || ''}
                              onChange={(e) => updateRowState(row.rowIndex, { statusCode: e.target.value || null })}
                              className="w-32 text-xs"
                            >
                              <option value="">-- เลือกสถานะ --</option>
                              {preview.statusOptions.map((s) => (
                                <option key={s.code} value={s.code}>{s.label}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top text-right text-slate-600">
                        {row.salePrice != null ? formatCurrency(row.salePrice) : '—'}
                      </td>
                      <td className="max-w-[160px] truncate px-2 py-1.5 align-top text-slate-400" title={row.note}>
                        {row.note || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={reset} disabled={isBusy}>
              เลือกไฟล์ใหม่
            </Button>
            <Button type="button" onClick={handleConfirmImport} disabled={isBusy || readyRows.length === 0}>
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {isBusy ? 'กำลังนำเข้า...' : `นำเข้า ${readyRows.length} แถว`}
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
                <div>นำเข้าสำเร็จ</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-400">{result.skipped}</div>
                <div>ข้าม (มีข้อมูลอยู่แล้ว)</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-500">{result.errors.length}</div>
                <div>ผิดพลาด</div>
              </div>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {result.errors.map((e, i) => (
                <div key={i}>{e.plotId}: {e.message}</div>
              ))}
            </div>
          )}
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
