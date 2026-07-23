'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import { getApprovedContractorCycleReport, getBillingOptions, undoApproveBilling, markBillingsAsPaidOut, unmarkBillingsAsPaidOut } from '@/actions/billing-actions'
import { BadgeCheck, ChevronDown, ChevronRight, Loader2, Pencil, Printer, Undo2 } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import { computeActualPayout } from '@/lib/billing'

type Project = { id: string; name: string }
type Contractor = { id: string; name: string }

type Filters = {
  projectId?: string
  contractorId?: string
  month?: string
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function compareByDocNo(a: any, b: any) {
  const na = Number(a.doc_no)
  const nb = Number(b.doc_no)
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  return String(a.doc_no ?? '').localeCompare(String(b.doc_no ?? ''))
}

// month is 'YYYY-MM'; returns the first/last calendar day as 'YYYY-MM-DD'.
function monthToRange(month?: string): { dateFrom?: string; dateTo?: string } {
  if (!month) return {}
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return {}
  const dateFrom = `${month}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const dateTo = `${month}-${String(lastDay).padStart(2, '0')}`
  return { dateFrom, dateTo }
}

const RECENTLY_APPROVED_MS = 48 * 60 * 60 * 1000

function isRecentlyApproved(approvedAt?: string | null) {
  if (!approvedAt) return false
  const t = new Date(approvedAt).getTime()
  if (!Number.isFinite(t)) return false
  return Date.now() - t < RECENTLY_APPROVED_MS
}

export default function ContractorCycleReportPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [filters, setFilters] = useState<Filters>({})
  const derivedRange = useMemo(() => monthToRange(filters.month), [filters.month])
  const [activeTab, setActiveTab] = useState<'unpaid' | 'paid'>('unpaid')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [showHtmlModalPreview, setShowHtmlModalPreview] = useState(false)
  const [printedAtLabel, setPrintedAtLabel] = useState('')

  const [excludedBillIds, setExcludedBillIds] = useState<Set<string>>(new Set())
  const [expandedPaidBillIds, setExpandedPaidBillIds] = useState<Set<string>>(new Set())
  const [payOutConfirm, setPayOutConfirm] = useState<{ contractorId: string; contractorName: string; bills: any[]; total: number; isEdit?: boolean } | null>(null)
  const [payOutDate, setPayOutDate] = useState(todayISO())
  const [payOutLoading, setPayOutLoading] = useState(false)
  const [whtAppliedMap, setWhtAppliedMap] = useState<Record<string, boolean>>({})
  const [retentionAppliedMap, setRetentionAppliedMap] = useState<Record<string, boolean>>({})
  const [deductAppliedMap, setDeductAppliedMap] = useState<Record<string, boolean>>({})
  // Editable ฿ amounts, seeded from the %-based formula but overridable when
  // reality doesn't match it (e.g. a DC bill with no work-amount base for
  // retention%, that was still actually paid with a real retention hold).
  const [retentionAmountMap, setRetentionAmountMap] = useState<Record<string, number>>({})
  const [whtAmountMap, setWhtAmountMap] = useState<Record<string, number>>({})

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
      const { dateFrom, dateTo } = derivedRange
      const requestFilters =
        activeTab === 'unpaid'
          ? { projectId: filters.projectId, contractorId: filters.contractorId, dateFrom, dateTo, paymentState: 'unpaid' as const }
          : { projectId: filters.projectId, contractorId: filters.contractorId, dateFrom, dateTo, paymentState: 'paid' as const }
      const result = await getApprovedContractorCycleReport(requestFilters)
      setRows(result || [])
      setExcludedBillIds(new Set())
    } catch (e: any) {
      setError(e.message || 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  const toggleBillExcluded = (billId: string) => {
    setExcludedBillIds((prev) => {
      const next = new Set(prev)
      if (next.has(billId)) next.delete(billId)
      else next.add(billId)
      return next
    })
  }

  const togglePaidBillExpanded = (billId: string) => {
    setExpandedPaidBillIds((prev) => {
      const next = new Set(prev)
      if (next.has(billId)) next.delete(billId)
      else next.add(billId)
      return next
    })
  }

  useEffect(() => {
    runReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

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

  // Seeds the editable payout maps for a set of bills. For a fresh payment,
  // WHT/retention/deduct default to "applied" (typical case). For editing an
  // already-paid bill, default to whatever was actually saved so the accountant
  // sees the real prior state rather than a fresh guess.
  const seedPayoutMaps = (bills: any[], isEdit: boolean) => {
    const retApplied: Record<string, boolean> = {}
    const dedApplied: Record<string, boolean> = {}
    const whtApplied: Record<string, boolean> = {}
    const retAmount: Record<string, number> = {}
    const whtAmount: Record<string, number> = {}
    for (const b of bills) {
      const workAmt = Number(b.total_work_amount || 0)
      const addAmt = Number(b.total_add_amount || 0)
      const deductAmt = Number(b.total_deduct_amount || 0)
      const grossBeforeWht = workAmt + addAmt - deductAmt
      retApplied[b.id] = isEdit ? b.retention_applied !== false : true
      dedApplied[b.id] = isEdit ? b.deduct_applied !== false : true
      whtApplied[b.id] = isEdit ? !!b.wht_applied : true
      retAmount[b.id] = b.retention_amount != null ? Number(b.retention_amount) : workAmt * (Number(b.retention_percent || 0) / 100)
      whtAmount[b.id] = b.wht_amount != null ? Number(b.wht_amount) : grossBeforeWht * (Number(b.wht_percent || 0) / 100)
    }
    setRetentionAppliedMap(retApplied)
    setDeductAppliedMap(dedApplied)
    setWhtAppliedMap(whtApplied)
    setRetentionAmountMap(retAmount)
    setWhtAmountMap(whtAmount)
  }

  const resetPayoutMaps = () => {
    setRetentionAppliedMap({})
    setDeductAppliedMap({})
    setWhtAppliedMap({})
    setRetentionAmountMap({})
    setWhtAmountMap({})
  }

  const handleMarkAsPaidOut = async () => {
    if (!payOutConfirm) return
    setPayOutLoading(true)
    try {
      const billIds = payOutConfirm.bills.map((b: any) => b.id)
      await markBillingsAsPaidOut(billIds, payOutDate, whtAppliedMap, retentionAppliedMap, deductAppliedMap, retentionAmountMap, whtAmountMap)
      setPayOutConfirm(null)
      resetPayoutMaps()
      await runReport()
    } catch (e: any) {
      alert(e.message || 'Mark as paid failed')
    } finally {
      setPayOutLoading(false)
    }
  }

  const handleUnmarkPaidOut = async (billIds: string[], contractorName: string) => {
    const ok = window.confirm(`ต้องการยกเลิกสถานะ "จ่ายแล้ว" ของ ${contractorName} ใช่หรือไม่?`)
    if (!ok) return
    try {
      await unmarkBillingsAsPaidOut(billIds)
      await runReport()
    } catch (e: any) {
      alert(e.message || 'Unmark paid out failed')
    }
  }

  // Reopens the same pay-out modal for a single already-paid bill, pre-filled
  // with what was actually saved (not fresh defaults), so a mixed-up WHT vs
  // retention checkbox can be corrected in place instead of forcing a full
  // Undo → re-pay cycle for the whole batch.
  const openEditPayout = (bill: any, contractorName: string) => {
    setPayOutDate(bill.paid_out_at ? String(bill.paid_out_at).slice(0, 10) : todayISO())
    seedPayoutMaps([bill], true)
    setPayOutConfirm({
      contractorId: bill.contractor_id || 'unknown',
      contractorName,
      bills: [bill],
      total: computeActualPayout(bill),
      isEdit: true,
    })
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
              <div class="muted">รอบวันที่ ${escapeHtml(derivedRange.dateFrom || '-')} ถึง ${escapeHtml(derivedRange.dateTo || '-')}</div>
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
body{font-family:"Google Sans","Google Sans Text","Product Sans","Noto Sans Thai","Segoe UI",system-ui,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:12px;color:#0f172a;font-size:13px;line-height:1.35}
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
.type-cell{color:#475569;font-size:10px;white-space:nowrap}
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
body{font-family:"Google Sans","Google Sans Text","Product Sans","Noto Sans Thai","Segoe UI",system-ui,-apple-system,sans-serif;background:#fff;margin:0;padding:10px;color:#0f172a;font-size:13px;line-height:1.35}
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
.type-cell{color:#475569;font-size:10px;white-space:nowrap}
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
        const bills = group.bills.slice().sort(compareByDocNo)
        const totals = bills.reduce(
          (acc: any, bill: any) => {
            const workAmt = Number(bill.total_work_amount || 0)
            const addAmt = Number(bill.total_add_amount || 0)
            const deductAmt = Number(bill.total_deduct_amount || 0)
            const pmGrossAmt = workAmt + addAmt - deductAmt
            acc.total_work_amount += workAmt
            acc.total_add_amount += addAmt
            acc.total_deduct_amount += deductAmt
            acc.net_amount += Number(bill.net_amount || 0)
            acc.gross_amount += pmGrossAmt
            if (bill.paid_out_at) {
              acc.actual_transfer += computeActualPayout(bill)
            } else {
              acc.actual_transfer += pmGrossAmt
            }
            return acc
          },
          { total_work_amount: 0, total_add_amount: 0, total_deduct_amount: 0, net_amount: 0, gross_amount: 0, actual_transfer: 0 }
        )
        return { contractorId, contractor: group.contractor, bills, totals }
      })
      .sort((a, b) => collator.compare(a.contractor?.name || '', b.contractor?.name || ''))
  }, [rows, collator])

  const paidByDate = useMemo(() => {
    const dateMap = new Map<string, Map<string, { contractor: any; bills: any[] }>>()
    for (const bill of rows) {
      if (!bill.paid_out_at) continue
      const dateKey = String(bill.paid_out_at).slice(0, 10)
      if (!dateMap.has(dateKey)) dateMap.set(dateKey, new Map())
      const contractorMap = dateMap.get(dateKey)!
      const contractorKey = bill.contractor_id || 'unknown'
      if (!contractorMap.has(contractorKey)) {
        contractorMap.set(contractorKey, { contractor: bill.contractors || { name: 'ไม่ระบุผู้รับเหมา' }, bills: [] })
      }
      contractorMap.get(contractorKey)!.bills.push(bill)
    }
    return Array.from(dateMap.entries())
      .map(([date, contractorMap]) => {
        const contractorGroups = Array.from(contractorMap.entries())
          .map(([contractorId, group]) => {
            const bills = group.bills.slice().sort(compareByDocNo)
            const totalTransfer = bills.reduce((s: number, b: any) => s + computeActualPayout(b), 0)
            const totalGross = bills.reduce((s: number, b: any) => s + (Number(b.total_work_amount || 0) + Number(b.total_add_amount || 0) - Number(b.total_deduct_amount || 0)), 0)
            return { contractorId, contractor: group.contractor, bills, totalTransfer, totalGross }
          })
          .sort((a, b) => collator.compare(a.contractor?.name || '', b.contractor?.name || ''))
        const dateTotal = contractorGroups.reduce((s, cg) => s + cg.totalTransfer, 0)
        const billCount = contractorGroups.reduce((s, cg) => s + cg.bills.length, 0)
        return { date, contractorGroups, dateTotal, billCount }
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [rows, collator])

  // What actually gets printed — only the bills the user has checked, so a
  // print run isn't forced to include everything currently loaded on screen.
  const selectedGrouped = useMemo(() => {
    const selectedRows = rows.filter((bill: any) => !excludedBillIds.has(bill.id))
    const map = new Map<string, { contractor: any; bills: any[] }>()
    for (const bill of selectedRows) {
      const key = bill.contractor_id || 'unknown'
      if (!map.has(key)) map.set(key, { contractor: bill.contractors || { name: 'ไม่ระบุผู้รับเหมา' }, bills: [] })
      map.get(key)!.bills.push(bill)
    }
    return Array.from(map.entries())
      .map(([contractorId, group]) => {
        const bills = group.bills.slice().sort(compareByDocNo)
        const totals = bills.reduce(
          (acc: any, bill: any) => {
            const workAmt = Number(bill.total_work_amount || 0)
            const addAmt = Number(bill.total_add_amount || 0)
            const deductAmt = Number(bill.total_deduct_amount || 0)
            const pmGrossAmt = workAmt + addAmt - deductAmt
            acc.total_work_amount += workAmt
            acc.total_add_amount += addAmt
            acc.total_deduct_amount += deductAmt
            acc.net_amount += Number(bill.net_amount || 0)
            acc.gross_amount += pmGrossAmt
            if (bill.paid_out_at) {
              acc.actual_transfer += computeActualPayout(bill)
            } else {
              acc.actual_transfer += pmGrossAmt
            }
            return acc
          },
          { total_work_amount: 0, total_add_amount: 0, total_deduct_amount: 0, net_amount: 0, gross_amount: 0, actual_transfer: 0 }
        )
        return { contractorId, contractor: group.contractor, bills, totals }
      })
      .sort((a, b) => collator.compare(a.contractor?.name || '', b.contractor?.name || ''))
  }, [rows, excludedBillIds, collator])

  const grandTotals = useMemo(() => {
    return grouped.reduce(
      (acc, g) => {
        acc.total_work_amount += g.totals.total_work_amount
        acc.total_add_amount += g.totals.total_add_amount
        acc.total_deduct_amount += g.totals.total_deduct_amount
        acc.net_amount += g.totals.net_amount
        acc.gross_amount += g.totals.gross_amount
        acc.actual_transfer += g.totals.actual_transfer
        acc.bill_count += g.bills.length
        return acc
      },
      { total_work_amount: 0, total_add_amount: 0, total_deduct_amount: 0, net_amount: 0, gross_amount: 0, actual_transfer: 0, bill_count: 0 }
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
        lineType: 'งานหลัก',
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
        lineType: adj.type === 'deduction' ? 'งานหัก' : 'งานเพิ่ม',
      }
    })
    return [...mainLines, ...dcLines]
  }

  const previewGroups = useMemo(() => {
    return selectedGrouped.map((group) => {
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
        previewTotal: Number(group.totals.actual_transfer || 0),
      }
    })
  }, [selectedGrouped, collator])

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
              <div class="muted">เธฃเธญเธเธงเธฑเธเธ—เธตเน ${escapeHtml(derivedRange.dateFrom || '-')} เธ–เธถเธ ${escapeHtml(derivedRange.dateTo || '-')}</div>
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
  }, [previewGroups, derivedRange.dateFrom, derivedRange.dateTo])

  const invoiceTemplateHtml = useMemo(() => {
    return previewGroups.map((group: any) => {
      const whtTotal = group.bills.reduce((sum: number, b: any) => {
        if (!b.paid_out_at || !b.wht_applied) return sum
        const pmGross = Number(b.total_work_amount || 0) + Number(b.total_add_amount || 0) - Number(b.total_deduct_amount || 0)
        return sum + pmGross * (Number(b.wht_percent || 0) / 100)
      }, 0)
      const retentionTotal = group.bills.reduce((sum: number, b: any) => {
        if (!b.paid_out_at || b.retention_applied === false) return sum
        return sum + Number(b.total_work_amount || 0) * (Number(b.retention_percent || 0) / 100)
      }, 0)
      const deductTotal = group.bills.reduce((sum: number, b: any) => {
        if (!b.paid_out_at || b.deduct_applied === false) return sum
        return sum + Number(b.total_deduct_amount || 0)
      }, 0)
      const grossBeforeTax = group.bills.reduce((sum: number, b: any) => sum + Number(b.total_work_amount || 0) + Number(b.total_add_amount || 0), 0)

      const plotBlocks = group.plots.map((plotGroup: any, plotIndex: number) => {
        const rowsHtml = plotGroup.lines.map((line: any) => `
          <tr>
            <td>${plotIndex + 1}</td>
            <td>${escapeHtml(line.plotNo)}</td>
            <td class="type-cell">${escapeHtml(line.lineType || '-')}</td>
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
                  <th style="width:30px">#</th>
                  <th style="width:80px">บ้าน/แปลง</th>
                  <th style="width:70px">ประเภท</th>
                  <th>รายละเอียดงาน</th>
                  <th class="num" style="width:90px">Qty</th>
                  <th class="num" style="width:110px">ราคา/หน่วย</th>
                  <th class="num" style="width:120px">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
              <tfoot>
                <tr>
                  <td colspan="6" class="num strong">รวมสุทธิแปลงนี้</td>
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
              <div><span>รอบจ่าย:</span> ${escapeHtml(derivedRange.dateFrom || '-')} ถึง ${escapeHtml(derivedRange.dateTo || '-')}</div>
              <div><span>ผู้รับเหมา:</span> ${escapeHtml(group.contractor?.name || '-')}</div>
              <div><span>จำนวนใบเบิก:</span> ${group.bills.length}</div>
              <div><span>จำนวนแปลง:</span> ${group.plots.length}</div>
              <div><span>พิมพ์เมื่อ:</span> ${escapeHtml(printedAtLabel || '-')}</div>
            </div>
          </header>

          <section class="summary-grid">
            <div class="sum-card"><label>งานหลัก + งานเพิ่ม</label><strong>฿${formatCurrency(Number(group.totals.total_work_amount) + Number(group.totals.total_add_amount))}</strong></div>
            <div class="sum-card"><label>งานหัก (หักจริง)</label><strong>−฿${formatCurrency(deductTotal)}</strong></div>
            <div class="sum-card"><label>หักประกันผลงาน</label><strong>${retentionTotal > 0 ? `−฿${formatCurrency(retentionTotal)}` : '−'}</strong></div>
            <div class="sum-card"><label>หัก ณ ที่จ่าย</label><strong>${whtTotal > 0 ? `−฿${formatCurrency(whtTotal)}` : '−'}</strong></div>
            <div class="sum-card"><label>ยอดรวม (ก่อนหัก)</label><strong>฿${formatCurrency(grossBeforeTax)}</strong></div>
            <div class="sum-card total"><label>ยอดโอนจริง</label><strong>฿${formatCurrency(group.previewTotal)}</strong></div>
          </section>

          <section class="invoice-body">
            ${plotBlocks}
          </section>

          <section class="invoice-footer">
            <div class="remark-box">
              <div class="remark-title">หมายเหตุ</div>
              <div class="sub">ยอดรวมก่อนหัก (งานหลัก + งานเพิ่ม) : ฿${formatCurrency(grossBeforeTax)}</div>
              ${deductTotal > 0 ? `<div class="sub">งานหักจริง : −฿${formatCurrency(deductTotal)}</div>` : ''}
              ${retentionTotal > 0 ? `<div class="sub">หักประกันผลงาน : −฿${formatCurrency(retentionTotal)}</div>` : ''}
              ${whtTotal > 0 ? `<div class="sub">หัก ณ ที่จ่าย : −฿${formatCurrency(whtTotal)}</div>` : ''}
              <div class="sub strong">ยอดโอนจริง : ฿${formatCurrency(group.previewTotal)}</div>
            </div>
          </section>
        </section>
      `
    }).join('')
  }, [previewGroups, derivedRange.dateFrom, derivedRange.dateTo, printedAtLabel])

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
        <PageHeader
          title="รายงานสรุปรอบจ่ายผู้รับเหมา"
          subtitle="รวมใบเบิกที่อนุมัติแล้ว แยกตามผู้รับเหมา พร้อมสรุปสำหรับฝ่ายบัญชี"
        />
      </div>

      <div className="flex gap-1 rounded-lg border bg-slate-100 p-1 no-print w-fit">
        <button
          onClick={() => setActiveTab('unpaid')}
          className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
            activeTab === 'unpaid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          รอจ่าย
        </button>
        <button
          onClick={() => setActiveTab('paid')}
          className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
            activeTab === 'paid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          จ่ายแล้ว
        </button>
      </div>

      <Card className="p-4 no-print">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600">{activeTab === 'paid' ? 'เดือนที่จ่าย' : 'เดือนของบิล'}</label>
            <input type="month" className="mt-1 w-full" value={filters.month || ''} onChange={(e) => setFilters((p) => ({ ...p, month: e.target.value || undefined }))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">โครงการ</label>
            <select className="mt-1 w-full" value={filters.projectId || ''} onChange={(e) => setFilters((p) => ({ ...p, projectId: e.target.value || undefined }))}>
              <option value="">ทั้งหมด</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600">ผู้รับเหมา</label>
            <select className="mt-1 w-full" value={filters.contractorId || ''} onChange={(e) => setFilters((p) => ({ ...p, contractorId: e.target.value || undefined }))}>
              <option value="">ทั้งหมด</option>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        {activeTab === 'unpaid' && !filters.month && (
          <p className="mt-2 text-xs text-slate-400">ไม่ได้เลือกเดือน — แสดงทุกใบเบิกที่รออนุมัติจ่าย</p>
        )}
        <div className="mt-3 flex items-center justify-end gap-2">
          {(() => {
            const selectedCount = selectedGrouped.reduce((s, g) => s + g.bills.length, 0)
            return selectedCount < rows.length ? (
              <span className="text-xs text-slate-400">เลือกพิมพ์ {selectedCount}/{rows.length} ใบเบิก</span>
            ) : null
          })()}
          <Button variant="secondary" onClick={runReport}>ค้นหา</Button>
          <Button
            onClick={() => setShowHtmlModalPreview(true)}
            disabled={selectedGrouped.reduce((s, g) => s + g.bills.length, 0) === 0}
          >
            <Printer className="h-4 w-4" /> Print{(() => {
              const selectedCount = selectedGrouped.reduce((s, g) => s + g.bills.length, 0)
              return selectedCount > 0 && selectedCount < rows.length ? ` (${selectedCount})` : ''
            })()}
          </Button>
        </div>
      </Card>
      <Modal
        isOpen={showHtmlModalPreview}
        onClose={() => setShowHtmlModalPreview(false)}
        title="Print Preview"
        panelClassName="max-w-[98vw] h-[92vh] max-h-[95dvh]"
        bodyClassName="p-2"
      >
        <div className="space-y-3 html-preview-modal-host">
          <div className="flex justify-end gap-2 no-print-in-modal">
            <button onClick={printModalTemplate} className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm">
              Print
            </button>
          </div>
          <div className="max-h-[calc(90dvh-140px)] overflow-auto rounded-xl border bg-slate-50 p-3">
            <style>{`
              .html-preview-modal{font-family:"Google Sans","Google Sans Text","Product Sans","Noto Sans Thai","Segoe UI",system-ui,-apple-system,sans-serif;color:#0f172a;font-size:14px;line-height:1.45}
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
              .html-preview-modal .type-cell{color:#475569;font-size:11px;white-space:nowrap}
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
              <p className="text-sm text-slate-500">รอบวันที่ {derivedRange.dateFrom || '-'} ถึง {derivedRange.dateTo || '-'}</p>
            </div>
            <button onClick={() => window.print()} className="px-4 py-2 bg-emerald-600 text-white rounded-lg inline-flex items-center gap-2">
              <Printer className="h-4 w-4" /> พิมพ์
            </button>
          </div>

          <div className="space-y-6">
            {previewGroups.map((group: any) => (
              <div key={`preview-${group.contractorId}`} className="rounded-xl border bg-white p-4">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xl font-bold">สรุปรอบจ่ายผู้รับเหมา</div>
                    <div className="text-sm">ผู้รับเหมา: <span className="font-semibold">{group.contractor?.name || '-'}</span></div>
                    <div className="text-sm text-slate-600">รอบวันที่ {derivedRange.dateFrom || '-'} ถึง {derivedRange.dateTo || '-'}</div>
                  </div>
                  <div className="text-right text-sm">
                    <div>จำนวนใบเบิก: {group.bills.length}</div>
                    <div>จำนวนแปลง: {group.plots.length}</div>
                    <div className="font-bold text-emerald-700">รวมสุทธิ: ฿{formatCurrency(group.previewTotal)}</div>
                  </div>
                </div>

                {group.plots.map((plotGroup: any) => (
                  <div key={plotGroup.key} className="mb-4 last:mb-0">
                    <div className="mb-2 rounded-lg border bg-slate-50 px-3 py-2 flex items-center justify-between">
                      <div>
                        <div className="font-semibold">{plotGroup.projectName} • แปลง {plotGroup.plotNo}</div>
                        <div className="text-xs text-slate-500">ประเภทบ้าน: {plotGroup.plotType || '-'}</div>
                      </div>
                      <div className="font-bold text-emerald-700">฿{formatCurrency(plotGroup.total)}</div>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-xs">
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
            <h2 className="text-xl font-bold">สรุปรอบจ่ายผู้รับเหมา ({activeTab === 'paid' ? 'จ่ายแล้ว' : 'รอจ่าย'})</h2>
            <p className="text-sm text-slate-600">
              {activeTab === 'paid' ? `จ่ายเมื่อ ${derivedRange.dateFrom || '-'} ถึง ${derivedRange.dateTo || '-'}` : 'ทุกใบเบิกที่รออนุมัติจ่าย'}
            </p>
          </div>
          <div className="text-right text-sm text-slate-600">
            <div>พิมพ์เมื่อ: {printedAtLabel || '-'}</div>
            <div>จำนวนผู้รับเหมา: {grouped.length}</div>
            <div>จำนวนใบเบิก: {grandTotals.bill_count}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg border p-3 bg-slate-50">
            <div className="text-slate-500 text-xs">ยอดรวมทั้งหมด (ก่อนหัก)</div>
            <div className="font-bold text-lg text-slate-700">฿{formatCurrency(grandTotals.gross_amount)}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">งานหลัก ฿{formatCurrency(grandTotals.total_work_amount)} · งานเพิ่ม ฿{formatCurrency(grandTotals.total_add_amount)} · งานหัก −฿{formatCurrency(grandTotals.total_deduct_amount)}</div>
          </div>
          <div className="rounded-lg border p-3 bg-emerald-50">
            <div className="text-slate-500 text-xs">ยอดโอนจริง (หลังหักทั้งหมด)</div>
            <div className="font-bold text-lg text-emerald-700">฿{formatCurrency(grandTotals.actual_transfer)}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{grandTotals.bill_count} ใบเบิก · {grouped.length} ผู้รับเหมา</div>
          </div>
        </div>
      </Card>

      {/* Pay-out confirmation modal */}
      <Modal
        isOpen={!!payOutConfirm}
        onClose={() => { setPayOutConfirm(null); resetPayoutMaps() }}
        title={payOutConfirm?.isEdit ? 'แก้ไขการจ่ายเงิน' : 'ยืนยันการจ่ายเงิน'}
        panelClassName="max-w-md"
      >
        {payOutConfirm && (() => {
          const billDetails = payOutConfirm.bills.map((b: any) => {
            const isDC = b.type === 'extra_work'
            const workAmt = b.total_work_amount ?? 0
            const addAmt = b.total_add_amount ?? 0
            const deductAmt = b.total_deduct_amount ?? 0
            const retPct = b.retention_percent ?? 0
            const whtPct = b.wht_percent ?? 0
            const baseAmt = workAmt + addAmt
            const applyDeduct = deductAppliedMap[b.id] ?? true
            const actualDeduct = applyDeduct ? deductAmt : 0
            const applyRetention = retentionAppliedMap[b.id] ?? true
            const retAmt = retentionAmountMap[b.id] ?? 0
            const actualRetention = applyRetention ? retAmt : 0
            const applyWht = whtAppliedMap[b.id] ?? false
            const whtAmt = whtAmountMap[b.id] ?? 0
            const actualWht = applyWht ? whtAmt : 0
            const transfer = baseAmt - actualDeduct - actualRetention - actualWht
            return { b, isDC, workAmt, addAmt, deductAmt, retPct, whtPct, retAmt, whtAmt, baseAmt, applyDeduct, actualDeduct, applyRetention, actualRetention, applyWht, actualWht, transfer }
          })

          const grandTransfer = billDetails.reduce((s, d) => s + d.transfer, 0)
          const grandDeduct = billDetails.reduce((s, d) => s + d.actualDeduct, 0)
          const grandRetention = billDetails.reduce((s, d) => s + d.actualRetention, 0)
          const grandWht = billDetails.reduce((s, d) => s + d.actualWht, 0)
          const grandGross = billDetails.reduce((s, d) => s + d.baseAmt, 0)

          return (
            <div className="space-y-4">
              {/* Controls row */}
              <div className="flex gap-4 flex-wrap">
                <div className="flex-1 min-w-32">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">วันที่โอนเงิน</label>
                  <input type="date" value={payOutDate} onChange={(e) => setPayOutDate(e.target.value)} className="w-full text-sm" />
                </div>
              </div>

              {/* POS-style receipt */}
              <div className="font-mono text-xs bg-white border-2 border-dashed border-slate-300 rounded-lg p-4 max-h-[50vh] overflow-y-auto">
                <div className="text-center mb-2">
                  <div className="font-bold text-sm">{payOutConfirm.contractorName}</div>
                  <div className="text-slate-500">{payOutDate ? new Date(payOutDate).toLocaleDateString('th-TH', { day: '2-digit', month: 'long', year: 'numeric' }) : '-'}</div>
                </div>
                <div className="border-t border-dashed border-slate-300 my-2" />

                {billDetails.map(({ b, isDC, workAmt, addAmt, deductAmt, retPct, whtPct, retAmt, whtAmt, applyDeduct, applyRetention, applyWht, transfer }) => (
                  <div key={b.id} className="mb-3">
                    <div className="flex justify-between font-semibold text-slate-700">
                      <span>{isDC ? '[DC]' : '[หลัก]'} #{String(b.doc_no || '-').padStart(4, '0')}</span>
                      <span>{b.billing_date ? new Date(b.billing_date).toLocaleDateString('th-TH') : '-'}</span>
                    </div>
                    <div className="text-slate-500 mb-1">{b.projects?.name ?? '-'}</div>
                    {workAmt > 0 && <div className="flex justify-between"><span>งานหลัก</span><span>฿{formatCurrency(workAmt)}</span></div>}
                    {addAmt > 0 && <div className="flex justify-between"><span>งานเพิ่ม DC</span><span>฿{formatCurrency(addAmt)}</span></div>}
                    {deductAmt > 0 && (
                      <label className="flex items-center justify-between mt-0.5 cursor-pointer select-none">
                        <span className={`flex items-center gap-1.5 ${applyDeduct ? 'text-red-600' : 'text-slate-300 line-through'}`}>
                          <input type="checkbox" checked={applyDeduct} onChange={(e) => setDeductAppliedMap(prev => ({ ...prev, [b.id]: e.target.checked }))} className="accent-red-600" />
                          งานหัก
                        </span>
                        <span className={applyDeduct ? 'text-red-600' : 'text-slate-300 line-through'}>−฿{formatCurrency(deductAmt)}</span>
                      </label>
                    )}
                    <label className="flex items-center justify-between mt-0.5 gap-2 cursor-pointer select-none">
                      <span className={`flex items-center gap-1.5 shrink-0 ${applyRetention ? 'text-slate-600' : 'text-slate-300 line-through'}`}>
                        <input type="checkbox" checked={applyRetention} onChange={(e) => setRetentionAppliedMap(prev => ({ ...prev, [b.id]: e.target.checked }))} className="accent-slate-600" />
                        หักประกัน{retPct > 0 ? ` (ปกติ ${retPct}%)` : ''}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <span className={applyRetention ? 'text-red-600' : 'text-slate-300'}>−฿</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={!applyRetention}
                          value={retAmt}
                          onChange={(e) => setRetentionAmountMap(prev => ({ ...prev, [b.id]: Math.max(0, Number(e.target.value) || 0) }))}
                          className={`w-20 rounded border px-1 py-0.5 text-right font-mono text-xs ${applyRetention ? 'text-red-600 border-slate-300' : 'text-slate-300 border-slate-200 bg-slate-50'}`}
                        />
                      </span>
                    </label>
                    <label className="flex items-center justify-between mt-0.5 gap-2 cursor-pointer select-none">
                      <span className={`flex items-center gap-1.5 shrink-0 ${applyWht ? 'text-amber-700' : 'text-slate-300 line-through'}`}>
                        <input type="checkbox" checked={applyWht} onChange={(e) => setWhtAppliedMap(prev => ({ ...prev, [b.id]: e.target.checked }))} className="accent-amber-600" />
                        หัก WHT{whtPct > 0 ? ` (ปกติ ${whtPct}%)` : ''}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <span className={applyWht ? 'text-amber-700' : 'text-slate-300'}>−฿</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={!applyWht}
                          value={whtAmt}
                          onChange={(e) => setWhtAmountMap(prev => ({ ...prev, [b.id]: Math.max(0, Number(e.target.value) || 0) }))}
                          className={`w-20 rounded border px-1 py-0.5 text-right font-mono text-xs ${applyWht ? 'text-amber-700 border-slate-300' : 'text-slate-300 border-slate-200 bg-slate-50'}`}
                        />
                      </span>
                    </label>
                    <div className="border-t border-dotted border-slate-200 mt-1 pt-1 flex justify-between font-bold">
                      <span>โอน</span>
                      <span className="text-emerald-700">฿{formatCurrency(transfer)}</span>
                    </div>
                  </div>
                ))}

                <div className="border-t-2 border-dashed border-slate-400 mt-2 pt-2 space-y-0.5">
                  <div className="flex justify-between text-slate-600"><span>ยอดรวมทั้งหมด</span><span>฿{formatCurrency(grandGross)}</span></div>
                  {grandDeduct > 0 && <div className="flex justify-between text-red-600"><span>หักงานหักรวม</span><span>−฿{formatCurrency(grandDeduct)}</span></div>}
                  {grandRetention > 0 && <div className="flex justify-between text-slate-600"><span>หักประกันรวม</span><span>−฿{formatCurrency(grandRetention)}</span></div>}
                  {grandWht > 0 && <div className="flex justify-between text-amber-700"><span>หัก WHT รวม</span><span>−฿{formatCurrency(grandWht)}</span></div>}
                  <div className="flex justify-between font-bold text-base text-emerald-700 border-t border-slate-400 pt-1 mt-1">
                    <span>ยอดโอนจริง</span>
                    <span>฿{formatCurrency(grandTransfer)}</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1 border-t">
                <Button variant="secondary" onClick={() => { setPayOutConfirm(null); resetPayoutMaps() }}>ยกเลิก</Button>
                <button onClick={handleMarkAsPaidOut} disabled={payOutLoading || !payOutDate} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50">
                  {payOutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                  {payOutConfirm.isEdit ? `บันทึกการแก้ไข ฿${formatCurrency(grandTransfer)}` : `ยืนยันจ่าย ฿${formatCurrency(grandTransfer)}`}
                </button>
              </div>
            </div>
          )
        })()}
      </Modal>

      {error && <Card className="p-4 text-red-600">{error}</Card>}

      {loading ? (
        <Card className="p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></Card>
      ) : activeTab === 'paid' ? (
        paidByDate.length === 0 ? (
          <Card className="p-8 text-center text-slate-400">ไม่พบใบเบิกที่จ่ายแล้วในช่วงวันที่เลือก</Card>
        ) : (
          paidByDate.map((dateGroup) => (
            <Card key={dateGroup.date} className="p-4 print-break-avoid">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 mb-3">
                <div>
                  <div className="text-lg font-bold">
                    {new Date(`${dateGroup.date}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                  <p className="text-xs text-slate-500">{dateGroup.billCount} ใบเบิก · {dateGroup.contractorGroups.length} ผู้รับเหมา</p>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">ยอดโอนรวมวันนี้</div>
                  <div className="text-lg font-bold text-emerald-700">฿{formatCurrency(dateGroup.dateTotal)}</div>
                </div>
              </div>

              <div className="space-y-4">
                {dateGroup.contractorGroups.map((cg) => (
                  <div key={cg.contractorId} className="overflow-hidden rounded-lg border border-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2 border-b">
                      <div className="font-semibold text-sm">{cg.contractor?.name || 'ไม่ระบุผู้รับเหมา'}</div>
                      <div className="flex items-center gap-3">
                        <div className="text-sm font-bold text-emerald-700">฿{formatCurrency(cg.totalTransfer)}</div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleUnmarkPaidOut(cg.bills.map((b: any) => b.id), cg.contractor?.name || '-')}
                          className="no-print px-2 py-1 text-xs"
                        >
                          <Undo2 className="h-3 w-3" /> Undo
                        </Button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-white">
                          <tr className="border-b text-xs text-slate-500">
                            <th className="px-3 py-1.5 text-center no-print w-8">
                              <input
                                type="checkbox"
                                checked={cg.bills.every((b: any) => !excludedBillIds.has(b.id))}
                                ref={(el) => {
                                  if (el) {
                                    const selectedCount = cg.bills.filter((b: any) => !excludedBillIds.has(b.id)).length
                                    el.indeterminate = selectedCount > 0 && selectedCount < cg.bills.length
                                  }
                                }}
                                onChange={() => {
                                  const allSelected = cg.bills.every((b: any) => !excludedBillIds.has(b.id))
                                  setExcludedBillIds((prev) => {
                                    const next = new Set(prev)
                                    if (allSelected) {
                                      cg.bills.forEach((b: any) => next.add(b.id))
                                    } else {
                                      cg.bills.forEach((b: any) => next.delete(b.id))
                                    }
                                    return next
                                  })
                                }}
                              />
                            </th>
                            <th className="px-3 py-1.5 text-left w-6"></th>
                            <th className="px-3 py-1.5 text-left">เลขที่ใบเบิก</th>
                            <th className="px-3 py-1.5 text-left">วันที่บิล / อนุมัติ</th>
                            <th className="px-3 py-1.5 text-left">โครงการ / แปลง</th>
                            <th className="px-3 py-1.5 text-right">ยอดรวม</th>
                            <th className="px-3 py-1.5 text-right">หัก</th>
                            <th className="px-3 py-1.5 text-right">ยอดโอน</th>
                            <th className="px-3 py-1.5 text-center no-print">จัดการ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cg.bills.map((bill: any) => {
                            const workAmt = Number(bill.total_work_amount || 0)
                            const addAmt = Number(bill.total_add_amount || 0)
                            const deductAmt = Number(bill.total_deduct_amount || 0)
                            const grossAmt = workAmt + addAmt - deductAmt
                            const retentionAmt = bill.retention_amount != null ? Number(bill.retention_amount) : workAmt * (Number(bill.retention_percent || 0) / 100)
                            const whtAmt = bill.wht_applied
                              ? (bill.wht_amount != null ? Number(bill.wht_amount) : grossAmt * (Number(bill.wht_percent || 0) / 100))
                              : 0
                            const transfer = computeActualPayout(bill)
                            const showRetention = bill.retention_applied !== false && retentionAmt > 0
                            const showDeduct = bill.deduct_applied !== false && deductAmt > 0
                            const isExpanded = expandedPaidBillIds.has(bill.id)
                            return (
                              <Fragment key={bill.id}>
                                <tr
                                  onClick={() => togglePaidBillExpanded(bill.id)}
                                  className="border-b last:border-b-0 align-top cursor-pointer hover:bg-slate-50"
                                >
                                  <td className="px-3 py-2 text-center no-print" onClick={(e) => e.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      checked={!excludedBillIds.has(bill.id)}
                                      onChange={() => toggleBillExcluded(bill.id)}
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-slate-400">
                                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                  </td>
                                  <td className="px-3 py-2 font-semibold">#{String(bill.doc_no || '-').padStart(4, '0')}</td>
                                  <td className="px-3 py-2">
                                    <div>{bill.billing_date ? new Date(bill.billing_date).toLocaleDateString('th-TH') : '-'}</div>
                                    <div className="text-xs text-slate-400">
                                      อนุมัติ {bill.approved_at ? new Date(bill.approved_at).toLocaleDateString('th-TH') : '-'}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <div>{bill.projects?.name || '-'}</div>
                                    <div className="text-xs text-slate-500">แปลง {bill.plots?.name || '-'}</div>
                                  </td>
                                  <td className="px-3 py-2 text-right">฿{formatCurrency(grossAmt)}</td>
                                  <td className="px-3 py-2 text-right">
                                    <div className="flex flex-col items-end gap-0.5">
                                      {showDeduct && <span className="text-[10px] text-red-600">หักงาน −฿{formatCurrency(deductAmt)}</span>}
                                      {showRetention && <span className="text-[10px] text-orange-600">ประกัน −฿{formatCurrency(retentionAmt)}</span>}
                                      {whtAmt > 0 && <span className="text-[10px] text-amber-700">WHT −฿{formatCurrency(whtAmt)}</span>}
                                      {!showDeduct && !showRetention && whtAmt <= 0 && <span className="text-[10px] text-slate-300">-</span>}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-right font-bold text-blue-700">฿{formatCurrency(transfer)}</td>
                                  <td className="px-3 py-2 text-center no-print">
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={(e) => { e.stopPropagation(); openEditPayout(bill, cg.contractor?.name || '-') }}
                                      title="แก้ไข WHT / ประกัน / วันที่จ่าย"
                                      className="px-2 py-1 text-xs"
                                    >
                                      <Pencil className="h-3 w-3" /> แก้ไข
                                    </Button>
                                  </td>
                                </tr>
                                {isExpanded && (
                                  <tr className="border-b last:border-b-0 bg-slate-50/40">
                                    <td colSpan={9} className="px-3 py-2">
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                          <div className="text-xs font-semibold text-slate-600 mb-1">รายการงาน</div>
                                          {Array.isArray(bill.billing_jobs) && bill.billing_jobs.length > 0 ? (
                                            <table className="w-full overflow-hidden rounded-lg border border-slate-200 text-xs">
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
                                          {(Array.isArray(bill.billing_adjustments) && bill.billing_adjustments.length > 0) || whtAmt > 0 || showRetention ? (
                                            <table className="w-full overflow-hidden rounded-lg border border-slate-200 text-xs">
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
                                                {whtAmt > 0 && (
                                                  <tr className="border-b last:border-b-0 text-amber-700">
                                                    <td className="px-2 py-1">หัก</td>
                                                    <td className="px-2 py-1">หัก ณ ที่จ่าย {bill.wht_percent}%</td>
                                                    <td className="px-2 py-1 text-right">1 รายการ</td>
                                                    <td className="px-2 py-1 text-right">฿{formatCurrency(whtAmt)}</td>
                                                    <td className="px-2 py-1 text-right">−฿{formatCurrency(whtAmt)}</td>
                                                  </tr>
                                                )}
                                                {showRetention && (
                                                  <tr className="border-b last:border-b-0 text-orange-700">
                                                    <td className="px-2 py-1">หัก</td>
                                                    <td className="px-2 py-1">หักประกันผลงาน {bill.retention_percent}%</td>
                                                    <td className="px-2 py-1 text-right">1 รายการ</td>
                                                    <td className="px-2 py-1 text-right">฿{formatCurrency(retentionAmt)}</td>
                                                    <td className="px-2 py-1 text-right">−฿{formatCurrency(retentionAmt)}</td>
                                                  </tr>
                                                )}
                                                {showDeduct && (
                                                  <tr className="border-b last:border-b-0 text-red-700">
                                                    <td className="px-2 py-1">หัก</td>
                                                    <td className="px-2 py-1">งานหัก</td>
                                                    <td className="px-2 py-1 text-right">1 รายการ</td>
                                                    <td className="px-2 py-1 text-right">฿{formatCurrency(deductAmt)}</td>
                                                    <td className="px-2 py-1 text-right">−฿{formatCurrency(deductAmt)}</td>
                                                  </tr>
                                                )}
                                              </tbody>
                                            </table>
                                          ) : <div className="text-xs text-slate-500">ไม่มีรายการเพิ่ม/หัก</div>}
                                          {bill.paid_out_at && (
                                            <div className="mt-2 text-[11px] text-slate-500">จ่ายเมื่อ {new Date(bill.paid_out_at).toLocaleString('th-TH')}</div>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))
        )
      ) : grouped.length === 0 ? (
        <Card className="p-8 text-center text-slate-400">ไม่พบใบเบิกที่รอจ่าย</Card>
      ) : (
        grouped.map((group) => {
          const billIds = group.bills.map((b: any) => b.id)
          const paidCount = group.bills.filter((b: any) => !!b.paid_out_at).length
          const allPaid = paidCount === group.bills.length && group.bills.length > 0
          const somePaid = paidCount > 0 && !allPaid
          const hasRecentlyApproved = group.bills.some((b: any) => !b.paid_out_at && isRecentlyApproved(b.approved_at))
          const unpaidBills = group.bills.filter((b: any) => !b.paid_out_at)
          const selectedUnpaidBills = unpaidBills.filter((b: any) => !excludedBillIds.has(b.id))
          const allUnpaidSelected = unpaidBills.length > 0 && selectedUnpaidBills.length === unpaidBills.length
          const someUnpaidSelected = selectedUnpaidBills.length > 0 && selectedUnpaidBills.length < unpaidBills.length
          const hasSelection = unpaidBills.length > 0
          const selectedTotals = (hasSelection ? selectedUnpaidBills : group.bills).reduce(
            (acc: any, bill: any) => {
              const gross = Number(bill.total_work_amount || 0) + Number(bill.total_add_amount || 0) - Number(bill.total_deduct_amount || 0)
              acc.gross += gross
              acc.transfer += bill.paid_out_at ? computeActualPayout(bill) : gross
              return acc
            },
            { gross: 0, transfer: 0 }
          )
          const latestPaidAt = allPaid
            ? group.bills.reduce((latest: string, b: any) => {
                const d = b.paid_out_at || ''
                return d > latest ? d : latest
              }, '')
            : null

          return (
          <Card key={group.contractorId} className={`p-4 print-break-avoid print:shadow-none print:border ${allPaid ? 'border-emerald-200 bg-emerald-50/30' : ''}`}>
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-bold">{group.contractor?.name || 'ไม่ระบุผู้รับเหมา'}</h3>
                  {allPaid && (
                    <Badge tone="success" className="gap-1">
                      <BadgeCheck className="h-3 w-3" /> จ่ายแล้ว {latestPaidAt ? new Date(latestPaidAt).toLocaleDateString('th-TH') : ''}
                    </Badge>
                  )}
                  {somePaid && (
                    <Badge tone="warning">
                      จ่ายบางส่วน ({paidCount}/{group.bills.length})
                    </Badge>
                  )}
                  {!allPaid && !somePaid && (
                    <Badge tone="neutral">
                      รอจ่าย
                    </Badge>
                  )}
                  {hasRecentlyApproved && (
                    <Badge tone="info">
                      มีรายการอนุมัติใหม่
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-slate-500">จำนวนใบเบิกที่อนุมัติ: {group.bills.length}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="text-right text-sm">
                  {hasSelection && !allUnpaidSelected && (
                    <div className="text-[11px] text-blue-600 font-medium">เลือก {selectedUnpaidBills.length}/{unpaidBills.length} ใบเบิก</div>
                  )}
                  <div className="text-slate-600">ยอดรวม: ฿{formatCurrency(selectedTotals.gross)}</div>
                  <div className="font-bold text-emerald-700">ยอดโอน: ฿{formatCurrency(selectedTotals.transfer)}</div>
                </div>
                <div className="flex gap-2 no-print">
                  {!allPaid && (
                    <button
                      disabled={selectedUnpaidBills.length === 0}
                      onClick={() => {
                        setPayOutDate(todayISO())
                        seedPayoutMaps(selectedUnpaidBills, false)
                        const total = selectedUnpaidBills.reduce((s: number, b: any) => s + Number(b.net_amount || 0), 0)
                        setPayOutConfirm({ contractorId: group.contractorId, contractorName: group.contractor?.name || '-', bills: selectedUnpaidBills, total })
                      }}
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <BadgeCheck className="h-3.5 w-3.5" /> Mark as Paid ({selectedUnpaidBills.length})
                    </button>
                  )}
                  {(allPaid || somePaid) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleUnmarkPaidOut(group.bills.filter((b: any) => !!b.paid_out_at).map((b: any) => b.id), group.contractor?.name || '-')}
                      className="px-3 py-1.5 text-xs"
                    >
                      <Undo2 className="h-3.5 w-3.5" /> Undo
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200">
                    {unpaidBills.length > 0 && (
                      <th className="px-3 py-2 text-center no-print w-8">
                        <input
                          type="checkbox"
                          checked={allUnpaidSelected}
                          ref={(el) => { if (el) el.indeterminate = someUnpaidSelected }}
                          onChange={() => {
                            setExcludedBillIds((prev) => {
                              const next = new Set(prev)
                              if (allUnpaidSelected) {
                                unpaidBills.forEach((b: any) => next.add(b.id))
                              } else {
                                unpaidBills.forEach((b: any) => next.delete(b.id))
                              }
                              return next
                            })
                          }}
                        />
                      </th>
                    )}
                    <th className="px-3 py-2 text-left">เลขที่ใบเบิก</th>
                    <th className="px-3 py-2 text-left">วันที่บิล / อนุมัติ</th>
                    <th className="px-3 py-2 text-left">โครงการ / แปลง</th>
                    <th className="px-3 py-2 text-left">ประเภท</th>
                    <th className="px-3 py-2 text-right">ยอดรวม</th>
                    <th className="px-3 py-2 text-right">ยอดโอน</th>
                    <th className="px-3 py-2 text-center no-print">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {group.bills.map((bill: any) => {
                    const plotLabel = bill.plots?.name || '-'
                    const isExtra = bill.type === 'extra_work'
                    const isDC = bill.type === 'extra_work'
                    const workAmt = bill.total_work_amount ?? 0
                    const addAmt = bill.total_add_amount ?? 0
                    const deductAmt = bill.total_deduct_amount ?? 0
                    const retAmt = workAmt * ((bill.retention_percent ?? 0) / 100)
                    const pmGrossAmt = workAmt + addAmt - deductAmt
                    const grossAmt = pmGrossAmt
                    const whtAmt = bill.wht_applied ? pmGrossAmt * ((bill.wht_percent ?? 0) / 100) : 0
                    const actualTransfer = computeActualPayout(bill)
                    return (
                      <Fragment key={bill.id}>
                        <tr className="border-b align-top">
                          {unpaidBills.length > 0 && (
                            <td className="px-3 py-2 text-center no-print">
                              {!bill.paid_out_at && (
                                <input
                                  type="checkbox"
                                  checked={!excludedBillIds.has(bill.id)}
                                  onChange={() => toggleBillExcluded(bill.id)}
                                />
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2 font-semibold">
                            <div>#{String(bill.doc_no || '-').padStart(4, '0')}</div>
                            {bill.paid_out_at ? (
                              <div className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                <BadgeCheck className="h-2.5 w-2.5" /> จ่ายแล้ว
                              </div>
                            ) : (
                              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                <div className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                                  รอจ่าย
                                </div>
                                {isRecentlyApproved(bill.approved_at) && (
                                  <div className="inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-300">
                                    ใหม่
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div>{bill.billing_date ? new Date(bill.billing_date).toLocaleDateString('th-TH') : '-'}</div>
                            <div className="text-xs text-slate-400">
                              อนุมัติ {bill.approved_at ? new Date(bill.approved_at).toLocaleDateString('th-TH') : '-'}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div>{bill.projects?.name || '-'}</div>
                            <div className="text-xs text-slate-500">แปลง {plotLabel}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div>{isExtra ? 'งานเพิ่ม / DC' : 'งวดงานหลัก'}</div>
                            {bill.reason_for_dc && <div className="text-xs text-slate-500">{bill.reason_for_dc}</div>}
                          </td>
                          {/* ยอดรวม = gross before any deductions */}
                          <td className="px-3 py-2 text-right font-semibold">฿{formatCurrency(grossAmt)}</td>
                          {/* ยอดโอน = gross when unpaid; actual transfer when paid */}
                          <td className="px-3 py-2 text-right">
                            {bill.paid_out_at ? (
                              <div className="font-bold text-blue-700">฿{formatCurrency(actualTransfer)}</div>
                            ) : (
                              <div className="text-slate-500 font-semibold">฿{formatCurrency(grossAmt)}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center no-print">
                            <button onClick={() => handleUndoApprove(bill.id)} className="px-2 py-1 rounded-lg border text-xs text-amber-700 hover:bg-amber-50">Undo Approve</button>
                          </td>
                        </tr>
                        <tr className="border-b bg-slate-50/40">
                          <td colSpan={unpaidBills.length > 0 ? 8 : 7} className="px-3 py-2">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <div className="text-xs font-semibold text-slate-600 mb-1">รายการงาน</div>
                                {Array.isArray(bill.billing_jobs) && bill.billing_jobs.length > 0 ? (
                                  <table className="w-full overflow-hidden rounded-lg border border-slate-200 text-xs">
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
                                {(Array.isArray(bill.billing_adjustments) && bill.billing_adjustments.length > 0) || (bill.paid_out_at && (bill.wht_applied || (retAmt > 0 && bill.retention_applied !== false))) ? (
                                  <table className="w-full overflow-hidden rounded-lg border border-slate-200 text-xs">
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
                                      {bill.paid_out_at && bill.wht_applied && whtAmt > 0 && (
                                        <tr className="border-b last:border-b-0 text-amber-700">
                                          <td className="px-2 py-1">หัก</td>
                                          <td className="px-2 py-1">หัก ณ ที่จ่าย {bill.wht_percent}%</td>
                                          <td className="px-2 py-1 text-right">1 รายการ</td>
                                          <td className="px-2 py-1 text-right">฿{formatCurrency(whtAmt)}</td>
                                          <td className="px-2 py-1 text-right">−฿{formatCurrency(whtAmt)}</td>
                                        </tr>
                                      )}
                                      {bill.paid_out_at && retAmt > 0 && bill.retention_applied !== false && (
                                        <tr className="border-b last:border-b-0 text-slate-600">
                                          <td className="px-2 py-1">หัก</td>
                                          <td className="px-2 py-1">หักประกันผลงาน {bill.retention_percent}%</td>
                                          <td className="px-2 py-1 text-right">1 รายการ</td>
                                          <td className="px-2 py-1 text-right">฿{formatCurrency(retAmt)}</td>
                                          <td className="px-2 py-1 text-right">−฿{formatCurrency(retAmt)}</td>
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
          )
        })
      )}
    </div>
  )
}












