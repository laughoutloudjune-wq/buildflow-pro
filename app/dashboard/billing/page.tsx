'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Loader2, Eye, Edit } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { getBillings } from '@/actions/billing-actions'
import BillingModal from '@/components/billings/BillingModal'
import { formatCurrency } from '@/lib/currency'

const getStatusChip = (status: string) => {
  const base = "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4"
  switch (status) {
    case 'approved':
      return <span className={`${base} bg-green-100 text-green-800`}>อนุมัติแล้ว</span>
    case 'pending_review':
      return <span className={`${base} bg-yellow-100 text-yellow-800`}>รอตรวจสอบ</span>
    case 'rejected':
      return <span className={`${base} bg-red-100 text-red-800`}>ไม่อนุมัติ</span>
    case 'draft':
      return <span className={`${base} bg-gray-100 text-gray-800`}>ฉบับร่าง</span>
    default:
      return <span className={`${base} bg-gray-100 text-gray-800`}>{status}</span>
  }
}

export default function BillingListPage() {
  const [billings, setBillings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBillingId, setSelectedBillingId] = useState<string | null>(null)
  const router = useRouter()

  const getPlotLabel = (bill: any) => {
    const baseProject = bill.projects?.name || '-'
    const jobPlots = Array.from(
      new Set((bill.billing_jobs || []).map((j: any) => j.job_assignments?.plots?.name).filter(Boolean))
    ) as string[]

    if (bill.plots?.name) return `${baseProject} • แปลง ${bill.plots.name}`
    if (jobPlots.length > 0) {
      const preview = jobPlots.slice(0, 2).join(', ')
      const suffix = jobPlots.length > 2 ? ` +${jobPlots.length - 2}` : ''
      return `${baseProject} • แปลง ${preview}${suffix}`
    }
    return baseProject
  }

  const getBriefJobLines = (bill: any) => {
    const mainLines = (bill.billing_jobs || []).map((job: any) => {
      const name = job.job_assignments?.boq_master?.item_name || 'งานหลัก'
      const plot = job.job_assignments?.plots?.name
      return plot ? `${name} • แปลง ${plot}` : name
    })
    const adjLines = (bill.billing_adjustments || []).map((adj: any) => {
      const prefix = adj.type === 'deduction' ? 'หัก' : 'เพิ่ม'
      return `${prefix}: ${adj.description || '-'}`
    })
    return [...mainLines, ...adjLines].slice(0, 3)
  }

  const getJobTypeLabel = (bill: any) => {
    const hasMain = (bill.billing_jobs || []).length > 0
    const hasAdd = (bill.billing_adjustments || []).some((a: any) => a.type === 'addition')
    const hasDeduct = (bill.billing_adjustments || []).some((a: any) => a.type === 'deduction')
    const tags: string[] = []
    if (hasMain) tags.push('งานหลัก')
    if (hasAdd) tags.push('งานเพิ่ม')
    if (hasDeduct) tags.push('งานหัก')
    if (tags.length === 0 && bill.type === 'extra_work') return 'DC'
    return tags.join(' / ') || '-'
  }

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

      <Card className="p-4 bg-slate-50/60 border-slate-200">
        {loading ? (
          <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto"/></div>
        ) : billings.length === 0 ? (
          <div className="p-12 text-center text-slate-400">ยังไม่มีเอกสารเบิกจ่าย</div>
        ) : (
          <div className="space-y-3">
            {billings.map((bill) => (
              <div
                key={bill.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-300 hover:shadow cursor-pointer transition"
                onClick={() => handleRowClick(bill)}
              >
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[130px_140px_150px_1fr_150px_120px_56px]">
                  <div className="flex items-start">
                    <div className="font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-md w-fit text-xs">
                      #{bill.doc_no?.toString().padStart(4, '0')}
                    </div>
                  </div>
                  <div className="text-slate-600 text-sm">{new Date(bill.billing_date).toLocaleDateString('th-TH')}</div>
                  <div>
                    <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                      {getJobTypeLabel(bill)}
                    </span>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800">{bill.contractors?.name}</div>
                    <div className="text-xs text-slate-500">{getPlotLabel(bill)}</div>
                    <div className="mt-1 space-y-0.5 text-[11px] text-slate-600 leading-4">
                      {getBriefJobLines(bill).map((line: string, idx: number) => (
                        <div key={`${bill.id}-brief-${idx}`} className="truncate">{line}</div>
                      ))}
                    </div>
                  </div>
                  <div className="text-right font-bold text-emerald-600">฿{formatCurrency(bill.net_amount)}</div>
                  <div className="flex lg:justify-center">{getStatusChip(bill.status)}</div>
                  <div className="flex lg:justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRowClick(bill)
                      }}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                    >
                      {bill.status === 'pending_review' ? <Edit className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <BillingModal
        billingId={selectedBillingId}
        onClose={() => setSelectedBillingId(null)}
        onDeleted={loadBillings}
      />
    </div>
  )
}
