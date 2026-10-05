'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, Printer } from 'lucide-react'
import { getBillingsForPrint, getBillingOptions } from '@/actions/billing-actions'
import { formatCurrency } from '@/lib/currency'
import { BILLING_STATUS_LABEL } from '@/lib/status-labels'

type PrintData = Awaited<ReturnType<typeof getBillingsForPrint>>
type PrintBill = PrintData['bills'][number]

// Same wording logic as the type chip on the billing list.
function getJobTypeLabel(bill: PrintBill) {
  const hasMain = bill.jobs.length > 0
  const hasAdd = bill.adjustments.some((a) => a.type === 'addition')
  const hasDeduct = bill.adjustments.some((a) => a.type === 'deduction')
  const tags: string[] = []
  if (hasMain) tags.push('งานหลัก')
  if (hasAdd) tags.push('งานเพิ่ม')
  if (hasDeduct) tags.push('งานหัก')
  if (tags.length === 0 && bill.type === 'extra_work') return 'DC'
  return tags.join(' / ') || '-'
}

const pct = (v: number | null | undefined) => (v == null ? '-' : `${Number(v).toFixed(2)}%`)
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('th-TH') : '-')

function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })
}

function BillingPrintContent() {
  const searchParams = useSearchParams()
  const [data, setData] = useState<PrintData | null>(null)
  const [names, setNames] = useState<{ projects: Map<string, string>; contractors: Map<string, string> }>({
    projects: new Map(),
    contractors: new Map(),
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [printedAt, setPrintedAt] = useState('')

  const filters = useMemo(
    () => ({
      ids: (searchParams.get('ids') || '').split(',').filter(Boolean),
      month: searchParams.get('month') || undefined,
      projectId: searchParams.get('projectId') || undefined,
      contractorId: searchParams.get('contractorId') || undefined,
      status: searchParams.get('status') || undefined,
    }),
    [searchParams]
  )

  // The shell around every dashboard page is a fixed-height scroller with a
  // sidebar and header; flag the body so the print CSS below can flatten it.
  useEffect(() => {
    document.body.classList.add('billing-print-open')
    return () => document.body.classList.remove('billing-print-open')
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setError(null)
      try {
        const [result, options] = await Promise.all([getBillingsForPrint(filters), getBillingOptions()])
        if (cancelled) return
        setData(result)
        setNames({
          projects: new Map((options.projects || []).map((p: { id: string; name: string }) => [p.id, p.name])),
          contractors: new Map((options.contractors || []).map((c: { id: string; name: string }) => [c.id, c.name])),
        })
        setPrintedAt(new Date().toLocaleString('th-TH'))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'โหลดข้อมูลสำหรับพิมพ์ไม่สำเร็จ')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [filters])

  const collator = useMemo(() => new Intl.Collator('th', { numeric: true, sensitivity: 'base' }), [])

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; bills: PrintBill[] }>()
    for (const bill of data?.bills || []) {
      const key = bill.contractor_id || 'unknown'
      if (!map.has(key)) map.set(key, { name: bill.contractor_name || '-', bills: [] })
      map.get(key)!.bills.push(bill)
    }
    return Array.from(map.values())
      .map((g) => ({
        ...g,
        bills: g.bills.slice().sort((a, b) => {
          const p = collator.compare(a.project_name || '', b.project_name || '')
          if (p !== 0) return p
          const pl = collator.compare(a.plot_name || '', b.plot_name || '')
          if (pl !== 0) return pl
          return new Date(a.billing_date || a.created_at || 0).getTime() - new Date(b.billing_date || b.created_at || 0).getTime()
        }),
      }))
      .sort((a, b) => collator.compare(a.name, b.name))
  }, [data, collator])

  const bills = data?.bills || []
  const totalNet = bills.reduce((sum, b) => sum + Number(b.net_amount || 0), 0)

  const filterSummary = filters.ids.length > 0 ? `เลือกพิมพ์เฉพาะ ${filters.ids.length} รายการ` : [
    `เดือน: ${filters.month ? monthLabel(filters.month) : 'ทั้งหมด'}`,
    `โครงการ: ${filters.projectId ? names.projects.get(filters.projectId) || '-' : 'ทั้งหมด'}`,
    `ผู้รับเหมา: ${filters.contractorId ? names.contractors.get(filters.contractorId) || '-' : 'ทั้งหมด'}`,
    `สถานะ: ${filters.status ? BILLING_STATUS_LABEL[filters.status as keyof typeof BILLING_STATUS_LABEL] || filters.status : 'ทั้งหมด'}`,
  ].join('  |  ')

  return (
    <div className="billing-print-root min-h-screen bg-slate-100 p-4 print:bg-white print:p-0">
      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          body.billing-print-open aside,
          body.billing-print-open header,
          body.billing-print-open .no-print { display: none !important; }
          body.billing-print-open,
          body.billing-print-open div.h-screen,
          body.billing-print-open div.overflow-y-auto,
          body.billing-print-open div.overflow-hidden {
            height: auto !important;
            overflow: visible !important;
            display: block !important;
            margin-left: 0 !important;
            background: #fff !important;
          }
          body.billing-print-open main { padding: 0 !important; }
          .avoid-break { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="mx-auto max-w-[210mm] space-y-4">
        <div className="no-print flex items-center justify-between rounded-lg border bg-white p-3">
          <div>
            <div className="font-semibold">ตัวอย่างพิมพ์รายการเบิกจ่ายงวดงาน</div>
            <div className="text-sm text-slate-500">{loading ? 'กำลังโหลด...' : `${bills.length} รายการ`}</div>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={loading || !!error || bills.length === 0}
            className="inline-flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
          >
            <Printer className="h-4 w-4" /> พิมพ์
          </button>
        </div>

        {loading ? (
          <div className="no-print rounded-lg border bg-white p-10 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="no-print rounded-lg border bg-white p-4 text-red-600">{error}</div>
        ) : bills.length === 0 ? (
          <div className="no-print rounded-lg border bg-white p-8 text-center text-slate-400">ไม่พบรายการที่ตรงกับตัวกรอง</div>
        ) : (
          <div className="rounded-lg border bg-white p-6 text-[12px] leading-5 text-slate-900 print:rounded-none print:border-0 print:p-0">
            <div className="mb-4 border-b-2 border-slate-800 pb-3">
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-xl font-bold">รายการเบิกจ่ายงวดงาน</h1>
                <div className="text-right text-[11px] text-slate-600">
                  <div>พิมพ์เมื่อ: {printedAt}</div>
                  {data?.printedBy ? <div>พิมพ์โดย: {data.printedBy}</div> : null}
                </div>
              </div>
              <div className="mt-1 text-[11px] text-slate-600">{filterSummary}</div>
              <div className="mt-2 flex items-baseline justify-between">
                <div>จำนวนใบเบิกทั้งหมด: <span className="font-semibold">{bills.length}</span> รายการ</div>
                <div className="text-base font-bold">ยอดสุทธิรวม: ฿{formatCurrency(totalNet)}</div>
              </div>
            </div>

            {groups.map((group, gi) => (
              <section key={`${group.name}-${gi}`} className="mb-4">
                <h2 className="mb-2 border-b border-slate-400 pb-1 text-sm font-bold">
                  ผู้รับเหมา: {group.name} <span className="font-normal text-slate-500">({group.bills.length} รายการ)</span>
                </h2>
                <div className="space-y-3">
                  {group.bills.map((bill) => (
                    <BillBlock key={bill.id} bill={bill} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BillBlock({ bill }: { bill: PrintBill }) {
  const approvedLike = bill.status !== 'pending_review'
  const statusLabel = BILLING_STATUS_LABEL[bill.status as keyof typeof BILLING_STATUS_LABEL] || bill.status || '-'
  return (
    <div className="avoid-break rounded border border-slate-400 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 pb-1.5">
        <div className="font-bold">#{String(bill.doc_no ?? '-').padStart(4, '0')}</div>
        <div>วันที่: {fmtDate(bill.billing_date)}</div>
        <div>ประเภท: <span className="font-semibold">{getJobTypeLabel(bill)}</span></div>
        <div>สถานะ: <span className="font-semibold">{statusLabel}</span></div>
      </div>

      <div className="mt-1.5 grid grid-cols-3 gap-2">
        <div>ผู้รับเหมา: <span className="font-semibold">{bill.contractor_name || '-'}</span></div>
        <div>โครงการ: <span className="font-semibold">{bill.project_name || '-'}</span></div>
        <div>
          แปลง: <span className="font-semibold">{bill.plot_name || '-'}</span>
          {bill.house_model_name ? <span className="text-slate-600"> ({bill.house_model_name})</span> : null}
        </div>
      </div>

      {bill.jobs.length > 0 && (
        <table className="mt-2 w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-300 px-2 py-0.5 text-left">ชื่องาน</th>
              <th className="w-20 border border-slate-300 px-2 py-0.5 text-right">มูลค่างาน</th>
              <th className="w-20 border border-slate-300 px-2 py-0.5 text-right">เบิกแล้วก่อนหน้า</th>
              <th className="w-14 border border-slate-300 px-2 py-0.5 text-right">%ก่อน</th>
              <th className="w-14 border border-slate-300 px-2 py-0.5 text-right">
                {approvedLike ? '% อนุมัติ' : '% ที่แจ้ง'}
              </th>
              <th className="w-20 border border-slate-300 px-2 py-0.5 text-right">ยอดเบิกครั้งนี้</th>
              <th className="w-20 border border-slate-300 px-2 py-0.5 text-right">คงเหลือหลังเบิก</th>
            </tr>
          </thead>
          <tbody>
            {bill.jobs.map((job) => (
              <tr key={job.id}>
                <td className="border border-slate-300 px-2 py-0.5">
                  {job.name}
                  {job.plot_name && job.plot_name !== bill.plot_name ? <span className="text-slate-500"> • แปลง {job.plot_name}</span> : null}
                </td>
                <td className="border border-slate-300 px-2 py-0.5 text-right">{formatCurrency(job.total_value)}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right">{formatCurrency(job.paid_before)}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right">{pct(job.previous_percent)}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right font-semibold">{pct(job.percent)}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right font-semibold">{formatCurrency(job.amount)}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right">{formatCurrency(job.remaining_after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {bill.adjustments.length > 0 && (
        <table className="mt-2 w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-100">
              <th className="w-12 border border-slate-300 px-2 py-0.5 text-left">ประเภท</th>
              <th className="border border-slate-300 px-2 py-0.5 text-left">รายการงานเพิ่ม/หัก</th>
              <th className="w-24 border border-slate-300 px-2 py-0.5 text-right">จำนวน</th>
              <th className="w-20 border border-slate-300 px-2 py-0.5 text-right">ราคา/หน่วย</th>
              <th className="w-24 border border-slate-300 px-2 py-0.5 text-right">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {bill.adjustments.map((adj, idx) => (
              <tr key={adj.id ?? `${adj.description}-${idx}`}>
                <td className="border border-slate-300 px-2 py-0.5">
                  <span className="inline-block rounded border border-slate-400 px-1 text-[10px] font-semibold">
                    {adj.type === 'deduction' ? 'หัก' : 'เพิ่ม'}
                  </span>
                </td>
                <td className="border border-slate-300 px-2 py-0.5">{adj.description}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right">
                  {adj.quantity} {adj.unit || ''}
                </td>
                <td className="border border-slate-300 px-2 py-0.5 text-right">{formatCurrency(adj.unit_price)}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right font-semibold">
                  {adj.type === 'deduction' ? '−' : ''}
                  {formatCurrency(adj.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-300 pt-1.5">
        <div className="text-[11px] text-slate-600">
          {bill.note ? <div>หมายเหตุผู้ขอ: {bill.note}</div> : null}
          {bill.type === 'extra_work' || bill.reason_for_dc ? <div>เหตุผล DC: {bill.reason_for_dc || '-'}</div> : null}
        </div>
        <div className="shrink-0 text-sm font-bold">ยอดสุทธิ: ฿{formatCurrency(bill.net_amount)}</div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 text-[11px]">
        <div>
          <div className="h-8 border-b border-slate-500" />
          <div className="mt-0.5 text-center">ผู้ขอเบิก (โฟร์แมน)</div>
        </div>
        <div>
          <div className="h-8 border-b border-slate-500" />
          <div className="mt-0.5 text-center">PM &nbsp;☐ อนุมัติ &nbsp;☐ ไม่อนุมัติ</div>
        </div>
        <div>
          <div className="h-8 border-b border-slate-500" />
          <div className="mt-0.5 text-center">วันที่</div>
        </div>
      </div>
      <div className="mt-2 flex items-end gap-2 text-[11px]">
        <span>หมายเหตุ:</span>
        <span className="h-4 flex-1 border-b border-slate-400" />
      </div>
    </div>
  )
}

export default function BillingPrintPage() {
  return (
    <Suspense fallback={null}>
      <BillingPrintContent />
    </Suspense>
  )
}
