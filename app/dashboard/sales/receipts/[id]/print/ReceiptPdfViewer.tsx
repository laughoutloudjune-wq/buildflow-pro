'use client'

import dynamic from 'next/dynamic'
import PageLoading from '@/components/ui/PageLoading'
import type { SignatureSlot } from '@/lib/types/signatures'
import type { SaleReceiptData } from '@/actions/sale-payments-actions'

// Same next/dynamic + ssr:false reasoning as billing's print route - keeps
// @react-pdf/renderer's large client-only chunk off this route's initial JS.
const PdfDocument = dynamic(() => import('./PdfDocument'), {
  ssr: false,
  loading: () => <PageLoading label="กำลังเตรียมเอกสาร PDF..." />,
})

export function ReceiptPdfViewer({
  data,
  settings,
  slots,
}: {
  data: SaleReceiptData
  settings: { company_name?: string; tax_id?: string } | null
  slots: SignatureSlot[]
}) {
  return <PdfDocument data={data} settings={settings} slots={slots} />
}
