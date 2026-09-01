'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { createStockAdjustment } from '@/actions/stock-actions'

const numberFormat = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 })

function friendlyError(message: string): string {
  if (message === 'No permission to adjust stock') return 'คุณไม่มีสิทธิ์ปรับยอดสต็อก'
  if (message === 'Counted quantity must be zero or more') return 'จำนวนที่นับได้ต้องไม่ติดลบ'
  return message
}

export default function AdjustStockModal({
  isOpen,
  onClose,
  onSuccess,
  materialId,
  materialName,
  unit,
  currentQty,
}: {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  materialId: number
  materialName: string
  unit: string
  currentQty: number
}) {
  const [countedQty, setCountedQty] = useState('')
  const [note, setNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (isOpen) {
      setCountedQty(String(currentQty))
      setNote('')
    }
  }, [isOpen, currentQty])

  const countedNumber = Number(countedQty)
  const isValidQty = countedQty.trim() !== '' && Number.isFinite(countedNumber) && countedNumber >= 0
  const delta = isValidQty ? countedNumber - currentQty : 0
  const canSubmit = isValidQty && delta !== 0 && note.trim() !== '' && !isSubmitting

  async function handleSubmit() {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      await createStockAdjustment({ material_type_id: materialId, counted_qty: countedNumber, note })
      toast.success('บันทึกการปรับยอดแล้ว')
      onSuccess()
      onClose()
    } catch (error) {
      toast.error(friendlyError(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`ปรับยอดสต็อก - ${materialName}`} panelClassName="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          ใช้เมื่อยอดนับจริงหน้างานไม่ตรงกับระบบ - บันทึกทันที ไม่ต้องรออนุมัติ แต่ต้องระบุเหตุผลทุกครั้งเพื่อการตรวจสอบย้อนหลัง
        </p>

        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">ยอดในระบบตอนนี้: </span>
          <span className="font-mono font-medium text-slate-800">
            {numberFormat.format(currentQty)} {unit}
          </span>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">จำนวนที่นับได้จริง</label>
          <input
            type="number"
            min="0"
            step="any"
            value={countedQty}
            onChange={(e) => setCountedQty(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            autoFocus
          />
        </div>

        {isValidQty && delta !== 0 && (
          <div className={`rounded-lg px-3 py-2 text-sm font-medium ${delta > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {delta > 0 ? 'เพิ่มขึ้น' : 'ลดลง'} {numberFormat.format(Math.abs(delta))} {unit}
          </div>
        )}
        {isValidQty && delta === 0 && <p className="text-sm text-slate-400">จำนวนตรงกับระบบอยู่แล้ว ไม่ต้องปรับยอด</p>}

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">เหตุผล (ต้องระบุ)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            placeholder="เช่น นับสต็อกประจำเดือน, วัสดุเสียหาย, ของหาย..."
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึกการปรับยอด'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
