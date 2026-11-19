'use client'

import { useEffect, useState, type InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number | null | undefined
  /** Called with a finite number; an empty box reports 0. */
  onValueChange: (value: number) => void
}

/**
 * Number box that never shows a prefilled "0". An empty/zero value renders empty
 * (the placeholder shows through), the text is selected on focus, and what the user
 * types is kept as typed ("0.5", "1.") while the parent receives a safe number.
 * Use this for any price/amount/quantity field so staff don't have to delete a 0 first.
 */
export default function NumberInput({ value, onValueChange, onFocus, ...rest }: Props) {
  const fromValue = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? '' : String(v))
  const [text, setText] = useState(fromValue(value))

  // Re-sync only when the parent value differs from what the text already means.
  useEffect(() => {
    const current = parseFloat(text)
    const asNumber = Number.isFinite(current) ? current : 0
    if (asNumber !== (value ?? 0)) setText(fromValue(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      value={text}
      onFocus={(e) => {
        e.target.select()
        onFocus?.(e)
      }}
      onChange={(e) => {
        setText(e.target.value)
        const n = parseFloat(e.target.value)
        onValueChange(Number.isFinite(n) ? n : 0)
      }}
    />
  )
}
