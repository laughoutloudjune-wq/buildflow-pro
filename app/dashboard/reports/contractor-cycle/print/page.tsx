'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getApprovedContractorCycleReport } from '@/actions/billing-actions'
import { formatCurrency } from '@/lib/currency'
import { Printer, Loader2 } from 'lucide-react'

type Row = any

export default function ContractorCyclePrintPreviewPage() {
  const searchParams = useSearchParams()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const filters = useMemo(() => ({
    dateFrom: searchParams.get('dateFrom') || undefined,
    dateTo: searchParams.get('dateTo') || undefined,
    projectId: searchParams.get('projectId') || undefined,
    contractorId: searchParams.get('contractorId') || undefined,
  }), [searchParams])

  useEffect(() => {
    async function run() {
      setLoading(true)
      setError(null)
      try {
        const data = await getApprovedContractorCycleReport(filters)
        setRows(data || [])
      } catch (e: any) {
        setError(e.message || 'Failed to load print preview')
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [filters])

  const collator = useMemo(() => new Intl.Collator('th', { numeric: true, sensitivity: 'base' }), [])

  const grouped = useMemo(() => {
    const map = new Map<string, any>()
    for (const bill of rows) {
      const key = bill.contractor_id || 'unknown'
      if (!map.has(key)) map.set(key, { contractor: bill.contractors, bills: [] })
      map.get(key).bills.push(bill)
    }
    return Array.from(map.values())
      .map((g: any) => ({
        ...g,
        bills: g.bills.slice().sort((a: any, b: any) => {
          const p = collator.compare(a.projects?.name || '', b.projects?.name || '')
          if (p !== 0) return p
          const pl = collator.compare(a.plots?.name || '', b.plots?.name || '')
          if (pl !== 0) return pl
          return new Date(a.billing_date || a.created_at || 0).getTime() - new Date(b.billing_date || b.created_at || 0).getTime()
        }),
      }))
      .sort((a: any, b: any) => collator.compare(a.contractor?.name || '', b.contractor?.name || ''))
  }, [rows, collator])

  const lineRowsForBill = (bill: any) => {
    const lines: any[] = []
    const billProject = bill.projects?.name || '-'
    const billPlot = bill.plots?.name || '-'
    const billPlotType = bill.plots?.house_models?.name || '-'

    for (const job of bill.billing_jobs || []) {
      const boq = job.job_assignments?.boq_master
      const jobPlot = job.job_assignments?.plots?.name || billPlot
      const jobPlotType = job.job_assignments?.plots?.house_models?.name || billPlotType
      const unitPrice = Number(job.job_assignments?.agreed_price_per_unit ?? boq?.price_per_unit ?? 0)
      lines.push({
        source: 'main',
        project: billProject,
        houseNo: jobPlot,
        plotType: jobPlotType,
        description: boq?.item_name || '-',
        qty: Number(boq?.quantity || 0),
        unit: boq?.unit || '',
        unitPrice,
        total: Number(job.amount || 0),
        note: job.progress_percent == null ? '' : `${Number(job.progress_percent).toFixed(2)}%`,
      })
    }

    for (const adj of bill.billing_adjustments || []) {
      const lineTotal = Number(adj.quantity || 0) * Number(adj.unit_price || 0)
      lines.push({
        source: adj.type === 'deduction' ? 'dc-deduct' : 'dc-add',
        project: billProject,
        houseNo: billPlot,
        plotType: billPlotType,
        description: adj.description || '-',
        qty: Number(adj.quantity || 0),
        unit: adj.unit || '',
        unitPrice: Number(adj.unit_price || 0),
        total: adj.type === 'deduction' ? -lineTotal : lineTotal,
        note: bill.reason_for_dc || 'DC',
      })
    }

    return lines
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 print:bg-white print:p-0">
      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          .no-print { display: none !important; }
          .page-break { page-break-after: always; break-after: page; }
          .avoid-break { page-break-inside: avoid; break-inside: avoid; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="max-w-6xl mx-auto space-y-4">
        <div className="no-print flex items-center justify-between rounded-lg border bg-white p-3">
          <div>
            <div className="font-semibold">ตัวอย่างพิมพ์สรุปรอบจ่ายผู้รับเหมา</div>
            <div className="text-sm text-slate-500">รอบวันที่ {filters.dateFrom || '-'} ถึง {filters.dateTo || '-'}</div>
          </div>
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-white">
            <Printer className="h-4 w-4" /> พิมพ์
          </button>
        </div>

        {loading ? (
          <div className="rounded-lg border bg-white p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : error ? (
          <div className="rounded-lg border bg-white p-4 text-red-600">{error}</div>
        ) : grouped.length === 0 ? (
          <div className="rounded-lg border bg-white p-8 text-center text-slate-400">ไม่พบข้อมูล</div>
        ) : (
          grouped.map((group: any, groupIndex: number) => {
            const lines = group.bills.flatMap((bill: any) => lineRowsForBill(bill).map((line: any) => ({ ...line, bill })))
            const total = lines.reduce((sum: number, l: any) => sum + Number(l.total || 0), 0)
            return (
              <div key={`${group.contractor?.name || 'unknown'}-${groupIndex}`} className={`rounded-lg border bg-white p-4 ${groupIndex < grouped.length - 1 ? 'page-break' : ''}`}>
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-xl font-bold">สรุปรอบจ่ายผู้รับเหมา</h1>
                    <div className="text-sm">ผู้รับเหมา: <span className="font-semibold">{group.contractor?.name || '-'}</span></div>
                    <div className="text-sm text-slate-600">รอบวันที่ {filters.dateFrom || '-'} ถึง {filters.dateTo || '-'}</div>
                  </div>
                  <div className="text-right text-sm">
                    <div>จำนวนใบเบิก: {group.bills.length}</div>
                    <div>พิมพ์เมื่อ: {new Date().toLocaleString('th-TH')}</div>
                    <div className="font-bold text-emerald-700">รวมสุทธิ: ฿{formatCurrency(total)}</div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="border px-2 py-1 text-left">เลขที่ใบเบิก</th>
                        <th className="border px-2 py-1 text-left">วันที่</th>
                        <th className="border px-2 py-1 text-left">โครงการ</th>
                        <th className="border px-2 py-1 text-left">บ้านเลขที่ / แปลง</th>
                        <th className="border px-2 py-1 text-left">ประเภทบ้าน</th>
                        <th className="border px-2 py-1 text-left">รายละเอียดงาน</th>
                        <th className="border px-2 py-1 text-right">Qty</th>
                        <th className="border px-2 py-1 text-right">ราคา/หน่วย</th>
                        <th className="border px-2 py-1 text-right">รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((row: any, idx: number) => (
                        <tr key={`${row.bill.id}-${row.source}-${idx}`} className="avoid-break">
                          <td className="border px-2 py-1">#{String(row.bill.doc_no || '-').padStart(4, '0')}</td>
                          <td className="border px-2 py-1">{row.bill.billing_date ? new Date(row.bill.billing_date).toLocaleDateString('th-TH') : '-'}</td>
                          <td className="border px-2 py-1">{row.project}</td>
                          <td className="border px-2 py-1">{row.houseNo}</td>
                          <td className="border px-2 py-1">{row.plotType}</td>
                          <td className="border px-2 py-1">
                            <div>{row.description}</div>
                            {row.note ? <div className="text-[10px] text-slate-500">{row.note}</div> : null}
                          </td>
                          <td className="border px-2 py-1 text-right">{row.qty} {row.unit}</td>
                          <td className="border px-2 py-1 text-right">฿{formatCurrency(row.unitPrice)}</td>
                          <td className={`border px-2 py-1 text-right font-semibold ${row.total < 0 ? 'text-red-700' : ''}`}>
                            {row.total < 0 ? '-' : ''}฿{formatCurrency(Math.abs(Number(row.total || 0)))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-emerald-50">
                        <td colSpan={8} className="border px-2 py-2 text-right font-bold">รวมสุทธิผู้รับเหมารายนี้</td>
                        <td className="border px-2 py-2 text-right font-bold text-emerald-700">฿{formatCurrency(total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
