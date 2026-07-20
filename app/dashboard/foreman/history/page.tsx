'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBillingsByCreator, deleteBilling } from '@/actions/billing-actions'
import { Card } from '@/components/ui/Card'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Loader2, Trash2, Pencil } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

const statusLabels: Record<string, string> = {
  approved: 'อนุมัติแล้ว',
  pending_review: 'รอตรวจสอบ',
  rejected: 'ปฏิเสธ',
}

const getStatusChip = (status: string) => (
  <Badge tone={statusTone(status)} className="px-2 py-0.5 text-[11px] font-medium leading-4">
    {statusLabels[status] || status}
  </Badge>
)

export default function ForemanHistoryPage() {
  const router = useRouter()
  const [billings, setBillings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await getBillingsByCreator()
      setBillings(data)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'โหลดรายการไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

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

  const handleEdit = (bill: any) => {
    const target = bill.type === 'extra_work'
      ? `/dashboard/foreman/create-dc?editId=${bill.id}`
      : `/dashboard/foreman/request?editId=${bill.id}`
    router.push(target)
  }

  const handleDelete = async (billId: string) => {
    if (!confirm('ต้องการลบคำขอนี้ใช่หรือไม่?')) return
    await deleteBilling(billId)
    await load()
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="ประวัติคำขอ"
        subtitle="รวมทุกคำขอที่คุณสร้างไว้"
        actions={
          <>
            <Button variant="secondary" onClick={() => router.push('/dashboard/foreman/create-progress')}>
              สร้างใบขอเบิกงวด
            </Button>
            <Button onClick={() => router.push('/dashboard/foreman/create-dc')}>
              สร้างงานเพิ่ม (DC)
            </Button>
          </>
        }
      />

      <Card className="p-4 bg-slate-50/60 border-slate-200">
        {loading ? (
          <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto"/></div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-sm text-red-600">{loadError}</p>
            <Button type="button" onClick={() => void load()}>
              ลองโหลดใหม่
            </Button>
          </div>
        ) : billings.length === 0 ? (
          <div className="p-8 text-center text-slate-400">ยังไม่มีคำขอ</div>
        ) : (
          <div className="space-y-3">
            {billings.map((bill) => (
              <div key={bill.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300 transition">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[130px_160px_1fr_150px_120px_130px]">
                  <div className="text-slate-500 text-sm">{new Date(bill.created_at || bill.billing_date).toLocaleDateString('th-TH')}</div>
                  <div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${bill.type === 'extra_work' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-blue-50 text-blue-800 border-blue-200'}`}>
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
                  <div className="text-right font-semibold text-emerald-600">฿{formatCurrency(bill.net_amount)}</div>
                  <div className="flex lg:justify-center">{getStatusChip(bill.status)}</div>
                  <div className="flex lg:justify-center">
                    {bill.status === 'pending_review' ? (
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleEdit(bill)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg border border-blue-100"><Pencil className="h-4 w-4"/></button>
                        <button onClick={() => handleDelete(bill.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg border border-red-100"><Trash2 className="h-4 w-4"/></button>
                      </div>
                    ) : <span className="text-xs text-slate-400">-</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
