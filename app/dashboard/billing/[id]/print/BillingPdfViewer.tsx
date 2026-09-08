'use client'

import dynamic from 'next/dynamic'
import PageLoading from '@/components/ui/PageLoading'

// @react-pdf/renderer (plus its embedded Thai fonts) is a large, iframe-based
// client-only renderer. Loading it via next/dynamic keeps that whole chunk
// out of this route's initial JS and off the server-render path entirely -
// it only downloads once the print page has already painted its shell.
const PdfDocument = dynamic(() => import('./PdfDocument'), {
  ssr: false,
  loading: () => <PageLoading label="กำลังเตรียมเอกสาร PDF..." />,
})

export function BillingPdfViewer({ data, settings }: { data: any, settings: any }) {
  return <PdfDocument data={data} settings={settings} />
}
