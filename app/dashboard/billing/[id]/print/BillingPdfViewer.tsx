'use client'

import { PDFViewer } from '@react-pdf/renderer'
import { BillingPdf } from '@/components/pdf/BillingPdf'

export function BillingPdfViewer({ data }: { data: any }) {
  return (
    <PDFViewer className="w-full h-full">
      <BillingPdf data={data} />
    </PDFViewer>
  )
}
