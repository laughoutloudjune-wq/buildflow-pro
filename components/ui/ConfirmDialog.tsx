'use client'

import Modal from '@/components/ui/Modal'

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmClass =
    tone === 'danger'
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-indigo-600 hover:bg-indigo-700'

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{message}</p>
        <div className="flex justify-end gap-3 border-t pt-4">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-white shadow transition disabled:opacity-60 ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
