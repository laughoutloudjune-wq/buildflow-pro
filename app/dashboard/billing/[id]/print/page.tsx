'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { PDFViewer } from '@react-pdf/renderer'
import { BillingPdf } from '@/components/pdf/BillingPdf'
import { getBillingById } from '@/actions/billing-actions'
import { Loader2 } from 'lucide-react'

export default function PrintBillingPage() {
  const params = useParams()
  const [billing, setBilling] = useState<any>(null)

  useEffect(() => {
    getBillingById(params.id as string).then(setBilling)
  }, [params.id])

  if (!billing) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    )
  }

  return (
    <div className="h-screen w-screen bg-slate-100 flex flex-col">
      <div className="bg-white p-4 shadow-sm flex justify-between items-center px-8">
         <h1 className="font-bold text-slate-700">พิมพ์ใบวางบิล #{billing.doc_no}</h1>
         <button onClick={() => window.close()} className="text-sm text-slate-500 hover:text-red-500">ปิดหน้าต่าง</button>
      </div>
      
      {/* PDF Viewer จะแสดงผลเต็มจอ */}
      <PDFViewer className="w-full h-full">
        <BillingPdf data={billing} />
      </PDFViewer>
    </div>
  )
}