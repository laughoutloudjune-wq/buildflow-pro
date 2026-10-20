'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Download, HelpCircle, Loader2, Search } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { todayInBangkok } from '@/lib/utils'
import {
  getBoqControlMaterialDetail,
  getMaterialPlanSources,
  getPlotMaterialDetail,
  type MaterialPlanSource,
} from '@/actions/procurement/boq-control'
import {
  STATUS_LABEL_TH,
  ceilingQty,
  rowStatus,
  totalUsedQty,
  type BoqControlDetailRow,
  type BoqControlOutsideBoqRow,
  type BoqControlRow,
  type BoqControlStatus,
  type BoqControlUnassignedRow,
  type ControlScope,
} from '@/lib/procurement/boqControl'
import { UNKNOWN_CONVERSION_LABEL } from '@/lib/procurement/units'
import { formatCurrency } from '@/lib/currency'

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 })

const CHIP: Partial<Record<BoqControlStatus, { text: string; cls: string }>> = {
  over: { text: 'เกิน BOQ', cls: 'bg-red-50 text-red-700' },
  watch: { text: 'ใกล้เต็ม', cls: 'bg-amber-50 text-amber-800' },
  not_in_boq: { text: 'ไม่มีใน BOQ', cls: 'bg-slate-100 text-slate-600' },
}

// Over first, then near, then the rest - the point of the list is to catch
// what needs a look. Unplanned buys sit with the "rest" (they have their own
// collapsed section when nothing was planned at all).
const SORT_ORDER: Record<BoqControlStatus, number> = { over: 0, watch: 1, not_in_boq: 2, no_budget: 3, ok: 4 }

const EXPLAINER: { term: string; text: string }[] = [
  { term: 'แผน', text: 'ปริมาณวัสดุตาม BOQ ของบ้านแบบนี้ (รวมทุกงานที่ใช้วัสดุตัวนี้)' },
  { term: 'เผื่อเสีย', text: 'ปริมาณที่ยอมให้สูญเสียเพิ่มจากแผน ตามเปอร์เซ็นต์ของแต่ละงาน' },
  { term: 'ใช้ได้', text: 'แผน + เผื่อเสีย คือเพดานที่ใช้เทียบ' },
  { term: 'รอสั่ง', text: 'ที่ขอซื้อไว้แล้วแต่ยังไม่มีใบสั่งซื้อ (ยังไม่นับรวมในยอดที่เทียบ)' },
  { term: 'สั่งแล้ว', text: 'อยู่ในใบสั่งซื้อแล้ว ไม่ว่าของจะมาหรือยัง ใบเดียวหลายแปลงจะแบ่งเท่ากัน (ขึ้นต้นด้วย ≈)' },
  { term: 'รับแล้ว', text: 'ของที่รับเข้าตามใบสั่งซื้อแล้ว' },
  { term: 'ถึงแปลง', text: 'ของที่เบิกจากสโตร์ หรือส่งตรงหน้างานเข้าแปลงนี้แล้ว' },
  { term: 'เกิน', text: 'ใช้ตัวที่มากกว่าระหว่าง สั่งแล้ว กับ ถึงแปลง เทียบกับ ใช้ได้ (ไม่บวกกัน เพราะเป็นของชุดเดียวกัน) เป็นแค่คำเตือน ไม่ได้ห้ามสั่ง' },
]

function docHref(row: BoqControlDetailRow): string | null {
  if (row.docKind === 'po') return `/dashboard/procurement/orders/${row.docId}`
  if (row.docKind === 'pr') return `/dashboard/procurement/requests/${row.docId}`
  return null
}

