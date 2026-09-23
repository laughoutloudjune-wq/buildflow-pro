'use client'

import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Download, Loader2, Search } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { todayInBangkok } from '@/lib/utils'
import { getBoqControlMaterialDetail } from '@/actions/procurement/boq-control'
import {
  STATUS_LABEL_TH,
  ceilingQty,
  consumedQty,
  percentUsed,
  rowStatus,
  type BoqControlDetailRow,
  type BoqControlOutsideBoqRow,
  type BoqControlRow,
  type BoqControlStatus,
  type BoqControlUnassignedRow,
  type ControlScope,
} from '@/lib/procurement/boqControl'
import { formatCurrency } from '@/lib/currency'

const STATUS_DOT: Record<BoqControlStatus, string> = {
  ok: 'bg-emerald-500',
  watch: 'bg-amber-500',
  over: 'bg-red-500',
  not_in_boq: 'bg-slate-400',
  no_budget: 'bg-slate-400',
}

const STATUS_ROW_TONE: Record<BoqControlStatus, string> = {
  ok: '',
  watch: 'bg-amber-50/50',
  over: 'bg-red-50/60',
  not_in_boq: '',
  no_budget: '',
}

const FILTER_CHIPS: { key: 'all' | BoqControlStatus; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'over', label: 'เกิน BOQ' },
  { key: 'watch', label: 'ใกล้เต็ม' },
  { key: 'not_in_boq', label: 'ไม่มีใน BOQ' },
]

const DOC_KIND_LABEL: Record<BoqControlDetailRow['docKind'], string> = {
  po: 'ใบสั่งซื้อ',
  pr: 'คำขอซื้อ',
  stock_out: 'เบิกสต็อก',
}

function docHref(row: BoqControlDetailRow): string | null {
  if (row.docKind === 'po') return `/dashboard/procurement/orders/${row.docId}`
  if (row.docKind === 'pr') return `/dashboard/procurement/requests/${row.docId}`
  return null
}

