'use client'

import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/currency'
import PurchaseOrderForm, { type PurchaseOrderFormHandle, type PurchaseOrderFormOptions } from '@/components/procurement/PurchaseOrderForm'

/**
 * "New purchase order" in a window: the ordinary PO form (prices, VAT, dates,
 * terms - one place an order is priced and saved), opened over the
 * งานจัดซื้อ page instead of on its own page. The request lines to order were
 * handed over through the combine draft (lib/procurement/combineDraft.ts)
 * just before this opened, so the form comes up filled in.
 */
export default function PurchaseOrderCreateModal({
  options,
  onClose,
  onCreated,
}: {
  options: PurchaseOrderFormOptions
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const formRef = useRef<PurchaseOrderFormHandle>(null)
  const [formState, setFormState] = useState({ total: 0, isPending: false })

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="ออกใบสั่งซื้อ"
      panelClassName="max-w-7xl h-[90dvh]"
      bodyClassName="p-4 sm:p-6"
      footer={
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-500">
            ยอดรวมทั้งสิ้น <span className="font-semibold text-slate-800">฿{formatCurrency(formState.total)}</span>
          </div>
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={() => formRef.current?.submit()} disabled={formState.isPending}>
              {formState.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึกใบสั่งซื้อ'}
            </Button>
          </div>
        </div>
      }
    >
      <PurchaseOrderForm
        ref={formRef}
        mode="create"
        combined
        initialOptions={options}
        onClose={onClose}
        onSaved={(id) => {
          if (id) onCreated(id)
          else onClose()
        }}
        onStateChange={setFormState}
      />
    </Modal>
  )
}
