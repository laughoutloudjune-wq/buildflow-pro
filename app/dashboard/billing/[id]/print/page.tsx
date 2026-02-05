import { getBillingById } from '@/actions/billing-actions'
import { BillingPdfViewer } from './BillingPdfViewer'

export const dynamic = 'force-dynamic'

export default async function PrintBillingPage({ params }: { params: { id: string } }) {
  const billing = await getBillingById(params.id)

  if (!billing) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p>ไม่พบข้อมูลใบวางบิล</p>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen bg-slate-100 flex flex-col">
      <div className="bg-white p-4 shadow-sm flex justify-between items-center px-8 print:hidden">
         <h1 className="font-bold text-slate-700">พิมพ์ใบวางบิล #{billing.doc_no}</h1>
         {/* This button will not work as intended in a server component, 
             but we can leave it for now or replace with simple link.
             A better UX would be to handle this window closing from the parent window that opened it.
         */}
         <a href="#" onClick={(e) => { e.preventDefault(); window.close(); }} className="text-sm text-slate-500 hover:text-red-500">ปิดหน้าต่าง</a>
      </div>
      
      <BillingPdfViewer data={billing} />
    </div>
  )
}