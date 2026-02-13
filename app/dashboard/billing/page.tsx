'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation' // Import useRouter
import { Plus, Loader2, Eye, Edit } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { getBillings } from '@/actions/billing-actions'
import BillingModal from '@/components/billings/BillingModal'
import { formatCurrency } from '@/lib/currency'

// Helper function to get status styles
const getStatusChip = (status: string) => {
  switch (status) {
    case 'approved':
      return <div className="bg-green-100 text-green-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded-full">อนุมัติแล้ว</div>
    case 'pending_review':
      return <div className="bg-yellow-100 text-yellow-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded-full">รอตรวจสอบ</div>
    case 'rejected':
      return <div className="bg-red-100 text-red-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded-full">ไม่อนุมัติ</div>
    case 'draft':
      return <div className="bg-gray-100 text-gray-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded-full">ฉบับร่าง</div>
    default:
      return <div className="bg-gray-100 text-gray-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded-full">{status}</div>
  }
}


export default function BillingListPage() {
  const [billings, setBillings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter() // Initialize router
  
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
  
  // Function to handle click, directing to review page or modal
  const handleRowClick = (bill: any) => {
    if (bill.status === 'pending_review') {
      router.push(`/dashboard/billing/${bill.id}/review`)
    } else {
      setSelectedBillingId(bill.id)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">รายการเบิกจ่ายงวดงาน</h1>
          <p className="text-sm text-slate-500">จัดการใบเบิกงวดงานหลักและงานเพิ่ม (DC) พร้อมติดตามสถานะอนุมัติ</p>
        </div>
        <div className="flex items-center gap-2">
            <Link href="/dashboard/foreman/create-progress">
              <button className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 shadow-sm transition">
                <Plus className="h-4 w-4" /> สร้างใบเบิกงวดงาน
              </button>
            </Link>
            <Link href="/dashboard/foreman/create-dc">
              <button className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 shadow-sm transition">
                <Plus className="h-4 w-4" /> สร้างใบเบิกงานเพิ่ม (DC)
              </button>
            </Link>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">เลขที่เอกสาร</th>
                <th className="px-4 py-3 font-semibold">วันที่</th>
                <th className="px-4 py-3 font-semibold">ผู้รับเหมา / โครงการ</th>
                <th className="px-4 py-3 font-semibold text-right">ยอดสุทธิ</th>
                <th className="px-4 py-3 font-semibold text-center">สถานะ</th>
                <th className="px-4 py-3 font-semibold text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                 <tr><td colSpan={6} className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto"/></td></tr>
              ) : billings.length === 0 ? (
                 <tr><td colSpan={6} className="p-12 text-center text-slate-400">ยังไม่มีเอกสารเบิกจ่าย</td></tr>
              ) : (
                 billings.map((bill) => (
                   <tr 
                      key={bill.id} 
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                      onClick={() => handleRowClick(bill)}
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
                       ฿{formatCurrency(bill.net_amount)}
                     </td>
                     <td className="px-4 py-3 text-center">
                        {getStatusChip(bill.status)}
                     </td>
                     <td className="px-4 py-3 text-center">
                        <button 
                            onClick={(e) => {
                                e.stopPropagation()
                                handleRowClick(bill)
                            }}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                        >
                            {bill.status === 'pending_review' ? <Edit className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                     </td>
                   </tr>
                 ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <BillingModal 
         billingId={selectedBillingId} 
         onClose={() => setSelectedBillingId(null)} 
         onDeleted={loadBillings}
      />

    </div>
  )
}

