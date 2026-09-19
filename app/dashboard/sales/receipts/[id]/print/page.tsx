import { getSalePaymentForReceipt } from '@/actions/sale-payments-actions'
import { getOrganizationSettings } from '@/actions/settings-actions'
import { getSignatureSlots } from '@/actions/signature-slots-actions'
import { ReceiptPdfViewer } from './ReceiptPdfViewer'
import { CloseButton } from './CloseButton'

export const dynamic = 'force-dynamic'

/**
 * Renders the receipt PDF live from sale_payments/plot_sales data on every
 * open - same as billing's print route (BillingPdf.tsx) - rather than
 * storing a generated file. "Not reachable without a login" (Phase 7 accept
 * criterion) falls out for free: this route lives under /dashboard, which
 * the app's own auth already gates end to end.
 */
export default async function PrintSaleReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [receipt, settings, slots] = await Promise.all([
    getSalePaymentForReceipt(id),
    getOrganizationSettings(),
    getSignatureSlots('sale_receipt'),
  ])

  if (!receipt) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p>ไม่พบข้อมูลใบเสร็จ</p>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen bg-slate-100 flex flex-col">
      <div className="bg-white p-4 shadow-sm flex justify-between items-center px-8 print:hidden">
        <h1 className="font-bold text-slate-700">พิมพ์ใบเสร็จรับเงิน {receipt.payment.receiptNo}</h1>
        <CloseButton />
      </div>

      <ReceiptPdfViewer data={receipt} settings={settings} slots={slots} />
    </div>
  )
}
