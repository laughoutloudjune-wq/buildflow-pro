'use client'

import { PDFViewer } from '@react-pdf/renderer'
import { BillingPdf } from '@/components/pdf/BillingPdf'

export function BillingPdfViewer({ data, settings }: { data: any, settings: any }) {
  return (
    <PDFViewer className="w-full h-full">
      <BillingPdf data={data} settings={settings} />
    </PDFViewer>
  )
}
