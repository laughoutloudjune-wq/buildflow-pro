'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/currency'
import { getPurchaseOrderDetailBundle, type PurchaseOrderDetailBundle } from '@/actions/procurement/po-detail-bundle'
import PurchaseOrderDetailPageClient from '@/app/dashboard/procurement/orders/[id]/PurchaseOrderDetailPageClient'
import type { PurchaseOrderFormHandle } from '@/components/procurement/PurchaseOrderForm'

/**
 * The full PO detail/edit form in a dialog, fetched on demand when a row is
 * clicked from the orders list - a page navigation per PO was the thing
 * being replaced. Same pattern as PlotDetailModal for plots.
 *
 * The total/ยกเลิก/save bar lives here, in Modal's `footer` slot, rather
 * than inside PurchaseOrderForm's own render tree - a bar that must stay
 * visible regardless of scroll position needs to sit outside the scrollable
 * body entirely (plain flex layout), not fight it with `fixed` (escapes the
 * dialog to the browser viewport) or `sticky` (only pins once scrolled near
 * its own normal-flow position, not "always visible"). The form still owns
 * the actual submit logic; this only drives it via a ref plus the total/
 * isPending it reports up through onFormStateChange.
 */
export default function PurchaseOrderModal({
  orderId,
  onClose,
}: {
  orderId: string | null
  onClose: () => void
}) {
  const [bundle, setBundle] = useState<PurchaseOrderDetailBundle | null>(null)
  const isLoading = Boolean(orderId) && bundle?.id !== orderId
  const formRef = useRef<PurchaseOrderFormHandle>(null)
  const [formState, setFormState] = useState({ total: 0, isPending: false })

  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    getPurchaseOrderDetailBundle(orderId).then((res) => {
      if (!cancelled) setBundle(res)
    })
    return () => {
      cancelled = true
    }
  }, [orderId])

  function refetch() {
    if (!orderId) return
    getPurchaseOrderDetailBundle(orderId).then(setBundle)
  }

  const order = bundle?.order
  const isFormReadOnly = order ? order.status === 'paid' || order.status === 'cancelled' : true
  const showFooter = Boolean(order) && !isFormReadOnly

  return (
    <Modal
      isOpen={Boolean(orderId)}
      onClose={onClose}
      title={order ? `ใบสั่งซื้อ ${order.po_no}` : 'ใบสั่งซื้อ'}
      panelClassName="max-w-5xl h-[90dvh]"
      bodyClassName="p-4 sm:p-6"
      footer={
        showFooter ? (
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-500">
              ยอดรวมทั้งสิ้น <span className="font-semibold text-slate-800">฿{formatCurrency(formState.total)}</span>
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={onClose}>
                ยกเลิก
              </Button>
              <Button type="button" onClick={() => formRef.current?.submit()} disabled={formState.isPending}>
                {formState.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึกการแก้ไข'}
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      {isLoading || !bundle ? (
        <div className="flex h-full items-center justify-center text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <PurchaseOrderDetailPageClient
          fetchedAt={bundle.fetchedAt}
          id={bundle.id}
          order={bundle.order}
          formOptions={bundle.formOptions}
          initialError={bundle.initialError}
          onClose={onClose}
          onRefresh={refetch}
          formRef={formRef}
          onFormStateChange={setFormState}
        />
      )}
    </Modal>
  )
}
