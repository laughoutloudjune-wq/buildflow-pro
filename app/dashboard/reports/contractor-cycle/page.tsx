'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import { getApprovedContractorCycleReport, getBillingOptions, undoApproveBilling } from '@/actions/billing-actions'
import { Loader2, Printer } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

type Project = { id: string; name: string }
type Contractor = { id: string; name: string }

type Filters = {
  projectId?: string
  contractorId?: string
  dateFrom?: string
  dateTo?: string
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function monthStartISO() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().split('T')[0]
}

export default function ContractorCycleReportPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [filters, setFilters] = useState<Filters>({ dateFrom: monthStartISO(), dateTo: todayISO() })
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [showHtmlModalPreview, setShowHtmlModalPreview] = useState(false)
  const [printedAtLabel, setPrintedAtLabel] = useState('')

  useEffect(() => {
    getBillingOptions().then((data) => {
      setProjects((data.projects || []) as Project[])
      setContractors((data.contractors || []).map((c: any) => ({ id: c.id, name: c.name })))
    })
  }, [])

  const runReport = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getApprovedContractorCycleReport(filters)
      setRows(result || [])
    } catch (e: any) {
      setError(e.message || 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    runReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    document.body.classList.toggle('contractor-cycle-print-preview-open', showPrintPreview)
    return () => document.body.classList.remove('contractor-cycle-print-preview-open')
  }, [showPrintPreview])

  useEffect(() => {
    setPrintedAtLabel(new Date().toLocaleString('th-TH'))
  }, [])

  useEffect(() => {
    const clearPrintClass = () => document.body.classList.remove('contractor-cycle-modal-print-open')
    window.addEventListener('afterprint', clearPrintClass)
    return () => window.removeEventListener('afterprint', clearPrintClass)
  }, [])

  const handleUndoApprove = async (billId: string) => {
    const ok = window.confirm('ต้องการ Undo Approve ใบเบิกนี้ใช่หรือไม่? ระบบจะย้ายกลับไปรอตรวจสอบและลบรายการจ่ายที่สร้างจากการอนุมัติ')
    if (!ok) return
    try {
      await undoApproveBilling(billId)
      await runReport()
    } catch (e: any) {
      alert(e.message || 'Undo approve failed')
    }
  }

  const escapeHtml = (value: any) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')

  const openBrowserPrintPreview = () => {
    const sectionsHtml = invoiceTemplateHtml || previewGroups.map((group: any) => {
      const plotBlocks = group.plots.map((plotGroup: any) => {
        const rowsHtml = plotGroup.lines.map((line: any) => `
          <tr>
            <td>#${String(line.docNo || '-').padStart(4, '0')}</td>
            <td>${line.billingDate ? new Date(line.billingDate).toLocaleDateString('th-TH') : '-'}</td>
            <td>${escapeHtml(line.projectName)}</td>
            <td>${escapeHtml(line.plotNo)}</td>
            <td>${escapeHtml(line.plotType || '-')}</td>
            <td><div>${escapeHtml(line.description)}</div>${line.note ? `<div class="muted">${escapeHtml(line.note)}</div>` : ''}</td>
            <td class="num">${escapeHtml(line.qty)} ${escapeHtml(line.unit)}</td>
            <td class="num">฿${formatCurrency(line.unitPrice)}</td>
            <td class="num ${line.totalPrice < 0 ? 'neg' : ''}">${line.totalPrice < 0 ? '-' : ''}฿${formatCurrency(Math.abs(Number(line.totalPrice || 0)))}</td>
          </tr>
        `).join('')

        return `
          <section class="plot-block">
            <div class="plot-header">
              <div>
                <div class="plot-title">${escapeHtml(plotGroup.projectName)} • แปลง ${escapeHtml(plotGroup.plotNo)}</div>
                <div class="muted">ประเภทบ้าน: ${escapeHtml(plotGroup.plotType || '-')}</div>
              </div>
              <div class="plot-total">฿${formatCurrency(plotGroup.total)}</div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>เลขที่ใบเบิก</th>
                  <th>วันที่</th>
                  <th>โครงการ</th>
                  <th>บ้านเลขที่ / แปลง</th>
                  <th>ประเภทบ้าน</th>
                  <th>รายละเอียดงาน</th>
                  <th class="num">Qty</th>
                  <th class="num">ราคา/หน่วย</th>
                  <th class="num">รวม</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
              <tfoot>
                <tr><td colspan="8" class="num strong">รวมสุทธิแปลงนี้</td><td class="num strong">฿${formatCurrency(plotGroup.total)}</td></tr>
              </tfoot>
            </table>
          </section>
        `
      }).join('')

      return `
        <section class="contractor-section">
          <div class="head">
            <div>
              <div class="title">สรุปรอบจ่ายผู้รับเหมา</div>
              <div>ผู้รับเหมา: <strong>${escapeHtml(group.contractor?.name || '-')}</strong></div>
              <div class="muted">รอบวันที่ ${escapeHtml(filters.dateFrom || '-')} ถึง ${escapeHtml(filters.dateTo || '-')}</div>
            </div>
            <div class="right">
              <div>จำนวนใบเบิก: ${group.bills.length}</div>
              <div>จำนวนแปลง: ${group.plots.length}</div>
              <div class="strong">รวมสุทธิ: ฿${formatCurrency(group.previewTotal)}</div>
            </div>
          </div>
          ${plotBlocks}
        </section>
      `
    }).join('')

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Contractor Cycle Print Preview</title>
<style>
body{font-family:"Noto Sans Thai","Segoe UI",system-ui,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:12px;color:#0f172a;font-size:13px;line-height:1.35}
.toolbar{position:sticky;top:0;background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center}
.toolbar button{background:#2563eb;color:#fff;border:none;border-radius:6px;padding:8px 12px;cursor:pointer}
.invoice-sheet{background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:14px;margin-bottom:12px;page-break-inside:avoid;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.invoice-head{display:flex;justify-content:space-between;gap:14px;border-bottom:2px solid #0f172a;padding-bottom:8px;margin-bottom:8px}
.brand{font-size:13px;letter-spacing:1.8px;color:#64748b;font-weight:800}
.doc-title{font-size:22px;font-weight:800;line-height:1.1;letter-spacing:-.02em}
.meta-box{min-width:300px;border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px;background:#f8fafc;font-size:12px}
.meta-box div{display:flex;justify-content:space-between;gap:10px;padding:2px 0}
.meta-box span{color:#64748b}
.summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:8px 0 10px}
.sum-card{border:1px solid #dbe2ea;border-radius:10px;padding:7px 8px;background:#fff}
.sum-card label{display:block;font-size:11px;color:#64748b;margin-bottom:1px}
.sum-card strong{font-size:14px}
.sum-card.total{background:#ecfdf5;border-color:#a7f3d0}
.invoice-body{display:block}
.plot-card{border:1px solid #e2e8f0;border-radius:10px;margin:0 0 8px;overflow:hidden}
.plot-card-head{display:flex;justify-content:space-between;gap:10px;padding:7px 9px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.plot-name{font-weight:700;font-size:13px}
.plot-sum{font-weight:800;color:#047857}
.line-table{width:100%;border-collapse:collapse;font-size:11px}
.line-table th,.line-table td{border:1px solid #e2e8f0;padding:4px 5px;vertical-align:top}
.line-table th{background:#f8fafc;text-align:left}
.desc{font-weight:600}
.sub{color:#64748b;font-size:10px}
.invoice-footer{margin-top:8px;border-top:1px dashed #cbd5e1;padding-top:8px}
.remark-box{margin-bottom:6px;padding:7px 8px;border:1px solid #e2e8f0;border-radius:10px;background:#fafafa}
.remark-title{font-weight:700;font-size:13px;margin-bottom:4px}
.num{text-align:right;white-space:nowrap}
.strong{font-weight:700}
.neg{color:#b91c1c}
@media print{
  @page{size:A4 portrait;margin:8mm}
  body{background:#fff;padding:0}
  .toolbar{display:none}
  .invoice-sheet{border:none;border-radius:0;padding:0}
}
</style></head>
<body>
<div class="toolbar"><div>ตัวอย่างพิมพ์ (HTML) - Browser Native Print Preview</div><button onclick="window.print()">พิมพ์</button></div>
${sectionsHtml || '<div class=\"contractor-section\">ไม่พบข้อมูล</div>'}
<script>setTimeout(()=>window.print(),300)</script>
</body></html>`

    const w = window.open('', '_blank', 'noopener,noreferrer')
    if (!w) {
      alert('Browser blocked popup window for print preview')
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
  }

  const printModalTemplate = () => {
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Print</title>
<style>
body{font-family:"Noto Sans Thai","Segoe UI",system-ui,-apple-system,sans-serif;background:#fff;margin:0;padding:10px;color:#0f172a;font-size:13px;line-height:1.35}
.invoice-sheet{background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:14px;margin-bottom:12px;page-break-inside:avoid}
.invoice-head{display:flex;justify-content:space-between;gap:14px;border-bottom:2px solid #0f172a;padding-bottom:8px;margin-bottom:8px}
.brand{font-size:13px;letter-spacing:1.8px;color:#64748b;font-weight:800}
.doc-title{font-size:22px;font-weight:800;line-height:1.1;letter-spacing:-.02em}
.meta-box{min-width:300px;border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px;background:#f8fafc;font-size:12px}
.meta-box div{display:flex;justify-content:space-between;gap:10px;padding:2px 0}
.meta-box span{color:#64748b}
.summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:8px 0 10px}
.sum-card{border:1px solid #dbe2ea;border-radius:10px;padding:7px 8px;background:#fff}
.sum-card label{display:block;font-size:11px;color:#64748b;margin-bottom:1px}
.sum-card strong{font-size:14px}
.sum-card.total{background:#ecfdf5;border-color:#a7f3d0}
.plot-card{border:1px solid #e2e8f0;border-radius:10px;margin:0 0 8px;overflow:hidden}
.plot-card-head{display:flex;justify-content:space-between;gap:10px;padding:7px 9px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.plot-name{font-weight:700;font-size:13px}
.plot-sum{font-weight:800;color:#047857}
.line-table{width:100%;border-collapse:collapse;font-size:11px}
.line-table th,.line-table td{border:1px solid #e2e8f0;padding:4px 5px;vertical-align:top}
.line-table th{background:#f8fafc;text-align:left}
.desc{font-weight:600}
.sub{color:#64748b;font-size:10px}
.invoice-footer{margin-top:8px;border-top:1px dashed #cbd5e1;padding-top:8px}
.remark-box{margin-bottom:6px;padding:7px 8px;border:1px solid #e2e8f0;border-radius:10px;background:#fafafa}
.remark-title{font-weight:700;font-size:13px;margin-bottom:4px}
.num{text-align:right;white-space:nowrap}
.strong{font-weight:700}
.neg{color:#b91c1c}
@page{size:A4 portrait;margin:8mm}
</style></head><body>
${invoiceTemplateHtml || '<div class="invoice-sheet">ไม่พบข้อมูล</div>'}
</body></html>`

    const doc = iframe.contentWindow?.document
    if (!doc || !iframe.contentWindow) {
      document.body.removeChild(iframe)
      return
    }
    doc.open()
    doc.write(html)
    doc.close()

    iframe.onload = () => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
      }, 1000)
    }
  }

  const collator = useMemo(() => new Intl.Collator('th', { numeric: true, sensitivity: 'base' }), [])

  const grouped = useMemo(() => {
    const map = new Map<string, { contractor: any; bills: any[] }>()
    for (const bill of rows) {
      const key = bill.contractor_id || 'unknown'
      if (!map.has(key)) map.set(key, { contractor: bill.contractors || { name: 'ไม่ระบุผู้รับเหมา' }, bills: [] })
      map.get(key)!.bills.push(bill)
    }
    return Array.from(map.entries())
      .map(([contractorId, group]) => {
        const bills = group.bills.slice().sort((a: any, b: any) => {
          const p = collator.compare(a.projects?.name || '', b.projects?.name || '')
          if (p !== 0) return p
          const pl = collator.compare(a.plots?.name || '', b.plots?.name || '')
          if (pl !== 0) return pl
          return new Date(a.billing_date || a.created_at || 0).getTime() - new Date(b.billing_date || b.created_at || 0).getTime()
        })
        const totals = bills.reduce(
          (acc: any, bill: any) => {
            acc.total_work_amount += Number(bill.total_work_amount || 0)
            acc.total_add_amount += Number(bill.total_add_amount || 0)
            acc.total_deduct_amount += Number(bill.total_deduct_amount || 0)
            acc.net_amount += Number(bill.net_amount || 0)
            return acc
          },
          { total_work_amount: 0, total_add_amount: 0, total_deduct_amount: 0, net_amount: 0 }
        )
        return { contractorId, contractor: group.contractor, bills, totals }
      })
      .sort((a, b) => collator.compare(a.contractor?.name || '', b.contractor?.name || ''))
  }, [rows, collator])

  const grandTotals = useMemo(() => {
    return grouped.reduce(
      (acc, g) => {
        acc.total_work_amount += g.totals.total_work_amount
        acc.total_add_amount += g.totals.total_add_amount
        acc.total_deduct_amount += g.totals.total_deduct_amount
        acc.net_amount += g.totals.net_amount
        acc.bill_count += g.bills.length
        return acc
      },
      { total_work_amount: 0, total_add_amount: 0, total_deduct_amount: 0, net_amount: 0, bill_count: 0 }
    )
  }, [grouped])

  const buildPreviewLines = (bill: any) => {
    const billProject = bill.projects?.name || '-'
    const billPlot = bill.plots?.name || '-'
    const billPlotType = bill.plots?.house_models?.name || '-'

    const mainLines = (bill.billing_jobs || []).map((job: any) => {
      const boq = job.job_assignments?.boq_master
      return {
        billId: bill.id,
        docNo: bill.doc_no,
        billingDate: bill.billing_date,
        projectName: billProject,
        plotNo: job.job_assignments?.plots?.name || billPlot,
        plotType: job.job_assignments?.plots?.house_models?.name || billPlotType,
        description: boq?.item_name || '-',
        qty: Number(boq?.quantity || 0),
        unit: boq?.unit || '',
        unitPrice: Number(job.job_assignments?.agreed_price_per_unit ?? boq?.price_per_unit ?? 0),
        totalPrice: Number(job.amount || 0),
        note: job.progress_percent == null ? '' : `${Number(job.progress_percent).toFixed(2)}%`,
      }
    })

    const dcLines = (bill.billing_adjustments || []).map((adj: any) => {
      const lineTotal = Number(adj.quantity || 0) * Number(adj.unit_price || 0)
      return {
        billId: bill.id,
        docNo: bill.doc_no,
        billingDate: bill.billing_date,
        projectName: billProject,
        plotType: billPlotType,
        description: adj.description || '-',
        plotNo: adj.plot_name || billPlot,
        qty: Number(adj.quantity || 0),
        unit: adj.unit || '',
        unitPrice: Number(adj.unit_price || 0),
        totalPrice: adj.type === 'deduction' ? -lineTotal : lineTotal,
        note: bill.reason_for_dc || (adj.type === 'deduction' ? 'หัก' : 'DC'),
      }
    })
    return [...mainLines, ...dcLines]
  }

  const previewGroups = useMemo(() => {
    return grouped.map((group) => {
      const plotMap = new Map<string, any>()
      for (const bill of group.bills) {
        for (const line of buildPreviewLines(bill)) {
          const key = `${line.projectName}|||${line.plotNo}`
          if (!plotMap.has(key)) {
            plotMap.set(key, {
              key,
              projectName: line.projectName,
              plotNo: line.plotNo,
              plotType: line.plotType || '-',
              lines: [],
              total: 0,
            })
          }
          const bucket = plotMap.get(key)
          bucket.lines.push(line)
          bucket.total += Number(line.totalPrice || 0)
          if ((!bucket.plotType || bucket.plotType === '-') && line.plotType) bucket.plotType = line.plotType
        }
      }
      const plots = Array.from(plotMap.values()).sort((a, b) => {
        const p = collator.compare(a.projectName || '', b.projectName || '')
        if (p !== 0) return p
        return collator.compare(a.plotNo || '', b.plotNo || '')
      })
      return {
        ...group,
        plots,
        previewTotal: Number(group.totals.net_amount || 0),
      }
    })
  }, [grouped, collator])

  const modalTemplateHtml = useMemo(() => {
    return previewGroups.map((group: any) => {
      const plotBlocks = group.plots.map((plotGroup: any) => {
        const rowsHtml = plotGroup.lines.map((line: any) => `
          <tr>
            <td>#${String(line.docNo || '-').padStart(4, '0')}</td>
            <td>${line.billingDate ? new Date(line.billingDate).toLocaleDateString('th-TH') : '-'}</td>
            <td>${escapeHtml(line.projectName)}</td>
            <td>${escapeHtml(line.plotNo)}</td>
            <td>${escapeHtml(line.plotType || '-')}</td>
            <td><div>${escapeHtml(line.description)}</div>${line.note ? `<div class="muted">${escapeHtml(line.note)}</div>` : ''}</td>
            <td class="num">${escapeHtml(line.qty)} ${escapeHtml(line.unit)}</td>
            <td class="num">฿${formatCurrency(line.unitPrice)}</td>
            <td class="num ${line.totalPrice < 0 ? 'neg' : ''}">${line.totalPrice < 0 ? '-' : ''}฿${formatCurrency(Math.abs(Number(line.totalPrice || 0)))}</td>
          </tr>
        `).join('')

        return `
          <section class="plot-block">
            <div class="plot-header">
              <div>
                <div class="plot-title">${escapeHtml(plotGroup.projectName)} โ€ข เนเธเธฅเธ ${escapeHtml(plotGroup.plotNo)}</div>
                <div class="muted">เธเธฃเธฐเน€เธ เธ—เธเนเธฒเธ: ${escapeHtml(plotGroup.plotType || '-')}</div>
              </div>
              <div class="plot-total">฿${formatCurrency(plotGroup.total)}</div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>เน€เธฅเธเธ—เธตเนเนเธเน€เธเธดเธ</th>
                  <th>เธงเธฑเธเธ—เธตเน</th>
                  <th>เนเธเธฃเธเธเธฒเธฃ</th>
                  <th>เธเนเธฒเธเน€เธฅเธเธ—เธตเน / เนเธเธฅเธ</th>
                  <th>เธเธฃเธฐเน€เธ เธ—เธเนเธฒเธ</th>
                  <th>เธฃเธฒเธขเธฅเธฐเน€เธญเธตเธขเธ”เธเธฒเธ</th>
                  <th class="num">Qty</th>
                  <th class="num">เธฃเธฒเธเธฒ/เธซเธเนเธงเธข</th>
                  <th class="num">เธฃเธงเธก</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
              <tfoot>
                <tr><td colspan="8" class="num strong">เธฃเธงเธกเธชเธธเธ—เธเธดเนเธเธฅเธเธเธตเน</td><td class="num strong">฿${formatCurrency(plotGroup.total)}</td></tr>
              </tfoot>
            </table>
          </section>
        `
      }).join('')

      return `
        <section class="contractor-section">
          <div class="head">
            <div>
              <div class="title">เธชเธฃเธธเธเธฃเธญเธเธเนเธฒเธขเธเธนเนเธฃเธฑเธเน€เธซเธกเธฒ</div>
              <div>เธเธนเนเธฃเธฑเธเน€เธซเธกเธฒ: <strong>${escapeHtml(group.contractor?.name || '-')}</strong></div>
              <div class="muted">เธฃเธญเธเธงเธฑเธเธ—เธตเน ${escapeHtml(filters.dateFrom || '-')} เธ–เธถเธ ${escapeHtml(filters.dateTo || '-')}</div>
            </div>
            <div class="right">
              <div>เธเธณเธเธงเธเนเธเน€เธเธดเธ: ${group.bills.length}</div>
              <div>เธเธณเธเธงเธเนเธเธฅเธ: ${group.plots.length}</div>
              <div class="strong">เธฃเธงเธกเธชเธธเธ—เธเธด: ฿${formatCurrency(group.previewTotal)}</div>
            </div>
          </div>
          ${plotBlocks}
        </section>
      `
    }).join('')
  }, [previewGroups, filters.dateFrom, filters.dateTo])

  const invoiceTemplateHtml = useMemo(() => {
    return previewGroups.map((group: any) => {
      const whtTotal = group.bills.reduce((sum: number, b: any) => sum + ((Number(b.total_add_amount || 0) * Number(b.wht_percent || 0)) / 100), 0)
      const retentionTotal = group.bills.reduce((sum: number, b: any) => sum + ((Number(b.total_work_amount || 0) * Number(b.retention_percent || 0)) / 100), 0)
      const grossBeforeTax = group.bills.reduce((sum: number, b: any) => sum + Number((b.total_work_amount || 0) + (b.total_add_amount || 0) - (b.total_deduct_amount || 0)), 0)

      const plotBlocks = group.plots.map((plotGroup: any, plotIndex: number) => {
        const rowsHtml = plotGroup.lines.map((line: any) => `
          <tr>
            <td>${plotIndex + 1}</td>
            <td>${escapeHtml(line.plotNo)}</td>
            <td>
              <div class="desc">${escapeHtml(line.description)}</div>
              ${line.note ? `<div class="sub">${escapeHtml(line.note)}</div>` : ''}
              <div class="sub">${escapeHtml(line.projectName)} • ${escapeHtml(line.plotType || '-')}</div>
              <div class="sub">อ้างอิงใบเบิก #${String(line.docNo || '-').padStart(4, '0')} / ${line.billingDate ? new Date(line.billingDate).toLocaleDateString('th-TH') : '-'}</div>
            </td>
            <td class="num">${escapeHtml(line.qty)} ${escapeHtml(line.unit)}</td>
            <td class="num">฿${formatCurrency(line.unitPrice)}</td>
            <td class="num ${line.totalPrice < 0 ? 'neg' : ''}">${line.totalPrice < 0 ? '-' : ''}฿${formatCurrency(Math.abs(Number(line.totalPrice || 0)))}</td>
          </tr>
        `).join('')

        return `
          <div class="plot-card">
            <div class="plot-card-head">
              <div>
                <div class="plot-name">แปลง ${escapeHtml(plotGroup.plotNo)}</div>
                <div class="sub">${escapeHtml(plotGroup.projectName)} • ประเภทบ้าน: ${escapeHtml(plotGroup.plotType || '-')}</div>
              </div>
              <div class="plot-sum">รวมแปลงนี้ ฿${formatCurrency(plotGroup.total)}</div>
            </div>
            <table class="line-table">
              <thead>
                <tr>
                  <th style="width:36px">#</th>
                  <th style="width:95px">บ้าน/แปลง</th>
                  <th>รายละเอียดงาน</th>
                  <th class="num" style="width:100px">Qty</th>
                  <th class="num" style="width:120px">ราคา/หน่วย</th>
                  <th class="num" style="width:130px">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
              <tfoot>
                <tr>
                  <td colspan="5" class="num strong">รวมสุทธิแปลงนี้</td>
                  <td class="num strong">฿${formatCurrency(plotGroup.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        `
      }).join('')

      return `
        <section class="invoice-sheet">
          <header class="invoice-head">
            <div>
              <div class="brand">BUILD FLOW</div>
              <div class="doc-title">ใบสรุปเบิกงวดงานผู้รับเหมา</div>
              <div class="sub">Construction Progress Billing Summary</div>
            </div>
            <div class="meta-box">
              <div><span>รอบจ่าย:</span> ${escapeHtml(filters.dateFrom || '-')} ถึง ${escapeHtml(filters.dateTo || '-')}</div>
              <div><span>ผู้รับเหมา:</span> ${escapeHtml(group.contractor?.name || '-')}</div>
              <div><span>จำนวนใบเบิก:</span> ${group.bills.length}</div>
              <div><span>จำนวนแปลง:</span> ${group.plots.length}</div>
              <div><span>พิมพ์เมื่อ:</span> ${escapeHtml(printedAtLabel || '-')}</div>
            </div>
          </header>

          <section class="summary-grid">
            <div class="sum-card"><label>งานหลัก</label><strong>฿${formatCurrency(group.totals.total_work_amount)}</strong></div>
            <div class="sum-card"><label>งานเพิ่ม</label><strong>฿${formatCurrency(group.totals.total_add_amount)}</strong></div>
            <div class="sum-card"><label>งานหัก</label><strong>฿${formatCurrency(group.totals.total_deduct_amount)}</strong></div>
            <div class="sum-card"><label>หัก ณ ที่จ่าย</label><strong>฿${formatCurrency(whtTotal)}</strong></div>
            <div class="sum-card"><label>หักประกันผลงาน</label><strong>฿${formatCurrency(retentionTotal)}</strong></div>
            <div class="sum-card total"><label>สุทธิจ่าย</label><strong>฿${formatCurrency(group.previewTotal)}</strong></div>
          </section>

          <section class="invoice-body">
            ${plotBlocks}
          </section>

          <section class="invoice-footer">
            <div class="remark-box">
              <div class="remark-title">หมายเหตุ</div>
              <div class="sub">ยอดก่อนหัก (งานหลัก + งานเพิ่ม - งานหัก) : ฿${formatCurrency(grossBeforeTax)}</div>
              <div class="sub">สุทธิหลังหัก ณ ที่จ่าย และหักประกันผลงาน : ฿${formatCurrency(group.previewTotal)}</div>
            </div>
          </section>
        </section>
      `
    }).join('')
  }, [previewGroups, filters.dateFrom, filters.dateTo, printedAtLabel])

  return (
    <div className="space-y-4 print:space-y-2">
      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-break-avoid { break-inside: avoid; page-break-inside: avoid; }
          body.contractor-cycle-print-preview-open * { visibility: hidden; }
          body.contractor-cycle-print-preview-open .print-preview-root,
          body.contractor-cycle-print-preview-open .print-preview-root * { visibility: visible; }
          body.contractor-cycle-print-preview-open .print-preview-root {
            position: absolute;
            inset: 0;
            width: 100%;
            background: white;
          }
          body.contractor-cycle-modal-print-open * { visibility: hidden !important; }
          body.contractor-cycle-modal-print-open .html-preview-modal-host,
          body.contractor-cycle-modal-print-open .html-preview-modal-host * { visibility: visible !important; }
          body.contractor-cycle-modal-print-open .html-preview-modal-host {
            position: absolute;
            inset: 0;
            width: 100%;
            background: white;
            padding: 0;
            margin: 0;
          }
          body.contractor-cycle-modal-print-open .no-print-in-modal { display: none !important; }
        }
      `}</style>

      <div className="no-print">
        <h1 className="text-2xl font-bold">รายงานสรุปรอบจ่ายผู้รับเหมา</h1>
        <p className="text-sm text-slate-500">รวมใบเบิกที่อนุมัติแล้ว แยกตามผู้รับเหมา พร้อมสรุปสำหรับฝ่ายบัญชี</p>
      </div>

      <Card className="p-4 no-print">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600">รอบจ่าย ตั้งแต่</label>
            <input type="date" className="mt-1 w-full p-2 border rounded" value={filters.dateFrom || ''} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value || undefined }))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">ถึง</label>
            <input type="date" className="mt-1 w-full p-2 border rounded" value={filters.dateTo || ''} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value || undefined }))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">โครงการ</label>
            <select className="mt-1 w-full p-2 border rounded" value={filters.projectId || ''} onChange={(e) => setFilters((p) => ({ ...p, projectId: e.target.value || undefined }))}>
              <option value="">ทั้งหมด</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">ผู้รับเหมา</label>
            <select className="mt-1 w-full p-2 border rounded" value={filters.contractorId || ''} onChange={(e) => setFilters((p) => ({ ...p, contractorId: e.target.value || undefined }))}>
              <option value="">ทั้งหมด</option>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={runReport} className="px-4 py-2 bg-slate-900 text-white rounded">ค้นหา</button>
                    <button onClick={() => setShowHtmlModalPreview(true)} className="px-4 py-2 bg-slate-700 text-white rounded inline-flex items-center gap-2">
            <Printer className="h-4 w-4" /> HTML ใน Modal
          </button>
<button onClick={openBrowserPrintPreview} className="px-4 py-2 bg-indigo-600 text-white rounded inline-flex items-center gap-2">
            <Printer className="h-4 w-4" /> ตัวอย่างพิมพ์ (Template)
          </button>
        </div>
      </Card>
      <Modal
        isOpen={showHtmlModalPreview}
        onClose={() => setShowHtmlModalPreview(false)}
        title="HTML Template Preview (Modal)"
        panelClassName="max-w-[98vw] h-[92vh]"
        bodyClassName="p-2 h-[calc(92vh-72px)]"
      >
        <div className="space-y-3 html-preview-modal-host">
          <div className="flex justify-end gap-2 no-print-in-modal">
            <button onClick={printModalTemplate} className="px-3 py-2 bg-emerald-600 text-white rounded text-sm">
              พิมพ์จาก Modal นี้
            </button>
            <button onClick={openBrowserPrintPreview} className="px-3 py-2 bg-indigo-600 text-white rounded text-sm">
              เปิด Browser Print Preview
            </button>
          </div>
          <div className="h-[calc(92vh-150px)] overflow-auto rounded border bg-slate-50 p-3">
            <style>{`
              .html-preview-modal{font-family:"Noto Sans Thai","Segoe UI",system-ui,-apple-system,sans-serif;color:#0f172a;font-size:14px;line-height:1.45}
              .html-preview-modal .invoice-sheet{background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:18px;margin-bottom:18px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
              .html-preview-modal .invoice-head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:12px}
              .html-preview-modal .brand{font-size:13px;letter-spacing:1.8px;color:#64748b;font-weight:800}
              .html-preview-modal .doc-title{font-size:28px;font-weight:800;line-height:1.15;letter-spacing:-0.02em}
              .html-preview-modal .meta-box{min-width:340px;border:1px solid #cbd5e1;border-radius:10px;padding:12px;background:#f8fafc;font-size:13px}
              .html-preview-modal .meta-box div{display:flex;justify-content:space-between;gap:10px;padding:2px 0}
              .html-preview-modal .meta-box span{color:#64748b}
              .html-preview-modal .summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0 14px}
              .html-preview-modal .sum-card{border:1px solid #dbe2ea;border-radius:10px;padding:10px;background:#fff}
              .html-preview-modal .sum-card label{display:block;font-size:12px;color:#64748b;margin-bottom:2px}
              .html-preview-modal .sum-card strong{font-size:16px}
              .html-preview-modal .sum-card.total{background:#ecfdf5;border-color:#a7f3d0}
              .html-preview-modal .plot-card{border:1px solid #e2e8f0;border-radius:10px;margin:0 0 12px;overflow:hidden}
              .html-preview-modal .plot-card-head{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
              .html-preview-modal .plot-name{font-weight:700;font-size:15px}
              .html-preview-modal .plot-sum{font-weight:800;color:#047857}
              .html-preview-modal .line-table{width:100%;border-collapse:collapse;font-size:12.5px}
              .html-preview-modal .line-table th,.html-preview-modal .line-table td{border:1px solid #e2e8f0;padding:7px 8px;vertical-align:top}
              .html-preview-modal .line-table th{background:#f8fafc;text-align:left}
              .html-preview-modal .desc{font-weight:600}
              .html-preview-modal .sub{color:#64748b;font-size:11px}
              .html-preview-modal .invoice-footer{margin-top:14px;border-top:1px dashed #cbd5e1;padding-top:12px}
              .html-preview-modal .remark-box{margin-bottom:8px;padding:10px;border:1px solid #e2e8f0;border-radius:10px;background:#fafafa}
              .html-preview-modal .remark-title{font-weight:700;font-size:13px;margin-bottom:4px}
              .html-preview-modal .num{text-align:right;white-space:nowrap}
              .html-preview-modal .strong{font-weight:700}
              .html-preview-modal .neg{color:#b91c1c}
            `}</style>
            <div className="html-preview-modal" dangerouslySetInnerHTML={{ __html: invoiceTemplateHtml || '<div class="invoice-sheet">ไม่พบข้อมูล</div>' }} />
          </div>
        </div>
      </Modal>


      {showPrintPreview && (
        <Card className="p-4 print-preview-root">
          <div className="no-print mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">ตัวอย่างพิมพ์สรุปรอบจ่าย (จัดกลุ่มตามแปลง)</h2>
              <p className="text-sm text-slate-500">รอบวันที่ {filters.dateFrom || '-'} ถึง {filters.dateTo || '-'}</p>
            </div>
            <button onClick={() => window.print()} className="px-4 py-2 bg-emerald-600 text-white rounded inline-flex items-center gap-2">
              <Printer className="h-4 w-4" /> พิมพ์
            </button>
          </div>

          <div className="space-y-6">
            {previewGroups.map((group: any) => (
              <div key={`preview-${group.contractorId}`} className="rounded border bg-white p-4">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xl font-bold">สรุปรอบจ่ายผู้รับเหมา</div>
                    <div className="text-sm">ผู้รับเหมา: <span className="font-semibold">{group.contractor?.name || '-'}</span></div>
                    <div className="text-sm text-slate-600">รอบวันที่ {filters.dateFrom || '-'} ถึง {filters.dateTo || '-'}</div>
                  </div>
                  <div className="text-right text-sm">
                    <div>จำนวนใบเบิก: {group.bills.length}</div>
                    <div>จำนวนแปลง: {group.plots.length}</div>
                    <div className="font-bold text-emerald-700">รวมสุทธิ: ฿{formatCurrency(group.previewTotal)}</div>
                  </div>
                </div>

                {group.plots.map((plotGroup: any) => (
                  <div key={plotGroup.key} className="mb-4 last:mb-0">
                    <div className="mb-2 rounded border bg-slate-50 px-3 py-2 flex items-center justify-between">
                      <div>
                        <div className="font-semibold">{plotGroup.projectName} • แปลง {plotGroup.plotNo}</div>
                        <div className="text-xs text-slate-500">ประเภทบ้าน: {plotGroup.plotType || '-'}</div>
                      </div>
                      <div className="font-bold text-emerald-700">฿{formatCurrency(plotGroup.total)}</div>
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
                          {plotGroup.lines.map((line: any, idx: number) => (
                            <tr key={`${plotGroup.key}-${line.billId}-${idx}`}>
                              <td className="border px-2 py-1">#{String(line.docNo || '-').padStart(4, '0')}</td>
                              <td className="border px-2 py-1">{line.billingDate ? new Date(line.billingDate).toLocaleDateString('th-TH') : '-'}</td>
                              <td className="border px-2 py-1">{line.projectName}</td>
                              <td className="border px-2 py-1">{line.plotNo}</td>
                              <td className="border px-2 py-1">{line.plotType || '-'}</td>
                              <td className="border px-2 py-1">
                                <div>{line.description}</div>
                                {line.note ? <div className="text-[10px] text-slate-500">{line.note}</div> : null}
                              </td>
                              <td className="border px-2 py-1 text-right">{line.qty} {line.unit}</td>
                              <td className="border px-2 py-1 text-right">฿{formatCurrency(line.unitPrice)}</td>
                              <td className={`border px-2 py-1 text-right font-semibold ${line.totalPrice < 0 ? 'text-red-700' : ''}`}>
                                {line.totalPrice < 0 ? '-' : ''}฿{formatCurrency(Math.abs(Number(line.totalPrice || 0)))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-emerald-50">
                            <td colSpan={8} className="border px-2 py-1 text-right font-bold">รวมสุทธิแปลงนี้</td>
                            <td className="border px-2 py-1 text-right font-bold text-emerald-700">฿{formatCurrency(plotGroup.total)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4 print:shadow-none print:border">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">สรุปรอบจ่ายผู้รับเหมา (Approved)</h2>
            <p className="text-sm text-slate-600">รอบวันที่ {filters.dateFrom || '-'} ถึง {filters.dateTo || '-'}</p>
          </div>
          <div className="text-right text-sm text-slate-600">
            <div>พิมพ์เมื่อ: {printedAtLabel || '-'}</div>
            <div>จำนวนผู้รับเหมา: {grouped.length}</div>
            <div>จำนวนใบเบิก: {grandTotals.bill_count}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div className="rounded border p-3"><div className="text-slate-500">งานหลัก</div><div className="font-bold">฿{formatCurrency(grandTotals.total_work_amount)}</div></div>
          <div className="rounded border p-3"><div className="text-slate-500">งานเพิ่ม</div><div className="font-bold text-blue-700">฿{formatCurrency(grandTotals.total_add_amount)}</div></div>
          <div className="rounded border p-3"><div className="text-slate-500">งานหัก</div><div className="font-bold text-red-700">฿{formatCurrency(grandTotals.total_deduct_amount)}</div></div>
          <div className="rounded border p-3 bg-emerald-50"><div className="text-slate-500">สุทธิรวม</div><div className="font-bold text-emerald-700">฿{formatCurrency(grandTotals.net_amount)}</div></div>
        </div>
      </Card>

      {error && <Card className="p-4 text-red-600">{error}</Card>}

      {loading ? (
        <Card className="p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></Card>
      ) : grouped.length === 0 ? (
        <Card className="p-8 text-center text-slate-400">ไม่พบข้อมูลใบเบิกที่อนุมัติในช่วงวันที่เลือก</Card>
      ) : (
        grouped.map((group) => (
          <Card key={group.contractorId} className="p-4 print-break-avoid print:shadow-none print:border">
            <div className="flex items-center justify-between gap-4 mb-3">
              <div>
                <h3 className="text-lg font-bold">{group.contractor?.name || 'ไม่ระบุผู้รับเหมา'}</h3>
                <p className="text-xs text-slate-500">จำนวนใบเบิกที่อนุมัติ: {group.bills.length}</p>
              </div>
              <div className="text-right text-sm">
                <div>งานหลัก: ฿{formatCurrency(group.totals.total_work_amount)}</div>
                <div>งานเพิ่ม: ฿{formatCurrency(group.totals.total_add_amount)}</div>
                <div>งานหัก: ฿{formatCurrency(group.totals.total_deduct_amount)}</div>
                <div className="font-bold text-emerald-700">สุทธิ: ฿{formatCurrency(group.totals.net_amount)}</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border">
                <thead className="bg-slate-50">
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left">เลขที่ใบเบิก</th>
                    <th className="px-3 py-2 text-left">วันที่</th>
                    <th className="px-3 py-2 text-left">โครงการ / แปลง</th>
                    <th className="px-3 py-2 text-left">ประเภท</th>
                    <th className="px-3 py-2 text-right">งานหลัก</th>
                    <th className="px-3 py-2 text-right">เพิ่ม</th>
                    <th className="px-3 py-2 text-right">หัก</th>
                    <th className="px-3 py-2 text-right">สุทธิ</th>
                    <th className="px-3 py-2 text-center no-print">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {group.bills.map((bill: any) => {
                    const plotLabel = bill.plots?.name || '-'
                    const isExtra = bill.type === 'extra_work'
                    return (
                      <Fragment key={bill.id}>
                        <tr className="border-b align-top">
                          <td className="px-3 py-2 font-semibold">#{String(bill.doc_no || '-').padStart(4, '0')}</td>
                          <td className="px-3 py-2">{bill.billing_date ? new Date(bill.billing_date).toLocaleDateString('th-TH') : '-'}</td>
                          <td className="px-3 py-2">
                            <div>{bill.projects?.name || '-'}</div>
                            <div className="text-xs text-slate-500">แปลง {plotLabel}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div>{isExtra ? 'งานเพิ่ม / DC' : 'งวดงานหลัก'}</div>
                            {bill.reason_for_dc && <div className="text-xs text-slate-500">{bill.reason_for_dc}</div>}
                          </td>
                          <td className="px-3 py-2 text-right">฿{formatCurrency(bill.total_work_amount)}</td>
                          <td className="px-3 py-2 text-right">฿{formatCurrency(bill.total_add_amount)}</td>
                          <td className="px-3 py-2 text-right">฿{formatCurrency(bill.total_deduct_amount)}</td>
                          <td className="px-3 py-2 text-right font-bold text-emerald-700">฿{formatCurrency(bill.net_amount)}</td>
                          <td className="px-3 py-2 text-center no-print">
                            <button onClick={() => handleUndoApprove(bill.id)} className="px-2 py-1 rounded border text-xs text-amber-700 hover:bg-amber-50">Undo Approve</button>
                          </td>
                        </tr>
                        <tr className="border-b bg-slate-50/40">
                          <td colSpan={9} className="px-3 py-2">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <div className="text-xs font-semibold text-slate-600 mb-1">รายการงาน</div>
                                {Array.isArray(bill.billing_jobs) && bill.billing_jobs.length > 0 ? (
                                  <table className="w-full text-xs border">
                                    <thead className="bg-white"><tr className="border-b"><th className="px-2 py-1 text-left">งาน</th><th className="px-2 py-1 text-left">แปลง</th><th className="px-2 py-1 text-right">%</th><th className="px-2 py-1 text-right">ยอด</th></tr></thead>
                                    <tbody>
                                      {bill.billing_jobs.map((job: any) => (
                                        <tr key={job.id} className="border-b last:border-b-0">
                                          <td className="px-2 py-1">{job.job_assignments?.boq_master?.item_name || '-'}</td>
                                          <td className="px-2 py-1">{job.job_assignments?.plots?.name || '-'}</td>
                                          <td className="px-2 py-1 text-right">{job.progress_percent == null ? '-' : `${Number(job.progress_percent).toFixed(2)}%`}</td>
                                          <td className="px-2 py-1 text-right">฿{formatCurrency(job.amount)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : <div className="text-xs text-slate-500">ไม่มีรายการงานหลัก</div>}
                              </div>
                              <div>
                                <div className="text-xs font-semibold text-slate-600 mb-1">รายการปรับปรุง (เพิ่ม/หัก)</div>
                                {(Array.isArray(bill.billing_adjustments) && bill.billing_adjustments.length > 0) || Number(bill.wht_percent || 0) > 0 || Number(bill.retention_percent || 0) > 0 ? (
                                  <table className="w-full text-xs border">
                                    <thead className="bg-white"><tr className="border-b"><th className="px-2 py-1 text-left">ประเภท</th><th className="px-2 py-1 text-left">รายการ</th><th className="px-2 py-1 text-right">จำนวน</th><th className="px-2 py-1 text-right">ราคา/หน่วย</th><th className="px-2 py-1 text-right">รวม</th></tr></thead>
                                    <tbody>
                                      {bill.billing_adjustments.map((adj: any) => {
                                        const lineTotal = Number(adj.quantity || 0) * Number(adj.unit_price || 0)
                                        return (
                                          <tr key={adj.id} className="border-b last:border-b-0">
                                            <td className="px-2 py-1">{adj.type === 'deduction' ? 'หัก' : 'เพิ่ม'}</td>
                                            <td className="px-2 py-1">{adj.description || '-'}</td>
                                            <td className="px-2 py-1 text-right">{adj.quantity || 0} {adj.unit || ''}</td>
                                            <td className="px-2 py-1 text-right">฿{formatCurrency(adj.unit_price)}</td>
                                            <td className="px-2 py-1 text-right">{adj.type === 'deduction' ? '-' : ''}฿{formatCurrency(lineTotal)}</td>
                                          </tr>
                                        )
                                      })}
                                      {Number(bill.wht_percent || 0) > 0 && Number(bill.total_add_amount || 0) > 0 && (
                                        <tr className="border-b last:border-b-0 text-red-700">
                                          <td className="px-2 py-1">หัก</td>
                                          <td className="px-2 py-1">หัก ณ ที่จ่าย</td>
                                          <td className="px-2 py-1 text-right">1 รายการ</td>
                                          <td className="px-2 py-1 text-right">฿{formatCurrency((Number(bill.total_add_amount || 0) * Number(bill.wht_percent || 0)) / 100)}</td>
                                          <td className="px-2 py-1 text-right">-฿{formatCurrency((Number(bill.total_add_amount || 0) * Number(bill.wht_percent || 0)) / 100)}</td>
                                        </tr>
                                      )}
                                      {Number(bill.retention_percent || 0) > 0 && Number(bill.total_work_amount || 0) > 0 && (
                                        <tr className="border-b last:border-b-0 text-red-700">
                                          <td className="px-2 py-1">หัก</td>
                                          <td className="px-2 py-1">หักประกันผลงาน</td>
                                          <td className="px-2 py-1 text-right">1 รายการ</td>
                                          <td className="px-2 py-1 text-right">฿{formatCurrency((Number(bill.total_work_amount || 0) * Number(bill.retention_percent || 0)) / 100)}</td>
                                          <td className="px-2 py-1 text-right">-฿{formatCurrency((Number(bill.total_work_amount || 0) * Number(bill.retention_percent || 0)) / 100)}</td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                ) : <div className="text-xs text-slate-500">ไม่มีรายการเพิ่ม/หัก</div>}
                              </div>
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}
    </div>
  )
}











