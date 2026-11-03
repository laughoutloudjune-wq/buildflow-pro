'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, MoreHorizontal, Plus, Printer } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PageContainer } from '@/components/ui/PageContainer'
import { PageHeader } from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import { todayInBangkok } from '@/lib/utils'
import {
  approvePurchaseRequest,
  getEligibleRequestLinesForOrder,
  setPurchaseOrderStatus,
} from '@/actions/procurement-actions'
import type { EligibleRequestLine } from '@/actions/procurement/requests'
import { getBoqOverRequestIds } from '@/actions/procurement/boq-control'
import { buildCombineDraft, saveCombineDraft, type CombineDraft } from '@/lib/procurement/combineDraft'
import { DOC_TYPE_LABEL, docNo } from '@/lib/status-labels'
import {
  DONE_LIMIT,
  WORK_STAGES,
  buildIndex,
  sameRef,
  stageCounts,
  stageRows,
  sortRefs,
  WORK_SORTS,
  type WorkSort,
  type DocRef,
  type WorkData,
  type WorkStage,
} from '@/lib/procurement/workQueue'
import type { GoodsReceipt, PaymentVoucher, PurchaseOrder, PurchaseRequest } from '@/lib/types/procurement'
import GoodsReceiptModal from '@/components/procurement/GoodsReceiptModal'
import PaymentVoucherModal from '@/components/procurement/PaymentVoucherModal'
import PurchaseOrderModal from '@/components/procurement/PurchaseOrderModal'
import PurchaseOrderCreateModal from '@/components/procurement/PurchaseOrderCreateModal'
import type { PurchaseOrderFormOptions } from '@/components/procurement/PurchaseOrderForm'
import { WarnTag, fmtDate, fmtDateTime, qtyText } from '@/components/procurement/work/docUi'
import { GroupLegend, WorkSections } from '@/components/procurement/work/WorkList'
import type { DocCtx } from '@/components/procurement/work/types'
import PrDoc from '@/components/procurement/work/PrDoc'
import PoDoc from '@/components/procurement/work/PoDoc'
import RiDoc from '@/components/procurement/work/RiDoc'
import PpDoc from '@/components/procurement/work/PpDoc'

const EMPTY_TEXT: Record<WorkStage, string> = {
  appr: 'ไม่มีคำขอที่รออนุมัติ',
  order: 'ไม่มีรายการที่รอสั่ง',
  recv: 'ไม่มีของที่รอรับ',
  pay: 'ไม่มีใบรับของที่รอจ่าย',
  done: 'ยังไม่มีเอกสารที่เสร็จ',
}

const STAGE_FROM_PARAM: Record<string, WorkStage> = { appr: 'appr', order: 'order', recv: 'recv', pay: 'pay', done: 'done' }

function parseRef(value: string | null): DocRef | null {
  if (!value) return null
  const [type, id] = value.split(':')
  if ((type === 'PR' || type === 'PO' || type === 'RI' || type === 'PP') && id) return { type, id }
  return null
}

