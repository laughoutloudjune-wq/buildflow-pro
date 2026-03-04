'use client'

import { useEffect, useMemo, useState } from 'react'
import { Building2, FileText, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import { getBillingOptions, getPlotHistoryReport } from '@/actions/billing-actions'
import { getPlotsByProjectId } from '@/actions/plot-actions'
import { formatCurrency } from '@/lib/currency'

type Project = { id: string; name: string }
type Plot = { id: string; name: string; house_models?: { name?: string | null } | null }

type HistoryLine = {
  kind: 'main' | 'adjustment'
  description: string
  qty: number
  unit: string
  unitPrice: number
  total: number
  note?: string
}

type PlotHistoryRecord = {
  plotId: string | null
  plotName: string
  plotType: string
  projectName: string
  bill: any
  lines: HistoryLine[]
}

export default function HouseHistoryReportPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [plots, setPlots] = useState<Plot[]>([])
  const [projectId, setProjectId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const [selectedHouseTitle, setSelectedHouseTitle] = useState('')
  const [selectedHouseRecords, setSelectedHouseRecords] = useState<PlotHistoryRecord[]>([])

  const collator = useMemo(() => new Intl.Collator('th', { numeric: true, sensitivity: 'base' }), [])

  useEffect(() => {
    getBillingOptions().then(({ projects }) => {
      setProjects((projects || []).sort((a: any, b: any) => collator.compare(a?.name || '', b?.name || '')))
    })
  }, [collator])

  useEffect(() => {
    if (!projectId) {
      setPlots([])
      return
    }
    getPlotsByProjectId(projectId).then((list: any[]) => {
      setPlots((list || []).sort((a: any, b: any) => collator.compare(a?.name || '', b?.name || '')))
    })
  }, [projectId, collator])

  const runReport = async () => {
    setLoading(true)
    try {
      const data = await getPlotHistoryReport({
        projectId: projectId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      })
      setRows(data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    runReport()
  }, [])

  const expandedRecords = useMemo<PlotHistoryRecord[]>(() => {
    const out: PlotHistoryRecord[] = []

    for (const bill of rows) {
      const projectName = bill.projects?.name || '-'
      const defaultPlotId = bill.plot_id ? String(bill.plot_id) : null
      const defaultPlotName = bill.plots?.name || '-'
      const defaultPlotType = bill.plots?.house_models?.name || '-'

      const grouped = new Map<string, { plotId: string | null; plotName: string; plotType: string; lines: HistoryLine[] }>()

      const addLine = (plotId: string | null, plotName: string, plotType: string, line: HistoryLine) => {
        const key = plotId ? `id:${plotId}` : `name:${projectName}|||${plotName}`
        if (!grouped.has(key)) grouped.set(key, { plotId, plotName, plotType, lines: [] })
        const bucket = grouped.get(key)!
        if ((!bucket.plotType || bucket.plotType === '-') && plotType && plotType !== '-') bucket.plotType = plotType
        bucket.lines.push(line)
      }

      for (const job of bill.billing_jobs || []) {
        const boq = job.job_assignments?.boq_master
        const jobPlot = job.job_assignments?.plots
        const linePlotId = jobPlot?.id ? String(jobPlot.id) : defaultPlotId
        const linePlotName = jobPlot?.name || defaultPlotName
        const linePlotType = jobPlot?.house_models?.name || defaultPlotType || '-'
        const qty = Number(boq?.quantity || 0)
        const unitPrice = Number(job.job_assignments?.agreed_price_per_unit ?? boq?.price_per_unit ?? 0)

        addLine(linePlotId, linePlotName, linePlotType, {
          kind: 'main',
          description: boq?.item_name || '-',
          qty,
          unit: boq?.unit || '',
          unitPrice,
          total: Number(job.amount || 0),
          note: job.progress_percent == null ? '' : `${Number(job.progress_percent).toFixed(2)}%`,
        })
      }

      for (const adj of bill.billing_adjustments || []) {
        const lineTotal = Number(adj.quantity || 0) * Number(adj.unit_price || 0)
        const signed = adj.type === 'deduction' ? -lineTotal : lineTotal
        addLine(defaultPlotId, adj.plot_name || defaultPlotName || '-', defaultPlotType || '-', {
          kind: 'adjustment',
          description: adj.description || '-',
          qty: Number(adj.quantity || 0),
          unit: adj.unit || '',
          unitPrice: Number(adj.unit_price || 0),
          total: signed,
          note: adj.type === 'deduction' ? 'หัก' : 'เพิ่ม',
        })
      }

      if (grouped.size === 0) {
        addLine(defaultPlotId, defaultPlotName || '-', defaultPlotType || '-', {
          kind: 'adjustment',
          description: bill.note || bill.reason_for_dc || '-',
          qty: 0,
          unit: '',
          unitPrice: 0,
          total: Number(bill.net_amount || 0),
        })
      }

      for (const g of grouped.values()) {
        out.push({
          plotId: g.plotId,
          plotName: g.plotName,
          plotType: g.plotType || '-',
          projectName,
          bill,
          lines: g.lines,
        })
      }
    }

    return out.sort((a, b) => {
      const byProject = collator.compare(a.projectName || '', b.projectName || '')
      if (byProject !== 0) return byProject
      const byPlot = collator.compare(a.plotName || '', b.plotName || '')
      if (byPlot !== 0) return byPlot
      return new Date(b.bill.billing_date || b.bill.created_at || 0).getTime() - new Date(a.bill.billing_date || a.bill.created_at || 0).getTime()
    })
  }, [rows, collator])

  const cards = useMemo(() => {
    if (projectId) {
      return plots.map((plot) => {
        const recs = expandedRecords.filter((r) => r.plotId === String(plot.id) || (!r.plotId && r.plotName === plot.name))
        const total = recs.reduce((sum, r) => sum + Number(r.bill.net_amount || 0), 0)
        return {
          key: `id:${plot.id}`,
          label: plot.name,
          subtitle: plot.house_models?.name || '-',
          projectName: projects.find((p) => p.id === projectId)?.name || '-',
          records: recs,
          total,
        }
      })
    }

    const map = new Map<string, any>()
    for (const r of expandedRecords) {
      const key = `${r.projectName}|||${r.plotName}`
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: r.plotName,
          subtitle: r.plotType || '-',
          projectName: r.projectName,
          records: [],
          total: 0,
        })
      }
      const bucket = map.get(key)
      bucket.records.push(r)
      bucket.total += Number(r.bill.net_amount || 0)
    }

    return Array.from(map.values()).sort((a, b) => {
      const byProject = collator.compare(a.projectName || '', b.projectName || '')
      if (byProject !== 0) return byProject
      return collator.compare(a.label || '', b.label || '')
    })
  }, [expandedRecords, plots, projectId, projects, collator])

  const openHouseHistory = (card: any) => {
    setSelectedHouseTitle(`${card.projectName} • แปลง ${card.label}`)
    setSelectedHouseRecords(card.records)
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">ประวัติงานตามบ้านเลขที่</h1>
        <p className="text-sm text-slate-500">ใช้การ์ดบ้านเหมือนหน้าแปลงที่ดิน แล้วกดเพื่อดูประวัติงานครบทั้งหมด</p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600">โครงการ</label>
            <select className="mt-1 w-full" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">ทุกโครงการ</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">ตั้งแต่</label>
            <input type="date" className="mt-1 w-full" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">ถึง</label>
            <input type="date" className="mt-1 w-full" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="md:col-span-2 flex items-end">
            <button onClick={runReport} className="w-full rounded-lg bg-slate-900 px-4 py-2 text-white">ค้นหา</button>
          </div>
        </div>
      </Card>

      <Card className="p-4 bg-slate-50/70 border-slate-200">
        {loading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : cards.length === 0 ? (
          <div className="py-12 text-center text-slate-400">ไม่พบประวัติงาน</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
            {cards.map((card: any) => (
              <button
                key={card.key}
                type="button"
                onClick={() => openHouseHistory(card)}
                className="text-left"
              >
                <Card className="group h-full overflow-hidden transition-all hover:shadow-md hover:border-indigo-300 cursor-pointer">
                  <div className="p-4 flex flex-col items-center text-center space-y-3">
                    <div className="h-12 w-12 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-sm">
                      {String(card.label || '-').slice(0, 3)}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-lg">{card.label}</h3>
                      <p className="text-sm text-slate-500">{card.subtitle || '-'}</p>
                      <p className="text-xs text-slate-400 mt-1 inline-flex items-center gap-1"><Building2 className="h-3 w-3" /> {card.projectName}</p>
                    </div>
                    <div className="w-full pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="rounded-full bg-indigo-100 px-2 py-1 text-indigo-700">{card.records.length} รายการ</span>
                      <span className="font-semibold text-emerald-700">฿{formatCurrency(card.total || 0)}</span>
                    </div>
                  </div>
                </Card>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Modal
        isOpen={selectedHouseRecords.length > 0}
        onClose={() => {
          setSelectedHouseTitle('')
          setSelectedHouseRecords([])
        }}
        title={selectedHouseTitle || 'ประวัติงาน'}
        panelClassName="max-w-[96vw] h-[88vh]"
        bodyClassName="p-0 h-[calc(88vh-72px)]"
      >
        <div className="h-full overflow-auto p-4 bg-slate-50/40">
          <div className="space-y-3">
            {selectedHouseRecords
              .sort((a, b) => new Date(b.bill.billing_date || b.bill.created_at || 0).getTime() - new Date(a.bill.billing_date || a.bill.created_at || 0).getTime())
              .map((record, idx) => {
                const bill = record.bill
                const typeLabel = bill.type === 'extra_work' ? 'DC' : 'Progress'
                return (
                  <Card key={`${bill.id}-${idx}`} className="p-4 border-slate-200">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="inline-flex rounded bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">#{String(bill.doc_no || '-').padStart(4, '0')}</div>
                        <div className="mt-2 text-sm text-slate-600">{bill.billing_date ? new Date(bill.billing_date).toLocaleDateString('th-TH') : '-'}</div>
                        <div className="text-sm font-medium text-slate-800">{record.projectName} • แปลง {record.plotName} • {record.plotType || '-'}</div>
                      </div>
                      <div className="text-right">
                        <div className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">{typeLabel}</div>
                        <div className="mt-2 text-lg font-bold text-emerald-700">฿{formatCurrency(bill.net_amount || 0)}</div>
                      </div>
                    </div>

                    <div className="mt-3 divide-y rounded-lg border border-slate-200 bg-white">
                      {record.lines.map((line, lineIdx) => (
                        <div key={`${bill.id}-line-${lineIdx}`} className="grid grid-cols-1 gap-2 p-3 md:grid-cols-[1fr_120px_140px_140px] md:items-center">
                          <div>
                            <div className="text-sm font-medium text-slate-800">{line.description}</div>
                            {line.note ? <div className="text-xs text-slate-500 mt-0.5">{line.note}</div> : null}
                          </div>
                          <div className="text-sm text-slate-600 md:text-right">{line.qty || 0} {line.unit || ''}</div>
                          <div className="text-sm text-slate-600 md:text-right">฿{formatCurrency(line.unitPrice || 0)}</div>
                          <div className={`text-sm font-semibold md:text-right ${line.total < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                            {line.total < 0 ? '-' : ''}฿{formatCurrency(Math.abs(Number(line.total || 0)))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {bill.note ? (
                      <div className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700 inline-flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5" /> {bill.note}
                      </div>
                    ) : null}
                  </Card>
                )
              })}
          </div>
        </div>
      </Modal>
    </div>
  )
}