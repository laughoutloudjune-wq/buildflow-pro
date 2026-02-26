'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
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
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)
  const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })

  useEffect(() => {
    getBillingOptions().then(({ projects }) => setProjects(projects || []))
  }, [])

  useEffect(() => {
    if (!filters.projectId) {
      setPlots([])
      return
    }
    getPlotsByProjectId(filters.projectId).then((rows) => {
      const sorted = [...(rows || [])].sort((a, b) => collator.compare(a.name || '', b.name || ''))
      setPlots(sorted)
    })
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

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const byProject = collator.compare(a.projects?.name || '', b.projects?.name || '')
      if (byProject !== 0) return byProject
      const byPlot = collator.compare(a.plots?.name || '', b.plots?.name || '')
      if (byPlot !== 0) return byPlot
      const da = new Date(a.billing_date || a.created_at || 0).getTime()
      const db = new Date(b.billing_date || b.created_at || 0).getTime()
      return db - da
    })
  }, [data])

  const reportRows = useMemo(() => {
    const rows: any[] = []
    for (const bill of sortedData) {
      const adjustments = Array.isArray(bill.billing_adjustments) ? bill.billing_adjustments : []
      if (adjustments.length === 0) continue

      const byPlot = new Map<string, any[]>()
      for (const adj of adjustments) {
        const plotName = adj.plot_name || bill.plots?.name || 'ไม่ระบุแปลง'
        if (!byPlot.has(plotName)) byPlot.set(plotName, [])
        byPlot.get(plotName)!.push(adj)
      }

      for (const [plotName, plotAdjustments] of byPlot.entries()) {
        const addTotal = plotAdjustments
          .filter((a: any) => a.type === 'addition')
          .reduce((sum: number, a: any) => sum + (a.quantity || 0) * (a.unit_price || 0), 0)
        const deductTotal = plotAdjustments
          .filter((a: any) => a.type === 'deduction')
          .reduce((sum: number, a: any) => sum + (a.quantity || 0) * (a.unit_price || 0), 0)
        rows.push({
          ...bill,
          _row_key: `${bill.id}-${plotName}`,
          _plot_name: plotName,
          _billing_adjustments_for_plot: plotAdjustments,
          _dc_net_amount: addTotal - deductTotal,
        })
      }
    }
    return rows.sort((a, b) => {
      const byProject = collator.compare(a.projects?.name || '', b.projects?.name || '')
      if (byProject !== 0) return byProject
      const byPlot = collator.compare(a._plot_name || '', b._plot_name || '')
      if (byPlot !== 0) return byPlot
      const da = new Date(a.billing_date || a.created_at || 0).getTime()
      const db = new Date(b.billing_date || b.created_at || 0).getTime()
      return db - da
    })
  }, [sortedData, collator])

  const totalsByPlot = useMemo(() => {
    const totals = new Map<string, { key: string; project: string; plot: string; value: number; rows: any[] }>()
    reportRows.forEach((row) => {
      const projectName = row.projects?.name || 'ไม่ระบุโครงการ'
      const plotName = row._plot_name || row.plots?.name || 'ไม่ระบุแปลง'
      const key = `${projectName}|||${plotName}`
      const net = Number(row._dc_net_amount || 0)
      if (!totals.has(key)) totals.set(key, { key, project: projectName, plot: plotName, value: 0, rows: [] })
      const entry = totals.get(key)!
      entry.value += net
      entry.rows.push(row)
    })
    return Array.from(totals.values()).sort((a, b) => {
      const byProject = collator.compare(a.project, b.project)
      if (byProject !== 0) return byProject
      return collator.compare(a.plot, b.plot)
    })
  }, [reportRows, collator])

  const totalAll = totalsByPlot.reduce((sum, row) => sum + row.value, 0)
  const selectedGroup = totalsByPlot.find((g) => g.key === selectedGroupKey) || null

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
            {totalsByPlot.map((entry) => (
              <button key={entry.key} className="p-3 border rounded text-left hover:border-amber-300 hover:bg-amber-50/40 transition" onClick={() => setSelectedGroupKey(entry.key)}>
                <p className="text-xs text-slate-500">{entry.project}</p>
                <p className="font-semibold text-slate-800">{entry.plot}</p>
                <p className="text-lg font-bold text-amber-700">฿{formatCurrency(entry.value)}</p>
                <p className="text-xs text-slate-500 mt-1">ดูประวัติ {entry.rows.length} รายการ</p>
              </button>
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
                reportRows.map((row) => (
                  <tr key={row._row_key} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedGroupKey(`${row.projects?.name || 'ไม่ระบุโครงการ'}|||${row._plot_name || row.plots?.name || 'ไม่ระบุแปลง'}`)}>
                    <td className="px-4 py-3 text-slate-500">{new Date(row.billing_date || row.created_at).toLocaleDateString('th-TH')}</td>
                    <td className="px-4 py-3">{row.projects?.name}</td>
                    <td className="px-4 py-3">{row._plot_name || row.plots?.name || '-'}</td>
                    <td className="px-4 py-3">{row.reason_for_dc || '-'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-amber-700">฿{formatCurrency(row._dc_net_amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        isOpen={!!selectedGroup}
        onClose={() => setSelectedGroupKey(null)}
        title={selectedGroup ? `ประวัติ DC: ${selectedGroup.project} • แปลง ${selectedGroup.plot}` : 'ประวัติ DC'}
      >
        {selectedGroup && (
          <div className="space-y-4 max-h-[70vh] overflow-auto">
            <div className="text-sm text-slate-600">
              รวมสุทธิ: <span className="font-bold text-amber-700">฿{formatCurrency(selectedGroup.value)}</span>
            </div>
            {selectedGroup.rows
              .slice()
              .sort((a, b) => new Date(b.billing_date || b.created_at || 0).getTime() - new Date(a.billing_date || a.created_at || 0).getTime())
              .map((row) => (
                <div key={row.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-800">#{String(row.doc_no || '-').padStart(4, '0')}</div>
                      <div className="text-xs text-slate-500">{new Date(row.billing_date || row.created_at).toLocaleDateString('th-TH')}</div>
                      <div className="text-xs text-slate-500">{row.contractors?.name || '-'}</div>
                      <div className="text-xs text-slate-500">{row.reason_for_dc || '-'}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">สุทธิ</div>
                      <div className="font-bold text-amber-700">฿{formatCurrency(row.net_amount)}</div>
                    </div>
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs border">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-2 py-1 text-left">ประเภท</th>
                          <th className="px-2 py-1 text-left">รายการ</th>
                          <th className="px-2 py-1 text-right">จำนวน</th>
                          <th className="px-2 py-1 text-right">ราคา/หน่วย</th>
                          <th className="px-2 py-1 text-right">รวม</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(row._billing_adjustments_for_plot || row.billing_adjustments || []).map((adj: any) => {
                          const lineTotal = Number(adj.quantity || 0) * Number(adj.unit_price || 0)
                          return (
                            <tr key={adj.id || `${adj.type}-${adj.description}`} className="border-t">
                              <td className="px-2 py-1">{adj.type === 'deduction' ? 'หัก' : 'เพิ่ม'}</td>
                              <td className="px-2 py-1">{adj.description || '-'}</td>
                              <td className="px-2 py-1 text-right">{adj.quantity || 0} {adj.unit || ''}</td>
                              <td className="px-2 py-1 text-right">฿{formatCurrency(adj.unit_price)}</td>
                              <td className="px-2 py-1 text-right">{adj.type === 'deduction' ? '-' : ''}฿{formatCurrency(lineTotal)}</td>
                            </tr>
                          )
                        })}
                        {(!row.billing_adjustments || row.billing_adjustments.length === 0) && (
                          <tr><td colSpan={5} className="px-2 py-2 text-center text-slate-400">ไม่มีรายการย่อย</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
