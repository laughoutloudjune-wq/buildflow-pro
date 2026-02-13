'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { getExtraWorkReport, getBillingOptions } from '@/actions/billing-actions'
import { getPlotsByProjectId } from '@/actions/plot-actions'
import { Loader2 } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

type Project = { id: string; name: string }
type Plot = { id: string; name: string }

type Filters = {
  projectId?: string
  plotId?: string
  reason?: string
  dateFrom?: string
  dateTo?: string
}

export default function DCHistoryReportPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [plots, setPlots] = useState<Plot[]>([])
  const [filters, setFilters] = useState<Filters>({})
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getBillingOptions().then(({ projects }) => setProjects(projects || []))
  }, [])

  useEffect(() => {
    if (!filters.projectId) {
      setPlots([])
      return
    }
    getPlotsByProjectId(filters.projectId).then((rows) => setPlots(rows || []))
  }, [filters.projectId])

  const runReport = async () => {
    setLoading(true)
    const result = await getExtraWorkReport(filters)
    setData(result || [])
    setLoading(false)
  }

  useEffect(() => {
    runReport()
  }, [])

  const totalsByPlot = useMemo(() => {
    const totals = new Map<string, number>()
    data.forEach((row) => {
      const plotName = row.plots?.name || 'ไม่ระบุแปลง'
      const addTotal = row.total_add_amount ?? (row.billing_adjustments || [])
        .filter((a: any) => a.type === 'addition')
        .reduce((sum: number, a: any) => sum + (a.quantity || 0) * (a.unit_price || 0), 0)
      const deductTotal = row.total_deduct_amount ?? (row.billing_adjustments || [])
        .filter((a: any) => a.type === 'deduction')
        .reduce((sum: number, a: any) => sum + (a.quantity || 0) * (a.unit_price || 0), 0)
      const net = addTotal - deductTotal
      totals.set(plotName, (totals.get(plotName) || 0) + net)
    })
    return Array.from(totals.entries())
  }, [data])

  const totalAll = totalsByPlot.reduce((sum, [, value]) => sum + value, 0)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">รายงานประวัติงานเพิ่ม (DC)</h1>
        <p className="text-sm text-slate-500">สรุปงานเพิ่ม (Extra Work) ตามแปลงและเงื่อนไขที่เลือก</p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600">โครงการ</label>
            <select className="mt-1 w-full p-2 border rounded" value={filters.projectId || ''} onChange={(e) => setFilters((prev) => ({ ...prev, projectId: e.target.value || undefined }))}>
              <option value="">ทั้งหมด</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">แปลง</label>
            <select className="mt-1 w-full p-2 border rounded" value={filters.plotId || ''} onChange={(e) => setFilters((prev) => ({ ...prev, plotId: e.target.value || undefined }))}>
              <option value="">ทั้งหมด</option>
              {plots.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">เหตุผล</label>
            <input className="mt-1 w-full p-2 border rounded" placeholder="เช่น Owner Request" value={filters.reason || ''} onChange={(e) => setFilters((prev) => ({ ...prev, reason: e.target.value || undefined }))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">ตั้งแต่</label>
            <input type="date" className="mt-1 w-full p-2 border rounded" value={filters.dateFrom || ''} onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value || undefined }))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">ถึง</label>
            <input type="date" className="mt-1 w-full p-2 border rounded" value={filters.dateTo || ''} onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value || undefined }))} />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button onClick={runReport} className="px-4 py-2 bg-slate-900 text-white rounded">ค้นหา</button>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-3">สรุปต้นทุนตามแปลง</h2>
        {totalsByPlot.length === 0 ? (
          <p className="text-sm text-slate-400">ยังไม่มีข้อมูล</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {totalsByPlot.map(([plot, value]) => (
              <div key={plot} className="p-3 border rounded">
                <p className="text-xs text-slate-500">{plot}</p>
                <p className="text-lg font-bold text-amber-700">฿{formatCurrency(value)}</p>
              </div>
            ))}
            <div className="p-3 border rounded bg-amber-50">
              <p className="text-xs text-slate-500">รวมทั้งหมด</p>
              <p className="text-lg font-bold text-amber-800">฿{formatCurrency(totalAll)}</p>
            </div>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">วันที่</th>
                <th className="px-4 py-3 font-semibold">โครงการ</th>
                <th className="px-4 py-3 font-semibold">แปลง</th>
                <th className="px-4 py-3 font-semibold">เหตุผล</th>
                <th className="px-4 py-3 font-semibold text-right">ยอดสุทธิ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto"/></td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-400">ไม่มีข้อมูล</td></tr>
              ) : (
                data.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-slate-500">{new Date(row.billing_date || row.created_at).toLocaleDateString('th-TH')}</td>
                    <td className="px-4 py-3">{row.projects?.name}</td>
                    <td className="px-4 py-3">{row.plots?.name || '-'}</td>
                    <td className="px-4 py-3">{row.reason_for_dc || '-'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-amber-700">฿{formatCurrency(row.net_amount)}</td>
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
