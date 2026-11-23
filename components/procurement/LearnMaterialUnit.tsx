'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/ui/Toast'
import { learnMaterialUnit } from '@/actions/procurement/unit-conversions'

/**
 * Under a PO line whose material has no unit yet (the placeholder "unit"),
 * after purchasing typed the unit the supplier sells in: the system remembers
 * it, once, so the material never asks again.
 *
 *  - "หน่วยที่นับของชิ้นเดียว": this is the unit stock and the BOQ count in.
 *  - "หน่วยแพ็ค": the order is in a bigger pack, so ask "1 ลัง = ? ตัว" (big
 *    unit first, สลับ flips it) and remember both the small unit and the pack.
 *
 * Never blocks saving the order; skipping just asks again next time.
 */
export default function LearnMaterialUnit({
  materialTypeId,
  unit,
  onLearned,
  compact = false,
}: {
  materialTypeId: number
  /** The unit typed on the PO line. */
  unit: string
  /** Called with the material's new base unit (and the pack unit conversion, if any). */
  onLearned: (baseUnit: string) => void
  compact?: boolean
}) {
  const toast = useToast()
  const u = unit.trim()
  const [kind, setKind] = useState<'base' | 'pack'>('base')
  const [smallUnit, setSmallUnit] = useState('')
  const [countText, setCountText] = useState('')
  const [bigFirst, setBigFirst] = useState(true)
  const [pending, startTransition] = useTransition()

  if (!materialTypeId || !u || u.toLowerCase() === 'unit') return null

  const save = () => {
    startTransition(async () => {
      if (kind === 'base') {
        const res = await learnMaterialUnit(materialTypeId, u)
        if ('error' in res) toast.error(res.error)
        else {
          toast.success(`จำไว้แล้ว หน่วยของวัสดุนี้คือ ${u}`)
          onLearned(res.unit)
        }
        return
      }
      const small = smallUnit.trim()
      const n = Number(countText)
      if (!small) {
        toast.error('ใส่หน่วยเล็ก เช่น ตัว')
        return
      }
      if (!(n > 0)) {
        toast.error('ใส่จำนวนที่มากกว่า 0')
        return
      }
      const smallPerPack = bigFirst ? n : Math.round((1 / n) * 1e12) / 1e12
      const res = await learnMaterialUnit(materialTypeId, small, { packUnit: u, smallPerPack })
      if ('error' in res) toast.error(res.error)
      else {
        toast.success(`จำไว้แล้ว 1 ${u} = ${smallPerPack.toLocaleString('th-TH', { maximumFractionDigits: 4 })} ${small}`)
        onLearned(res.unit)
      }
    })
  }

  const smallInput = (
    <input
      value={smallUnit}
      onChange={(e) => setSmallUnit(e.target.value)}
      placeholder="ตัว"
      aria-label="หน่วยเล็ก"
      className="w-20 rounded border border-slate-300 px-1.5 py-0.5"
    />
  )

  return (
    <div className={`rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 ${compact ? '' : 'mt-1'}`}>
      <p className="font-medium">วัสดุนี้ยังไม่มีหน่วย ระบบจะจำจากใบสั่งซื้อนี้ ({u} คือ…)</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700">
        <label className="inline-flex items-center gap-1">
          <input type="radio" checked={kind === 'base'} onChange={() => setKind('base')} />
          หน่วยที่นับ (ชิ้นเดียว)
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="radio" checked={kind === 'pack'} onChange={() => setKind('pack')} />
          หน่วยแพ็ค (ลัง/มัด/กล่อง)
        </label>
      </div>
      {kind === 'pack' && (
        <span className="mt-1 inline-flex flex-wrap items-center gap-1.5 text-slate-700">
          1 {bigFirst ? u : smallInput}
          =
          <input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={countText}
            onChange={(e) => setCountText(e.target.value)}
            aria-label="จำนวน"
            className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-right tabular-nums"
          />
          {bigFirst ? smallInput : u}
          <button type="button" onClick={() => setBigFirst((v) => !v)} className="text-indigo-600 underline">
            สลับ
          </button>
        </span>
      )}
      <div className="mt-1">
        <button type="button" onClick={save} disabled={pending} className="rounded bg-indigo-600 px-2 py-0.5 font-medium text-white disabled:opacity-50">
          จำไว้
        </button>
      </div>
    </div>
  )
}