export default function QtyControlTab({
  scope,
  rows,
  unassigned,
  outsideBoq,
}: {
  scope: ControlScope
  rows: BoqControlRow[]
  unassigned: BoqControlUnassignedRow[]
  outsideBoq: BoqControlOutsideBoqRow[]
}) {
  const toast = useToast()
  const [filter, setFilter] = useState<'all' | BoqControlStatus>('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [detailByMaterial, setDetailByMaterial] = useState<Record<number, BoqControlDetailRow[]>>({})
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [showUnassigned, setShowUnassigned] = useState(false)
  const [showOutsideBoq, setShowOutsideBoq] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => (filter === 'all' ? true : rowStatus(r) === filter))
      .filter((r) => (q ? r.materialName.toLowerCase().includes(q) : true))
      .sort((a, b) => {
        // Over-budget first, then by name - the whole point of this table
        // is to catch the rows that need attention.
        const statusOrder: Record<BoqControlStatus, number> = { over: 0, watch: 1, not_in_boq: 2, no_budget: 3, ok: 4 }
        const diff = statusOrder[rowStatus(a)] - statusOrder[rowStatus(b)]
        if (diff !== 0) return diff
        return a.materialName.localeCompare(b.materialName, 'th')
      })
  }, [rows, filter, search])

  const counts = useMemo(() => {
    const c: Record<BoqControlStatus, number> = { ok: 0, watch: 0, over: 0, not_in_boq: 0, no_budget: 0 }
    for (const r of rows) c[rowStatus(r)]++
    return c
  }, [rows])

  async function toggleExpand(row: BoqControlRow) {
    if (expandedId === row.materialTypeId) {
      setExpandedId(null)
      return
    }
    setExpandedId(row.materialTypeId)
    if (!detailByMaterial[row.materialTypeId]) {
      setIsDetailLoading(true)
      try {
        const detail = await getBoqControlMaterialDetail(scope, row.materialTypeId)
        setDetailByMaterial((prev) => ({ ...prev, [row.materialTypeId]: detail }))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'โหลดรายละเอียดไม่สำเร็จ')
      } finally {
        setIsDetailLoading(false)
      }
    }
  }

  async function handleExport() {
    setIsExporting(true)
    try {
      const XLSX = await import('xlsx')
      const data = filteredRows.map((r) => ({
        วัสดุ: r.materialName,
        หน่วย: r.unit,
        BOQ: r.plannedQty,
        เผื่อ: r.allowanceQty,
        รวมงบ: ceilingQty(r),
        สั่งซื้อ: r.orderedQty,
        ใช้จริง: consumedQty(r),
        คงเหลือ: ceilingQty(r) - consumedQty(r),
        เปอร์เซ็นต์: percentUsed(r) == null ? '' : Math.round((percentUsed(r) as number) * 10) / 10,
        สถานะ: STATUS_LABEL_TH[rowStatus(r)],
      }))
      const sheet = XLSX.utils.json_to_sheet(data)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, sheet, 'BOQ Control')
      XLSX.writeFile(workbook, `boq-control-${todayInBangkok()}.xlsx`)
    } catch {
      toast.error('ส่งออกไฟล์ไม่สำเร็จ')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilter(chip.key)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                filter === chip.key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {chip.label}
              {chip.key !== 'all' && counts[chip.key] > 0 && (
                <span className="ml-1 opacity-80">({counts[chip.key]})</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาวัสดุ"
              className="w-48 rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting || filteredRows.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            ส่งออก Excel
          </button>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-10 text-center text-sm text-slate-400">
          {rows.length === 0 ? 'ยังไม่มีข้อมูล BOQ หรือการซื้อในขอบเขตนี้' : 'ไม่พบวัสดุตามเงื่อนไขที่เลือก'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="w-6 px-2 py-2" />
                <th className="px-3 py-2">วัสดุ</th>
                <th className="px-3 py-2">หน่วย</th>
                <th className="px-3 py-2 text-right">BOQ</th>
                <th className="px-3 py-2 text-right">เผื่อ</th>
                <th className="px-3 py-2 text-right">รวมงบ</th>
                <th className="px-3 py-2 text-right" title="สั่งซื้อแล้ว ไม่ว่าจะรับของหรือยัง - ข้อมูลอ้างอิง ไม่นับรวมในเปอร์เซ็นต์/สถานะ">
                  สั่งซื้อ
                </th>
                <th className="px-3 py-2 text-right" title="วัสดุที่เบิกออกจากสต็อกจริงแล้ว รวมของที่ส่งตรงหน้างานโดยไม่เข้าสโตร์ - ตัวนี้คือตัวที่เทียบกับ BOQ">
                  ใช้จริง
                </th>
                <th className="px-3 py-2 text-right">คงเหลือ</th>
                <th className="px-3 py-2 text-right">%</th>
                <th className="px-3 py-2">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredRows.map((row) => {
                const status = rowStatus(row)
                const ceiling = ceilingQty(row)
                const used = consumedQty(row)
                const percent = percentUsed(row)
                const isExpanded = expandedId === row.materialTypeId
                return (
                  <Fragment key={row.materialTypeId}>
                    <tr
                      onClick={() => toggleExpand(row)}
                      className={`cursor-pointer transition-colors hover:bg-slate-50 ${STATUS_ROW_TONE[status]}`}
                    >
                      <td className="px-2 py-2.5 text-slate-400">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-800">
                        {row.materialName}
                        {row.isEstimated && (
                          <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500" title="ตัวเลขนี้เป็นค่าเฉลี่ยจากการซื้อของทั้งกลุ่มแปลง">
                            เฉลี่ยจากกลุ่ม
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-500">{row.unit}</td>
                      <td className="px-3 py-2.5 text-right text-slate-600">{row.plannedQty.toLocaleString('th-TH')}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500">{row.allowanceQty.toLocaleString('th-TH')}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-slate-700">{ceiling.toLocaleString('th-TH')}</td>
                      <td className="px-3 py-2.5 text-right text-slate-600">{row.orderedQty.toLocaleString('th-TH')}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-slate-800">{used.toLocaleString('th-TH')}</td>
                      <td className={`px-3 py-2.5 text-right font-medium ${ceiling - used < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                        {(ceiling - used).toLocaleString('th-TH')}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-600">{percent == null ? '-' : `${Math.round(percent)}%`}</td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
                          {STATUS_LABEL_TH[status]}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={11} className="bg-slate-50/70 px-6 py-3">
                          {isDetailLoading && !detailByMaterial[row.materialTypeId] ? (
                            <div className="flex items-center gap-2 py-2 text-sm text-slate-400">
                              <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด...
                            </div>
                          ) : (detailByMaterial[row.materialTypeId] || []).length === 0 ? (
                            <p className="py-2 text-sm text-slate-400">ไม่มีเอกสารที่เกี่ยวข้องในขอบเขตนี้</p>
                          ) : (
                            <table className="w-full text-left text-xs">
                              <thead className="text-slate-500">
                                <tr>
                                  <th className="px-2 py-1.5 font-medium">ประเภท</th>
                                  <th className="px-2 py-1.5 font-medium">เลขที่</th>
                                  <th className="px-2 py-1.5 font-medium">วันที่</th>
                                  <th className="px-2 py-1.5 font-medium">ผู้จำหน่าย</th>
                                  <th className="px-2 py-1.5 font-medium">แปลง</th>
                                  <th className="px-2 py-1.5 text-right font-medium">จำนวน</th>
                                  <th className="px-2 py-1.5 text-right font-medium">สัดส่วน</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200">
                                {(detailByMaterial[row.materialTypeId] || []).map((d) => {
                                  const href = docHref(d)
                                  return (
                                    <tr key={`${d.docKind}-${d.docId}`}>
                                      <td className="px-2 py-1.5 text-slate-500">{DOC_KIND_LABEL[d.docKind]}</td>
                                      <td className="px-2 py-1.5">
                                        {href ? (
                                          <Link href={href} className="font-mono text-indigo-600 hover:underline">
                                            {d.docNo || '-'}
                                          </Link>
                                        ) : (
                                          <span className="font-mono text-slate-600">{d.docNo || '-'}</span>
                                        )}
                                      </td>
                                      <td className="px-2 py-1.5 text-slate-500">
                                        {d.docDate ? new Date(d.docDate).toLocaleDateString('th-TH') : '-'}
                                      </td>
                                      <td className="px-2 py-1.5 text-slate-500">{d.supplierName || '-'}</td>
                                      <td className="px-2 py-1.5 text-slate-500">{d.plotLabel}</td>
                                      <td className="px-2 py-1.5 text-right text-slate-700">{d.quantity.toLocaleString('th-TH')}</td>
                                      <td className="px-2 py-1.5 text-right text-slate-500">
                                        {d.weight < 1 ? `${Math.round(d.weight * 100)}%` : '100%'}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {outsideBoq.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => setShowOutsideBoq((v) => !v)}
            className="flex w-full items-center justify-between bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700"
          >
            <span className="flex items-center gap-1.5">
              {showOutsideBoq ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              ซื้อนอก BOQ ({outsideBoq.length})
            </span>
            <span className="text-slate-500">฿{formatCurrency(outsideBoq.reduce((s, o) => s + o.total, 0))}</span>
          </button>
          {showOutsideBoq && (
            <div className="divide-y divide-slate-100 border-t border-slate-200">
              {outsideBoq.map((po) => (
                <div key={po.poId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <Link href={`/dashboard/procurement/orders/${po.poId}`} className="font-mono text-indigo-600 hover:underline">
                      {po.poNo}
                    </Link>
                    <p className="truncate text-xs text-slate-400">{po.reason || 'ไม่ได้ระบุเหตุผล'}</p>
                  </div>
                  <span className="shrink-0 font-medium text-slate-700">฿{formatCurrency(po.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {unassigned.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => setShowUnassigned((v) => !v)}
            className="flex w-full items-center justify-between bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700"
          >
            <span className="flex items-center gap-1.5">
              {showUnassigned ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              ยังไม่ระบุแปลง ({unassigned.length})
            </span>
            <span className="text-slate-500">฿{formatCurrency(unassigned.reduce((s, u) => s + u.orderedValue, 0))}</span>
          </button>
          {showUnassigned && (
            <div className="border-t border-slate-200 p-2">
              <p className="mb-2 px-1 text-xs text-slate-400">
                ใบสั่งซื้อที่ไม่ได้ผูกกับแปลง/กลุ่มแปลงใดเลย (ส่วนใหญ่เป็นข้อมูลนำเข้าจากประวัติเก่า) - ไม่สามารถเทียบกับ BOQ ของแปลงใดได้ แต่ยังแสดงมูลค่าไว้ให้เห็น
              </p>
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">วัสดุ</th>
                    <th className="px-2 py-1.5 text-right font-medium">จำนวน</th>
                    <th className="px-2 py-1.5 text-right font-medium">มูลค่า</th>
                    <th className="px-2 py-1.5 text-right font-medium">จำนวน PO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {unassigned.map((u) => (
                    <tr key={u.materialTypeId}>
                      <td className="px-2 py-1.5 text-slate-700">{u.materialName}</td>
                      <td className="px-2 py-1.5 text-right text-slate-600">
                        {u.orderedQty.toLocaleString('th-TH')} {u.unit}
                      </td>
                      <td className="px-2 py-1.5 text-right text-slate-700">฿{formatCurrency(u.orderedValue)}</td>
                      <td className="px-2 py-1.5 text-right text-slate-500">{u.poCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
