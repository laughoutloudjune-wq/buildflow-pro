'use client'

import { PDFViewer } from '@react-pdf/renderer'
import { SaleReceiptPdf } from '@/components/pdf/SaleReceiptPdf'
import type { SignatureSlot } from '@/lib/types/signatures'
import type { SaleReceiptData } from '@/actions/sale-payments-actions'

export default function PdfDocument({
  data,
  settings,
  slots,
}: {
  data: SaleReceiptData
  settings: { company_name?: string; tax_id?: string } | null
  slots: SignatureSlot[]
}) {
  return (
    <PDFViewer className="w-full h-full">
      <SaleReceiptPdf data={data} settings={settings} slots={slots} />
    </PDFViewer>
  )
}
