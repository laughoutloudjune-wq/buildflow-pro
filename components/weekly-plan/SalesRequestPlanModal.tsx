'use client'

import { useState, useTransition } from 'react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { addSalesRequestToPlan, type WeeklyPlanData, type WeeklyPlanSalesRequest } from '@/actions/weekly-plan-actions'
import { addDaysStr, formatThaiDay } from '@/lib/weekly-plan'

const DAY_LABELS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.']

/** Asks the construction side who looks after a sales request, which crew does it and on which day, then plans it. */
export default function SalesRequestPlanModal({
  data,
  request,
  weekStart,
  today,
  onClose,
  onAdded,
}: {
  data: WeeklyPlanData
  request: WeeklyPlanSalesRequest
  weekStart: string
  today: string
  onClose: () => void
  onAdded: () => void
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i))
  // Default day: the date sales needs it if that is inside the week, else today if inside, else Monday.
  const initial = request.neededBy && days.includes(request.neededBy) ? days.indexOf(request.neededBy) : days.includes(today) ? days.indexOf(today) : 0
  const [day, setDay] = useState<number | null>(initial)
  const [ownerId, setOwnerId] = useState('')
  const [contractorId, setContractorId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const res = await addSalesRequestToPlan(request.id, weekStart, { ownerId: ownerId || null, contractorId: contractorId || null, dayIndex: day })
      if ('error' in res) setError(res.error)
      else onAdded()
    })
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="ใส่คำขอฝ่ายขายในแผน"
      panelClassName="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            ยกเลิก
          </Button>
          <Button onClick={submit} disabled={pending}>
            เพิ่มเข้าแผน
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="font-medium text-slate-800">{request.title}</p>
          <p className="text-xs text-slate-500">
            แปลง {request.plotName}
            {request.requestNo ? ` · ${request.requestNo}` : ''}
            {request.neededBy ? ` · ฝ่ายขายต้องการภายใน ${formatThaiDay(request.neededBy)}` : ''}
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block font-medium text-slate-700">ใครดูแล</span>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="">ยังไม่เลือก</option>
            {data.owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-slate-700">ช่างที่ทำ</span>
          <select value={contractorId} onChange={(e) => setContractorId(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="">ยังไม่เลือก</option>
            {data.contractors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="mb-1 block font-medium text-slate-700">ทำวันไหน</span>
          <div className="flex flex-wrap gap-1.5">
            {days.map((d, i) => (
              <button
                key={d}
                type="button"
                aria-pressed={day === i}
                onClick={() => setDay(day === i ? null : i)}
                className={`rounded-lg border px-2.5 py-1.5 text-center text-xs ${day === i ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                <span className="block">{DAY_LABELS[i]}</span>
                <span className="block tabular-nums">{formatThaiDay(d)}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">ยังไม่รู้วัน ไม่ต้องเลือกก็ได้</p>
        </div>
        {error && <p className="text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}
