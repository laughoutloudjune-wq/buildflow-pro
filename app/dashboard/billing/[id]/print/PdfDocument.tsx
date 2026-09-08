'use client'

import { PDFViewer } from '@react-pdf/renderer'
import { BillingPdf } from '@/components/pdf/BillingPdf'
import type { SignatureSlot } from '@/lib/types/signatures'

export default function PdfDocument({ data, settings, slots }: { data: any, settings: any, slots: SignatureSlot[] }) {
  return (
    <PDFViewer className="w-full h-full">
      <BillingPdf data={data} settings={settings} slots={slots} />
    </PDFViewer>
  )
}