function MaterialBar({ row, status }: { row: BoqControlRow; status: BoqControlStatus }) {
  const ceiling = ceilingQty(row)
  const reached = row.issuedQty
  const ordered = row.orderedQty
  const scale = Math.max(ceiling, ordered, reached, 1)
  const w = (n: number) => `${Math.min(100, (n / scale) * 100)}%`
  const dark = status === 'over' ? 'bg-red-500' : status === 'watch' ? 'bg-amber-500' : 'bg-indigo-500'
  const light = status === 'over' ? 'bg-red-200' : status === 'watch' ? 'bg-amber-200' : 'bg-indigo-200'
  return (
    <span className="relative block h-2.5 rounded-full bg-slate-100" aria-hidden>
      <span className={`absolute inset-y-0 left-0 rounded-full ${light}`} style={{ width: w(ordered) }} />
      <span className={`absolute inset-y-0 left-0 rounded-full ${dark}`} style={{ width: w(reached) }} />
      {ceiling > 0 && <span className="absolute -inset-y-0.5 w-0.5 bg-slate-700" style={{ left: w(ceiling) }} />}
    </span>
  )
}

function RowDetail({
  row,
  detail,
  sources,
  loading,
  canOpenDetail,
}: {
  row: BoqControlRow
  detail: BoqControlDetailRow[] | undefined
  sources: MaterialPlanSource[] | undefined
  loading: boolean
  canOpenDetail: boolean
}) {
  const ceiling = ceilingQty(row)
  const notWithdrawn = row.receivedQty - row.issuedQty
  const poRows = (detail || []).filter((d) => d.docKind === 'po')
  const stockRows = (detail || []).filter((d) => d.docKind === 'stock_out')
  return (
    <div className="space-y-3 bg-slate-50/70 px-4 py-3 text-xs text-slate-600">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-white p-2.5 ring-1 ring-slate-200">
          <p className="font-medium text-slate-800">ใช้ได้ {fmt(ceiling)} {row.unit}</p>
          <p>แผน {fmt(row.plannedQty)} + เผื่อเสีย {fmt(row.allowanceQty)}</p>
        </div>
        <div className="rounded-lg bg-white p-2.5 ring-1 ring-slate-200">
          <p className="font-medium text-slate-800">สั่งแล้ว {row.isEstimated ? '≈' : ''}{fmt(row.orderedQty)} {row.unit}</p>
          <p>รับแล้ว {fmt(row.receivedQty)}{row.pendingQty > 0 ? ` · รอสั่ง ${fmt(row.pendingQty)}` : ''}</p>
        </div>
        <div className="rounded-lg bg-white p-2.5 ring-1 ring-slate-200">
          <p className="font-medium text-slate-800">ถึงแปลง {fmt(row.issuedQty)} {row.unit}</p>
          {notWithdrawn > 0.0001 && <p>รับของแล้วแต่ยังไม่ได้เบิก {fmt(notWithdrawn)} {row.unit}</p>}
        </div>
      </div>

      {sources === undefined && loading ? (
        <p className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังโหลด...</p>
      ) : sources && sources.length > 0 ? (
        <div>
          <p className="mb-1 font-medium text-slate-700">แผนมาจากงานไหนใน BOQ</p>
          <ul className="space-y-0.5">
            {sources.map((s, i) => (
              <li key={`${s.itemName}-${i}`}>
                {s.itemName}: {fmt(s.perPlot)} × {s.plots} แปลง = {fmt(s.perPlot * s.plots)} {row.unit}
                {s.wastePercent > 0 ? ` · เผื่อเสีย ${fmt(s.wastePercent)}%` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : sources ? (
        <p>ไม่มีงานใน BOQ ที่ใช้วัสดุตัวนี้ในขอบเขตนี้</p>
      ) : null}

      {canOpenDetail && (
        <div>
          <p className="mb-1 font-medium text-slate-700">ใบสั่งซื้อที่เป็นของ &quot;สั่งแล้ว&quot;</p>
          {detail === undefined && loading ? (
            <p className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังโหลด...</p>
          ) : poRows.length === 0 ? (
            <p>ยังไม่มีใบสั่งซื้อ</p>
          ) : (
            <ul className="space-y-0.5">
              {poRows.map((d) => {
                const href = docHref(d)
                const share = d.quantity * d.weight
                return (
                  <li key={`${d.docId}-${d.poItemId ?? ''}-${d.purchaseRequestId ?? ''}`}>
                    {href ? <Link href={href} className="font-mono text-indigo-600 hover:underline">{d.docNo || '-'}</Link> : <span className="font-mono">{d.docNo || '-'}</span>}
                    {d.supplierName ? ` · ${d.supplierName}` : ''}
                    {': '}
                    {!d.convertible ? (
                      <span className="text-amber-700">{fmt(d.rawQuantity)} {d.rawUnit} · {UNKNOWN_CONVERSION_LABEL}</span>
                    ) : d.weight < 1 ? (
                      <>
                        {fmt(d.quantity)} {row.unit} ทั้งใบ สำหรับ {d.totalPlots} แปลง ÷ {d.totalPlots} × {Math.round(d.weight * d.totalPlots)} = ≈{fmt(share)} {row.unit}
                      </>
                    ) : (
                      <>
                        {fmt(d.quantity)} {row.unit}
                        {d.rawUnit && d.rawUnit !== row.unit ? ` (${fmt(d.rawQuantity)} ${d.rawUnit})` : ''}
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {stockRows.length > 0 && (
            <p className="mt-1.5 text-slate-500">
              เบิก/ส่งเข้าแปลง {stockRows.length} ครั้ง (ของชุดเดียวกับที่สั่ง ไม่ใช่ของเพิ่ม)
            </p>
          )}
        </div>
      )}
      {row.unconvertedLines > 0 && (
        <p className="text-amber-700">
          {row.unconvertedLines} รายการในเอกสารใช้หน่วยที่ยังไม่รู้ว่าเท่ากับ {row.unit} เท่าไร จึง{UNKNOWN_CONVERSION_LABEL.replace('เทียบ BOQ ไม่ได้', 'ยังเทียบ BOQ ไม่ได้')}
        </p>
      )}
    </div>
  )
}

/**
 * The materials view of one scope (a plot, a batch or a whole project). One
 * row per material: a bar (ordered light, reached-the-plot dark, a tick at
 * "ใช้ได้") and one plain line of numbers. Never totals per job - jobs show
 * only in the row detail, as the explanation of where the plan comes from.
 * Warnings only: nothing here blocks an order.
 */
export default function QtyControlTab({
  scope,
  rows,
  unassigned = [],
  outsideBoq = [],
  plotId,
  canOpenDetail = true,
  showMoney = true,
}: {
  scope: ControlScope
  rows: BoqControlRow[]
  unassigned?: BoqControlUnassignedRow[]
  outsideBoq?: BoqControlOutsideBoqRow[]
  /** Set on the plot page: row detail is then fetched through the plot-scoped action. */
  plotId?: string
  canOpenDetail?: boolean
  showMoney?: boolean
}) {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [hideNormal, setHideNormal] = useState(false)
  const [showExplainer, setShowExplainer] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [detailByMaterial, setDetailByMaterial] = useState<Record<number, BoqControlDetailRow[]>>({})
  const [sourcesByMaterial, setSourcesByMaterial] = useState<Record<number, MaterialPlanSource[]>>({})
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const [showNotInBoq, setShowNotInBoq] = useState(false)
  const [showUnassigned, setShowUnassigned] = useState(false)
  const [showOutsideBoq, setShowOutsideBoq] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const inBoqRows = useMemo(() => rows.filter((r) => ceilingQty(r) > 0), [rows])
  const notInBoqRows = useMemo(() => rows.filter((r) => ceilingQty(r) <= 0 && (totalUsedQty(r) > 0 || r.pendingQty > 0)), [rows])

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return inBoqRows
      .filter((r) => (q ? r.materialName.toLowerCase().includes(q) : true))
      .filter((r) => !hideNormal || rowStatus(r) !== 'ok')
      .sort((a, b) => {
        const diff = SORT_ORDER[rowStatus(a)] - SORT_ORDER[rowStatus(b)]
        return diff !== 0 ? diff : a.materialName.localeCompare(b.materialName, 'th')
      })
  }, [inBoqRows, search, hideNormal])

  const overCount = inBoqRows.filter((r) => rowStatus(r) === 'over').length
  const nearCount = inBoqRows.filter((r) => rowStatus(r) === 'watch').length

  async function toggleExpand(row: BoqControlRow) {
    const id = row.materialTypeId
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (detailByMaterial[id] && sourcesByMaterial[id]) return
    setLoadingId(id)
    try {
      const [sources, detail] = await Promise.all([
        sourcesByMaterial[id] ? Promise.resolve(sourcesByMaterial[id]) : getMaterialPlanSources(scope, id),
        !canOpenDetail || detailByMaterial[id]
          ? Promise.resolve(detailByMaterial[id] ?? [])
          : plotId
            ? getPlotMaterialDetail(plotId, id)
            : getBoqControlMaterialDetail(scope, id),
      ])
      setSourcesByMaterial((prev) => ({ ...prev, [id]: sources }))
      setDetailByMaterial((prev) => ({ ...prev, [id]: detail }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดรายละเอียดไม่สำเร็จ')
    } finally {
      setLoadingId(null)
    }
  }

  async function handleExport() {
    setIsExporting(true)
    try {
      const XLSX = await import('xlsx')
      const data = visibleRows.concat(notInBoqRows).map((r) => ({
        วัสดุ: r.materialName,
        หน่วย: r.unit,
        แผน: r.plannedQty,
        เผื่อเสีย: r.allowanceQty,
        ใช้ได้: ceilingQty(r),
        สั่งแล้ว: r.orderedQty,
        รับแล้ว: r.receivedQty,
        ถึงแปลง: r.issuedQty,
        รอสั่ง: r.pendingQty,
        สถานะ: STATUS_LABEL_TH[rowStatus(r)],
      }))
      const sheet = XLSX.utils.json_to_sheet(data)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, sheet, 'Materials')
      XLSX.writeFile(workbook, `materials-${todayInBangkok()}.xlsx`)
    } catch {
      toast.error('ส่งออกไฟล์ไม่สำเร็จ')
    } finally {
      setIsExporting(false)
    }
  }

  function renderLine(r: BoqControlRow) {
    const approx = r.isEstimated ? '≈' : ''
    return (
      <p className="text-xs text-slate-600">
        สั่งแล้ว {approx}{fmt(r.orderedQty)} · ถึงแปลง {fmt(r.issuedQty)} · ใช้ได้ {fmt(ceilingQty(r))} {r.unit}
        {r.pendingQty > 0 && <span className="ml-2 text-slate-500">รอสั่ง {fmt(r.pendingQty)}</span>}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {overCount > 0 && <span className="mr-3 font-medium text-red-600">เกิน {overCount} รายการ</span>}
          {nearCount > 0 && <span className="mr-3 font-medium text-amber-700">ใกล้เต็ม {nearCount} รายการ</span>}
          {overCount === 0 && nearCount === 0 && <span>ยังไม่มีรายการเกินหรือใกล้เต็ม</span>}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={hideNormal} onChange={(e) => setHideNormal(e.target.checked)} />
            ซ่อนรายการที่ปกติ
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาวัสดุ"
              className="w-44 rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting || rows.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Excel
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setShowExplainer((v) => !v)}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700"
          aria-expanded={showExplainer}
        >
          <HelpCircle className="h-4 w-4 text-slate-400" /> ตัวเลขเหล่านี้แปลว่าอะไร
          {showExplainer ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}
        </button>
        {showExplainer && (
          <dl className="space-y-1 border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
            {EXPLAINER.map((e) => (
              <div key={e.term} className="flex gap-2">
                <dt className="w-16 shrink-0 font-medium text-slate-800">{e.term}</dt>
                <dd>{e.text}</dd>
              </div>
            ))}
            <p className="pt-1 text-slate-500">
              แถบ: สีอ่อน = สั่งแล้ว · สีเข้ม = ถึงแปลง · เส้นดำ = ใช้ได้ · แดง = เกิน · เหลือง = ใช้เกิน 90%
            </p>
          </dl>
        )}
      </div>

      {visibleRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-10 text-center text-sm text-slate-500">
          {rows.length === 0 ? 'ยังไม่มีข้อมูล BOQ หรือการซื้อในขอบเขตนี้' : 'ไม่มีรายการตามเงื่อนไขที่เลือก'}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {visibleRows.map((row) => {
            const status = rowStatus(row)
            const chip = CHIP[status]
            const isExpanded = expandedId === row.materialTypeId
            return (
              <li key={row.materialTypeId}>
                <button type="button" onClick={() => toggleExpand(row)} className="block w-full space-y-1.5 px-3 py-2.5 text-left hover:bg-slate-50" aria-expanded={isExpanded}>
                  <span className="flex flex-wrap items-center gap-2">
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                    <span className="text-sm font-medium text-slate-800">{row.materialName}</span>
                    {chip && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>{chip.text}</span>}
                    {row.unconvertedLines > 0 && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">{UNKNOWN_CONVERSION_LABEL}</span>
                    )}
                  </span>
                  <MaterialBar row={row} status={status} />
                  {renderLine(row)}
                </button>
                {isExpanded && (
                  <RowDetail
                    row={row}
                    detail={detailByMaterial[row.materialTypeId]}
                    sources={sourcesByMaterial[row.materialTypeId]}
                    loading={loadingId === row.materialTypeId}
                    canOpenDetail={canOpenDetail}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {notInBoqRows.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => setShowNotInBoq((v) => !v)}
            className="flex w-full items-center gap-1.5 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700"
            aria-expanded={showNotInBoq}
          >
            {showNotInBoq ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            ซื้อแต่ไม่มีใน BOQ ({notInBoqRows.length})
          </button>
          {showNotInBoq && (
            <ul className="divide-y divide-slate-100 border-t border-slate-200 bg-white">
              {notInBoqRows.map((r) => (
                <li key={r.materialTypeId} className="px-3 py-2">
                  <p className="text-sm font-medium text-slate-800">{r.materialName}</p>
                  {renderLine(r)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {outsideBoq.length > 0 && showMoney && (
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
                    <p className="truncate text-xs text-slate-500">{po.reason || 'ไม่ได้ระบุเหตุผล'}</p>
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
              ซื้อแล้วแต่ยังไม่ระบุแปลง ({unassigned.length})
            </span>
            {showMoney && <span className="text-slate-500">฿{formatCurrency(unassigned.reduce((s, u) => s + u.orderedValue, 0))}</span>}
          </button>
          {showUnassigned && (
            <div className="border-t border-slate-200 p-2">
              <p className="mb-2 px-1 text-xs text-slate-500">
                ใบสั่งซื้อที่ไม่ได้ผูกกับแปลงหรือกลุ่มแปลงใดเลย (ส่วนใหญ่เป็นข้อมูลเก่า) เทียบกับ BOQ ของแปลงไหนไม่ได้ จึงไม่รวมในรายการด้านบน
              </p>
              <ul className="divide-y divide-slate-100 text-xs">
                {unassigned.map((u) => (
                  <li key={u.materialTypeId} className="flex justify-between gap-3 px-2 py-1.5">
                    <span className="text-slate-700">{u.materialName}</span>
                    <span className="text-slate-600">
                      {fmt(u.orderedQty)} {u.unit} · {u.poCount} ใบสั่งซื้อ
                      {showMoney ? ` · ฿${formatCurrency(u.orderedValue)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