export default function WorkPageClient({
  requests,
  orders,
  receipts,
  vouchers,
  options,
  initialError,
  initialOpen,
  initialStage,
}: {
  requests: PurchaseRequest[]
  orders: PurchaseOrder[]
  receipts: GoodsReceipt[]
  vouchers: PaymentVoucher[]
  options: PurchaseOrderFormOptions
  initialError: string | null
  initialOpen: string | null
  initialStage: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  const [today] = useState(() => todayInBangkok())
  const data: WorkData = useMemo(() => ({ requests, orders, receipts, vouchers }), [requests, orders, receipts, vouchers])
  const ix = useMemo(() => buildIndex(data), [data])

  const [stage, setStage] = useState<WorkStage>(() => (initialStage && STAGE_FROM_PARAM[initialStage]) || 'appr')
  const [view, setView] = useState<'req' | 'sup'>('req')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<WorkSort>('urgent')
  // Print several requests on one sheet: tick PR rows, then "พิมพ์ที่เลือก".
  const [selectMode, setSelectMode] = useState(false)
  const [printChecked, setPrintChecked] = useState<Set<string>>(new Set())
  const togglePrint = useCallback((id: string) => {
    setPrintChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const counts = useMemo(() => stageCounts(data, ix, query, today), [data, ix, query, today])
  const allRows = useMemo(() => stageRows(stage, data, ix, query, today), [stage, data, ix, query, today])
  const sortedRows = useMemo(() => sortRefs(allRows, sort, ix), [allRows, sort, ix])
  const rows = useMemo(() => (stage === 'done' && !query.trim() ? sortedRows.slice(0, DONE_LIMIT) : sortedRows), [stage, sortedRows, query])

  // ----- the document window -----
  const [stack, setStack] = useState<DocRef[]>([])
  const [current, setCurrent] = useState<DocRef | null>(() => parseRef(initialOpen))
  const [navRefs, setNavRefs] = useState<DocRef[]>([])
  const [poCreateKey, setPoCreateKey] = useState<number | null>(null)
  const [receiveFor, setReceiveFor] = useState<string | null>(null)
  const [payFor, setPayFor] = useState<string[] | null>(null)
  const [editPoId, setEditPoId] = useState<string | null>(null)
  const [poReturnTo, setPoReturnTo] = useState<DocRef | null>(null)
  const [autoOrderId, setAutoOrderId] = useState<string | null>(null)

  const refresh = useCallback(() => router.refresh(), [router])

  const openFromList = useCallback(
    (ref: DocRef) => {
      setStack([])
      setCurrent(ref)
      setNavRefs(rows)
    },
    [rows]
  )

  const go = useCallback(
    (ref: DocRef) => {
      setStack((prev) => (current ? [...prev, current] : prev))
      setCurrent(ref)
    },
    [current]
  )

  // A window opened by a link from another page (PO page, receipts list...)
  // closes back to that page; one opened on this page just closes.
  const openedByLink = useRef(parseRef(initialOpen) !== null)
  const closeWindow = useCallback(() => {
    setStack([])
    setCurrent(null)
    if (openedByLink.current) {
      openedByLink.current = false
      if (window.history.length > 1) {
        router.back()
        return
      }
      router.replace('/dashboard/procurement/requests')
    }
  }, [router])

  const index = current ? navRefs.findIndex((r) => sameRef(r, current)) : -1
  const position = current && stack.length === 0 && index >= 0
    ? {
        index,
        total: navRefs.length,
        onPrev: index > 0 ? () => setCurrent(navRefs[index - 1]) : undefined,
        onNext: index < navRefs.length - 1 ? () => setCurrent(navRefs[index + 1]) : undefined,
      }
    : null

  const advance = useCallback((): boolean => {
    if (!current || stack.length > 0) return false
    for (let i = index + 1; i < navRefs.length; i++) {
      const candidate = navRefs[i]
      if (candidate.type === 'PR' && ix.requestById.get(candidate.id)?.status === 'pending_review') {
        setCurrent(candidate)
        return true
      }
    }
    return false
  }, [current, stack.length, index, navRefs, ix])

  const startPo = useCallback(
    (draft: CombineDraft) => {
      try {
        saveCombineDraft(draft)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'เปิดใบสั่งซื้อไม่สำเร็จ')
        return
      }
      setPoReturnTo(current)
      setPoCreateKey(Date.now())
    },
    [current, toast]
  )

  const ctx: DocCtx = {
    data,
    ix,
    today,
    go,
    back: stack.length > 0 ? () => {
      setCurrent(stack[stack.length - 1])
      setStack((prev) => prev.slice(0, -1))
    } : null,
    backLabel: stack.length > 0 ? labelOf(stack[stack.length - 1]) : null,
    close: closeWindow,
    refresh,
    position,
    advance,
    startPo,
    receive: (poId) => setReceiveFor(poId),
    pay: (ids) => setPayFor(ids),
    editPo: (poId) => setEditPoId(poId),
    autoOrderId,
    clearAutoOrder: () => setAutoOrderId(null),
  }

  function labelOf(ref: DocRef): string {
    if (ref.type === 'PR') return docNo('PR', ix.requestById.get(ref.id)?.pr_no)
    if (ref.type === 'PO') return docNo('PO', ix.orderById.get(ref.id)?.po_no)
    if (ref.type === 'RI') return docNo('RI', ix.receiptById.get(ref.id)?.ri_no)
    return docNo('PP', ix.voucherById.get(ref.id)?.pp_no)
  }

  const currentExists =
    current &&
    (current.type === 'PR' ? ix.requestById.has(current.id) : current.type === 'PO' ? ix.orderById.has(current.id) : current.type === 'RI' ? ix.receiptById.has(current.id) : ix.voucherById.has(current.id))

  // ----- quick buttons on a row -----
  function quickApprove(r: PurchaseRequest) {
    startTransition(async () => {
      const result = await approvePurchaseRequest(r.id)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success(`${docNo('PR', r.pr_no)} อนุมัติแล้ว`)
      refresh()
    })
  }
  function quickSend(o: PurchaseOrder) {
    startTransition(async () => {
      const result = await setPurchaseOrderStatus(o.id, 'sent')
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success(`${o.po_no} ส่งร้านแล้ว · คำขอเปลี่ยนเป็น “สั่งแล้ว” เอง`)
      refresh()
    })
  }

  // ----- warnings on rows: over-BOQ requests (a note, never a stop) -----
  const [overIds, setOverIds] = useState<Set<string>>(new Set())
  const prRowIds = useMemo(() => rows.filter((r) => r.type === 'PR' && (stage === 'appr' || stage === 'order')).map((r) => r.id), [rows, stage])
  const prRowKey = prRowIds.join(',')
  useEffect(() => {
    if (!prRowKey) return
    let cancelled = false
    getBoqOverRequestIds(prRowKey.split(','))
      .then((ids) => {
        if (!cancelled) setOverIds(new Set(ids))
      })
      .catch(() => {
        // The list works without the warning.
      })
    return () => {
      cancelled = true
    }
  }, [prRowKey])

  // ----- "ตามร้าน": approved lines grouped by the shop they were last bought from -----
  const [eligible, setEligible] = useState<EligibleRequestLine[] | null>(null)
  const requestSignature = useMemo(() => requests.map((r) => `${r.id}:${r.status}:${(r.purchase_request_items || []).map((i) => i.line_status).join('')}`).join('|'), [requests])
  const supNeeded = stage === 'order' && view === 'sup'
  useEffect(() => {
    if (!supNeeded) return
    let cancelled = false
    getEligibleRequestLinesForOrder(null)
      .then((lines) => {
        if (!cancelled) setEligible(lines)
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'โหลดรายการรอสั่งไม่สำเร็จ')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supNeeded, requestSignature])
  const [unticked, setUnticked] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const map = new Map<string, { id: string; name: string; lines: EligibleRequestLine[] }>()
    for (const l of eligible || []) {
      if (q && !`${l.material_name} ${docNo('PR', l.pr_no)} ${l.plot_label || ''} ${l.last_supplier_name || ''}`.toLowerCase().includes(q)) continue
      const key = l.last_supplier_id || ''
      const g = map.get(key) || { id: key, name: l.last_supplier_name || 'ยังไม่เคยซื้อ · เลือกร้านเองในใบสั่งซื้อ', lines: [] }
      g.lines.push(l)
      map.set(key, g)
    }
    for (const g of map.values()) {
      if (sort === 'newest') g.lines.sort((a, b) => b.requested_at.localeCompare(a.requested_at))
      else if (sort === 'oldest') g.lines.sort((a, b) => a.requested_at.localeCompare(b.requested_at))
      else if (sort === 'needed') g.lines.sort((a, b) => (a.needed_by_date || '9999').localeCompare(b.needed_by_date || '9999'))
    }
    return Array.from(map.values()).sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : b.lines.length - a.lines.length))
  }, [eligible, query, sort])

  function startSupplierPo(group: { id: string; lines: EligibleRequestLine[] }) {
    const picks = group.lines.filter((l) => !unticked.has(l.purchase_request_item_id))
    if (picks.length === 0) return
    const tally = new Map<string, number>()
    for (const l of picks) tally.set(l.project_id, (tally.get(l.project_id) || 0) + 1)
    const projectId = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0][0]
    startPo(buildCombineDraft(picks.map((line) => ({ line, qty: line.unit_mismatch ? 0 : line.remaining })), projectId, group.id))
  }

  // ----- rendering -----
  // A form (new order / receive / pay) takes the place of the document window
  // while it is open; the document comes back when the form closes.
  const formOpen = poCreateKey !== null || receiveFor !== null || payFor !== null
  const receiveOrder = receiveFor ? ix.orderById.get(receiveFor) : null
  const payReceipts = payFor ? payFor.map((id) => ix.receiptById.get(id)).filter((r): r is GoodsReceipt => Boolean(r)) : []
  const payOthers = payReceipts.length
    ? receipts.filter((r) => !payFor!.includes(r.id) && !(r.payment_voucher_receipts || []).length && r.purchase_orders?.supplier_id === payReceipts[0].purchase_orders?.supplier_id)
    : []

  return (
    <PageContainer width="wide">
      <PageHeader
        title="คำขอซื้อ (PR)"
        subtitle="ทุกขั้นอยู่หน้าเดียว: รออนุมัติ › รอสั่ง › รอของ › รอจ่าย › เสร็จ"
        actions={
          <>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นเลขที่ / แปลง / ร้าน / วัสดุ"
              className="w-64 max-w-full"
              aria-label="ค้นหา"
            />
            <Link href="/dashboard/procurement/requests/create">
              <Button type="button">
                <Plus className="h-4 w-4" /> สร้างคำขอซื้อ
              </Button>
            </Link>
            <details className="relative">
              <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-[10px] border border-slate-200 bg-white px-3 text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden" aria-label="เมนูเพิ่มเติม">
                <MoreHorizontal className="h-4 w-4" />
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  onClick={(e) => {
                    ;(e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open')
                    setSelectMode((v) => !v)
                    setPrintChecked(new Set())
                  }}
                >
                  <Printer className="h-4 w-4" /> {selectMode ? 'เลิกเลือกหลายใบ' : 'เลือกหลายใบเพื่อพิมพ์'}
                </button>
              </div>
            </details>
          </>
        }
      />

      <div className="grid grid-cols-5 overflow-hidden rounded-xl border border-slate-200 bg-slate-50" role="group" aria-label="ขั้นตอน">
        {WORK_STAGES.map((s) => {
          const c = counts[s.key]
          const on = stage === s.key
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStage(s.key)}
              className={`flex min-w-0 flex-col gap-0.5 border-r border-slate-200 px-3 py-2.5 text-left last:border-r-0 ${on ? 'bg-white shadow-[inset_0_-3px_0_0_rgb(79,70,229)]' : 'hover:bg-white/60'}`}
              aria-pressed={on}
            >
              <span className={`truncate text-xs ${on ? 'font-medium text-indigo-700' : 'text-slate-500'}`}>{s.label}</span>
              <span className="text-xl font-semibold tabular-nums text-slate-900">
                {c.count}
                {c.late > 0 && <small className="ml-1.5 hidden text-xs font-medium text-red-600 sm:inline">เลยวัน {c.late}</small>}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <label className="mb-0 flex items-center gap-2">
          เรียงตาม
          <select value={sort} onChange={(e) => setSort(e.target.value as WorkSort)} className="w-auto" aria-label="เรียงตาม">
            {WORK_SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {stage === 'order' && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span>ดูเป็น</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200" role="group">
            {(
              [
                ['req', 'ตามคำขอ'],
                ['sup', 'ตามร้าน (รวมหลายคำขอ)'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`px-3 py-1.5 text-sm ${view === key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {selectMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-800">
          <span>
            เลือกแล้ว <b>{printChecked.size}</b> ใบ · ติ๊กที่แถวคำขอ
          </span>
          {printChecked.size > 0 && (
            <a href={`/api/procurement/requests/pdf?ids=${Array.from(printChecked).join(',')}`} target="_blank" rel="noreferrer">
              <Button type="button" size="sm" variant="secondary">
                <Printer className="h-3.5 w-3.5" /> พิมพ์ที่เลือก (รวมหลายใบต่อแผ่น)
              </Button>
            </a>
          )}
        </div>
      )}
      {stage === 'pay' && <p className="text-sm text-slate-500">ติ๊กรวมหลายใบของร้านเดียวกันได้ในหน้าต่างจ่ายเงิน</p>}

      {supNeeded ? (
        eligible === null ? (
          <div className="flex items-center gap-2 py-10 text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด...
          </div>
        ) : groups.length === 0 ? (
          <Empty text={EMPTY_TEXT.order} />
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const ticked = g.lines.filter((l) => !unticked.has(l.purchase_request_item_id))
              return (
                <section key={g.id || 'none'} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-center gap-3 bg-slate-50 px-3 py-2.5">
                    <b className="mr-auto font-semibold text-slate-800">{g.name}</b>
                    <span className="text-xs text-slate-500">{g.id ? 'ซื้อล่าสุดจากร้านนี้ · ' : ''}{g.lines.length} รายการ</span>
                    <Button type="button" size="sm" disabled={ticked.length === 0} onClick={() => startSupplierPo(g)}>
                      ออกใบสั่งซื้อ ({ticked.length})
                    </Button>
                  </div>
                  {g.lines.map((l) => {
                    const checked = !unticked.has(l.purchase_request_item_id)
                    const late = Boolean(l.needed_by_date) && l.needed_by_date! < today
                    return (
                      <label key={l.purchase_request_item_id} className="mb-0 grid cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm sm:grid-cols-[20px_minmax(0,1fr)_auto_auto]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setUnticked((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.delete(l.purchase_request_item_id)
                              else next.add(l.purchase_request_item_id)
                              return next
                            })
                          }
                        />
                        <span className="min-w-0">
                          {l.material_name}
                          <span className="ml-1 text-xs text-slate-500">
                            · {docNo('PR', l.pr_no)} {l.plot_label || l.project_name} · สร้าง {fmtDateTime(l.requested_at)}
                            {l.needed_by_date ? ` · ต้องการ ${fmtDate(l.needed_by_date)}` : ''}
                          </span>
                          {late && <WarnTag>เลยวัน</WarnTag>}
                        </span>
                        <span className="whitespace-nowrap tabular-nums">
                          {qtyText(l.remaining)} {l.request_unit}
                        </span>
                        <span className="hidden whitespace-nowrap text-xs text-slate-500 tabular-nums sm:block">
                          {l.unit_price > 0 ? `฿${formatCurrency(l.unit_price)}/${l.unit}` : ''}
                        </span>
                      </label>
                    )
                  })}
                </section>
              )
            })}
          </div>
        )
      ) : rows.length === 0 ? (
        <Empty text={query.trim() ? 'ไม่พบเอกสารที่ค้นหา' : EMPTY_TEXT[stage]} />
      ) : (
        <div className="space-y-3">
          <GroupLegend />
          <WorkSections
            stage={stage}
            rows={rows}
            ix={ix}
            today={today}
            overIds={overIds}
            print={{ selectMode, checked: printChecked, toggle: togglePrint }}
            onOpen={openFromList}
            onOrder={(ref) => {
              openFromList(ref)
              setAutoOrderId(ref.id)
            }}
            onApprove={quickApprove}
            onSend={quickSend}
            onReceive={(id) => setReceiveFor(id)}
            onPay={(id) => setPayFor([id])}
          />
          {stage === 'done' && !query.trim() && allRows.length > rows.length && (
            <p className="py-2 text-center text-xs text-slate-500">แสดง {rows.length} ใบล่าสุดจาก {allRows.length} · ค้นหาเพื่อดูใบที่เก่ากว่า</p>
          )}
        </div>
      )}

      {current && currentExists && !formOpen && (
        <>
          {current.type === 'PR' && <PrDoc key={`PR:${current.id}`} id={current.id} ctx={ctx} />}
          {current.type === 'PO' && <PoDoc key={`PO:${current.id}`} id={current.id} ctx={ctx} />}
          {current.type === 'RI' && <RiDoc key={`RI:${current.id}`} id={current.id} ctx={ctx} />}
          {current.type === 'PP' && <PpDoc key={`PP:${current.id}`} id={current.id} ctx={ctx} />}
        </>
      )}
      {current && !currentExists && !formOpen && (
        <Modal isOpen onClose={closeWindow} title={DOC_TYPE_LABEL[current.type]}>
          <div className="flex items-center gap-2 py-8 text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดเอกสาร...
          </div>
        </Modal>
      )}

      {poCreateKey !== null && (
        <PurchaseOrderCreateModal
          key={poCreateKey}
          options={options}
          onClose={() => setPoCreateKey(null)}
          onCreated={(id) => {
            setPoCreateKey(null)
            refresh()
            if (poReturnTo) {
              setStack((prev) => [...prev, poReturnTo])
            } else if (current) {
              setStack((prev) => [...prev, current])
            }
            setCurrent({ type: 'PO', id })
          }}
        />
      )}

      {receiveOrder && (
        <GoodsReceiptModal
          isOpen
          order={receiveOrder}
          onClose={() => setReceiveFor(null)}
          onSuccess={(receiptId) => {
            setReceiveFor(null)
            refresh()
            if (receiptId) {
              if (current) setStack((prev) => [...prev, current])
              setCurrent({ type: 'RI', id: receiptId })
            }
          }}
        />
      )}

      {payFor && payReceipts.length > 0 && (
        <PaymentVoucherModal
          receipts={payReceipts}
          others={payOthers}
          onClose={() => setPayFor(null)}
          onCreated={(result) => {
            setPayFor(null)
            refresh()
            if (current) setStack((prev) => [...prev, current])
            setCurrent({ type: 'PP', id: result.id })
          }}
        />
      )}

      <PurchaseOrderModal
        orderId={editPoId}
        onClose={() => {
          setEditPoId(null)
          refresh()
        }}
      />
    </PageContainer>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500">{text}</div>
}
