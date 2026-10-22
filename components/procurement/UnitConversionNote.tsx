'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/ui/Toast'
import { setUnitConversion } from '@/actions/procurement/unit-conversions'
import { conversionText, isMasterUnit, unitFactor, type UnitConversions } from '@/lib/procurement/units'

/**
 * Under a quantity written in a non-master unit: what it comes to in the
 * master unit (the unit the BOQ is counted in). When the conversion is not
 * known yet, purchasing types it once ("1 มัด = 10 เส้น"); it is stored and
 * every later request or order in that unit uses it. Never blocks anything.
 */
export default function UnitConversionNote({
  materialTypeId,
  masterUnit,
  unit,
  quantity,
  conversions,
  onSaved,
  canSet = true,
  compact = false,
}: {
  materialTypeId: number
  masterUnit: string
  unit: string | null | undefined
  quantity: number
  conversions: UnitConversions
  /** Called after a conversion was stored, so the host reloads its map. */
  onSaved?: () => void
  /** Whether this viewer may type the conversion (admin/pm). */
  canSet?: boolean
  compact?: boolean
}) {
  const toast = useToast()
  const [factorText, setFactorText] = useState('')
  const [pending, startTransition] = useTransition()
  const u = (unit ?? '').trim()
  if (!materialTypeId || !u || isMasterUnit(masterUnit, u)) return null

  const factor = unitFactor(conversions, materialTypeId, masterUnit, u)
  if (factor != null) {
    const base = quantity / factor
    return (
      <p className={`text-xs text-slate-700 ${compact ? '' : 'mt-1'}`}>
        {quantity > 0 && (
          <>
            = <b className="tabular-nums">{base.toLocaleString('th-TH', { maximumFractionDigits: 2 })} {masterUnit}</b>{' '}
          </>
        )}
        <span className="text-slate-500">({conversionText(masterUnit, u, factor)})</span>
      </p>
    )
  }

  const save = () => {
    const f = Number(factorText)
    if (!(f > 0)) {
      toast.error('ใส่จำนวนที่มากกว่า 0')
      return
    }
    startTransition(async () => {
      const res = await setUnitConversion(materialTypeId, u, f)
      if ('error' in res) toast.error(res.error)
      else {
        toast.success(`จำไว้แล้ว ${conversionText(masterUnit, u, f)}`)
        setFactorText('')
        onSaved?.()
      }
    })
  }

  return (
    <div className={`text-xs text-amber-800 ${compact ? '' : 'mt-1'}`}>
      <p>
        ยังไม่รู้ว่า 1 {masterUnit} = กี่ {u} · ส่งได้ ระบบจะยังไม่เทียบ BOQ ให้บรรทัดนี้
      </p>
      {canSet && (
        <span className="mt-1 inline-flex flex-wrap items-center gap-1.5 text-slate-700">
          1 {masterUnit} =
          <input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={factorText}
            onChange={(e) => setFactorText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                save()
              }
            }}
            aria-label={`1 ${masterUnit} เท่ากับกี่ ${u}`}
            className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-right tabular-nums"
          />
          {u}
          <button type="button" onClick={save} disabled={pending || !factorText} className="rounded bg-indigo-600 px-2 py-0.5 font-medium text-white disabled:opacity-50">
            จำไว้
          </button>
        </span>
      )}
    </div>
  )
}
