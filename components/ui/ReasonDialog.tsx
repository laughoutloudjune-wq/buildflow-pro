'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'

/** Same job as window.prompt() - ask for one line of text before confirming
 * an action (PO cancel, PO close-short, sales work request rejection, ...) -
 * but as an in-app dialog instead of the unstyled browser popup (L-14). */
export default function ReasonDialog({
  isOpen,
  title,
  label,
  placeholder,
  required = false,
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  busy = false,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean
  title: string
  label: string
  placeholder?: string
  /** When true, Confirm is disabled until the trimmed reason is non-empty. */
  required?: boolean
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  // Tracks the dialog's own open/closed transition (not a prop) so the field
  // can be cleared during render rather than in an effect - "adjusting state
  // when a prop changes" per React's docs. Clears each time the dialog opens
  // fresh, rather than leaving a previous action's reason sitting there the
  // next time this dialog is reused for a different row.
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) setReason('')
  }

  const canConfirm = !busy && (!required || reason.trim() !== '')

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title}>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={placeholder}
            autoFocus
            className="w-full rounded-md border border-slate-300 p-2"
          />
        </div>
        <div className="flex justify-end gap-3 border-t pt-4">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canConfirm}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-white shadow transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
