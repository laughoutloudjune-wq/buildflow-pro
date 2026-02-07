'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBillingsByCreator, deleteBilling } from '@/actions/billing-actions'
import { Card } from '@/components/ui/Card'
import { Loader2, Trash2, Pencil } from 'lucide-react'

const getStatusChip = (status: string) => {
  switch (status) {
    case 'approved':
      return <span className="bg-green-100 text-green-800 text-xs font-medium px-2.5 py-0.5 rounded-full">อนุมัติแล้ว</span>
    case 'pending_review':
      return <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2.5 py-0.5 rounded-full">รอตรวจสอบ</span>
    case 'rejected':
      return <span className="bg-red-100 text-red-800 text-xs font-medium px-2.5 py-0.5 rounded-full">ปฏิเสธ</span>
    default:
      return <span className="bg-gray-100 text-gray-800 text-xs font-medium px-2.5 py-0.5 rounded-full">{status}</span>
  }
}

export default function ForemanHistoryPage() {
  const router = useRouter()
  const [billings, setBillings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const data = await getBillingsByCreator()
    setBillings(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const handleEdit = (bill: any) => {
    const target = bill.type === 'extra_work'
      ? `/dashboard/foreman/create-dc?editId=${bill.id}`
      : '/dashboard/foreman/create-progress'
    router.push(target)
  }

  const handleDelete = async (billId: string) => {
    if (!confirm('ต้องการลบคำขอนี้ใช่หรือไม่?')) return
    await deleteBilling(billId)
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">ประวัติคำขอ</h1>
          <p className="text-sm text-slate-500">รวมทุกคำขอที่คุณสร้างไว้</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/dashboard/foreman/create-progress')} className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
            สร้างใบขอเบิกงวด
          </button>
          <button onClick={() => router.push('/dashboard/foreman/create-dc')} className="px-4 py-2 rounded-md bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700">
            สร้างงานเพิ่ม (DC)
          </button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">วันที่</th>
                <th className="px-4 py-3 font-semibold">ประเภท</th>
                <th className="px-4 py-3 font-semibold">ผู้รับเหมา</th>
                <th className="px-4 py-3 font-semibold text-right">ยอดรวม</th>
                <th className="px-4 py-3 font-semibold text-center">สถานะ</th>
                <th className="px-4 py-3 font-semibold text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto"/></td></tr>
              ) : billings.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-400">ยังไม่มีคำขอ</td></tr>
              ) : (
                billings.map((bill) => (
                  <tr key={bill.id}>
                    <td className="px-4 py-3 text-slate-500">{new Date(bill.created_at || bill.billing_date).toLocaleDateString('th-TH')}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${bill.type === 'extra_work' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                        {bill.type === 'extra_work' ? 'DC' : 'Progress'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{bill.contractors?.name}</div>
                      <div className="text-xs text-slate-500">{bill.projects?.name}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-600">฿{bill.net_amount?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">{getStatusChip(bill.status)}</td>
                    <td className="px-4 py-3 text-center">
                      {bill.status === 'pending_review' ? (
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => handleEdit(bill)} className="p-2 text-blue-600 hover:bg-blue-50 rounded"><Pencil className="h-4 w-4"/></button>
                          <button onClick={() => handleDelete(bill.id)} className="p-2 text-red-600 hover:bg-red-50 rounded"><Trash2 className="h-4 w-4"/></button>
                        </div>
                      ) : <span className="text-xs text-slate-400">-</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
