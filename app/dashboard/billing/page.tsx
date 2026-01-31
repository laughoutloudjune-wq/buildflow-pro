'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Printer, FileText, Loader2, Search, Eye } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { getBillings } from '@/actions/billing-actions'
import BillingModal from '@/components/billings/BillingModal' // Import ตัวใหม่ที่เพิ่งสร้าง

export default function BillingListPage() {
  const [billings, setBillings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  // State สำหรับเปิด Modal
  const [selectedBillingId, setSelectedBillingId] = useState<string | null>(null)

  const loadBillings = () => {
    setLoading(true)
    getBillings().then((data) => {
      setBillings(data)
      setLoading(false)
    })
  }

  useEffect(() => {
    loadBillings()
  }, [])

  return (
    <div className="space-y-6">
      {/* ... (Header ส่วนเดิม ไม่ต้องแก้) ... */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">เบิกจ่ายงวดงาน (Billing)</h1>
          <p className="text-sm text-slate-500">จัดการเอกสารวางบิล งานเพิ่ม และรายการหัก</p>
        </div>
        <Link href="/dashboard/billing/create">
          <button className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 shadow-sm transition">
            <Plus className="h-4 w-4" /> สร้างใบเบิกงวด
          </button>
        </Link>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">เลขที่เอกสาร</th>
                <th className="px-4 py-3 font-semibold">วันที่</th>
                <th className="px-4 py-3 font-semibold">ผู้รับเหมา / โครงการ</th>
                <th className="px-4 py-3 font-semibold text-right">ยอดสุทธิ (Net)</th>
                <th className="px-4 py-3 font-semibold text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                 <tr><td colSpan={5} className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto"/></td></tr>
              ) : billings.length === 0 ? (
                 <tr><td colSpan={5} className="p-12 text-center text-slate-400">ยังไม่มีเอกสารวางบิล</td></tr>
              ) : (
                 billings.map((bill) => (
                   <tr 
                      key={bill.id} 
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                      onClick={() => setSelectedBillingId(bill.id)} // กดที่แถวเพื่อเปิด Modal
                   >
                     <td className="px-4 py-3">
                        <div className="font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded w-fit text-xs">
                            #{bill.doc_no?.toString().padStart(4, '0')}
                        </div>
                     </td>
                     <td className="px-4 py-3 text-slate-500">
                       {new Date(bill.billing_date).toLocaleDateString('th-TH')}
                     </td>
                     <td className="px-4 py-3">
                       <div className="font-bold text-slate-800">{bill.contractors?.name}</div>
                       <div className="text-xs text-slate-500">{bill.projects?.name}</div>
                     </td>
                     <td className="px-4 py-3 text-right font-bold text-emerald-600">
                       ฿{bill.net_amount?.toLocaleString()}
                     </td>
                     <td className="px-4 py-3 text-center">
                        {/* ปุ่มเปิด Modal (เหมือนกดที่แถว แต่มีปุ่มให้ชัดเจน) */}
                        <button 
                            onClick={(e) => {
                                e.stopPropagation() // กันไม่ให้ Event ชนกับ Row Click
                                setSelectedBillingId(bill.id)
                            }}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                        >
                            <Eye className="h-4 w-4" />
                        </button>
                     </td>
                   </tr>
                 ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* เรียกใช้ Modal ตรงนี้ */}
      <BillingModal 
         billingId={selectedBillingId} 
         onClose={() => setSelectedBillingId(null)} 
         onDeleted={loadBillings}
      />

    </div>
  )
}
