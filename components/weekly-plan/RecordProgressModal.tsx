'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { recordWeeklyPlanActual, type WeeklyPlanItem } from '@/actions/weekly-plan-actions'
import { addDaysStr, formatThaiDay, latestPct, WEEK_DAY_LABELS } from '@/lib/weekly-plan'
import { todayInBangkok } from '@/lib/utils'

/** Quick entry of real progress for one plan row: pick the day, type the cumulative % done. */
export default function RecordProgressModal({ item, onClose }: { item: WeeklyPlanItem; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()

  // Default to today when it falls inside this row's week, otherwise the last day filled in (or Monday).
  const today = todayInBangkok()
  const todayIdx = Array.from({ length: 7 }, (_, d) => addDaysStr(item.weekStart, d)).indexOf(today)
  const [day, setDay] = useState(todayIdx >= 0 ? todayIdx : (latestPct(item.actualPct)?.day ?? 0))
  const [value, setValue] = useState(item.actualPct[day] == null ? '' : String(item.actualPct[day]))
  const [error, setError] = useState<string | null>(null)
  const latest = latestPct(item.actualPct)

  const pickDay = (d: number) => {
    setDay(d)
    setValue(item.actualPct[d] == null ? '' : String(item.actualPct[d]))
  }

  const save = () => {
    const n = value.trim() === '' ? null : Number(value)
    if (n != null && (Number.isNaN(n) || n < 0 || n > 100)) {
      setError('กรอกความคืบหน้า 0-100%')
      return
    }
    startTransition(async () => {
      const res = await recordWeeklyPlanActual(item.id, day, n)
      if ('error' in res) setError(res.error)
      else {
        toast.success('บันทึกความคืบหน้าแล้ว')
        onClose()
        router.refresh()
      }
    })
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`บันทึกความคืบหน้า: ${item.title}${item.plotName ? ` · แปลง ${item.plotName}` : ''}`}
      panelClassName="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            ยกเลิก
          </Button>
          <Button onClick={save} disabled={pending}>
            บันทึก
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">
          {latest ? `ล่าสุดบันทึกไว้ ${latest.value}% (วัน${WEEK_DAY_LABELS[latest.day]}) · ` : 'ยังไม่เคยบันทึก · '}
          กรอกเป็น % สะสมของงานทั้งหมด ณ สิ้นวัน
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="วัน">
          {WEEK_DAY_LABELS.map((label, d) => (
            <button
              key={d}
              type="button"
              onClick={() => pickDay(d)}
              aria-pressed={day === d}
              title={formatThaiDay(addDaysStr(item.weekStart, d))}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                day === d ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              {label}
              {item.actualPct[d] != null && <span className="ml-1 text-xs font-normal text-slate-500">{item.actualPct[d]}%</span>}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">งานเสร็จสะสม (%) วันที่ {formatThaiDay(addDaysStr(item.weekStart, day))}</span>
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            autoFocus
          />
        </label>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}
