/**
 * The งานจัดซื้อ page's brain: which stage a document is in, how documents
 * point at each other (PR › PO › receipt › payment), and the one-word status
 * each shows. Pure functions over the lists the page already loaded - no new
 * tables, no I/O. Everything here reads the same fields the older list pages
 * read, so the numbers agree with them.
 */
import type { GoodsReceipt, PaymentVoucher, PurchaseOrder, PurchaseRequest, PurchaseRequestItem } from '@/lib/types/procurement'
import { docNo, type DocTone, type DocType, type LineStatusWord } from '@/lib/status-labels'

export type WorkStage = 'appr' | 'order' | 'recv' | 'pay' | 'done'

export const WORK_STAGES: { key: WorkStage; label: string }[] = [
  { key: 'appr', label: 'รออนุมัติ' },
  { key: 'order', label: 'รอสั่ง' },
  { key: 'recv', label: 'รอของ' },
  { key: 'pay', label: 'รอจ่าย' },
  { key: 'done', label: 'เสร็จ' },
]

export type DocRef = { type: DocType; id: string }

export type WorkData = {
  requests: PurchaseRequest[]
  orders: PurchaseOrder[]
  receipts: GoodsReceipt[]
  vouchers: PaymentVoucher[]
}

export const sameRef = (a: DocRef | null | undefined, b: DocRef | null | undefined) =>
  Boolean(a && b && a.type === b.type && a.id === b.id)

// ---------------------------------------------------------------------------
// Small facts about one document
// ---------------------------------------------------------------------------

export function requestPlotText(r: PurchaseRequest): string {
  if (r.plots?.name) return `แปลง ${r.plots.name}`
  if (r.plot_groups?.name) return `กลุ่ม ${r.plot_groups.name}`
  const names = (r.purchase_request_plots || []).map((p) => p.plots?.name).filter(Boolean)
  if (names.length > 0) return `แปลง ${names.join(', ')}`
  return r.projects?.name || 'ไม่ระบุแปลง'
}

export function requesterName(r: PurchaseRequest): string {
  return r.requester?.full_name || r.requester?.email || '-'
}

export const isReceiptPaid = (r: GoodsReceipt) => (r.payment_voucher_receipts || []).length > 0

export function receiptAmount(r: GoodsReceipt): number {
  return (r.goods_receipt_items || []).reduce((sum, i) => sum + i.quantity_received * i.unit_price_at_receipt, 0)
}

/** 'ordered' but every line was closed by hand (bought without an order, or
 * dropped): nothing is on its way, so it counts as finished, not as waiting
 * for goods that will never come. */
export function isClosedOut(r: PurchaseRequest): boolean {
  const items = r.purchase_request_items || []
  return r.status === 'ordered' && items.length > 0 && items.every((i) => i.line_status === 'closed')
}

export function requestIsLate(r: PurchaseRequest, today: string): boolean {
  return Boolean(r.needed_by_date) && r.needed_by_date! < today && (r.status === 'pending_review' || r.status === 'approved')
}

export function orderIsLate(po: PurchaseOrder, today: string): boolean {
  return (
    (po.status === 'sent' || po.status === 'partially_received') &&
    Boolean(po.expected_delivery_date) &&
    po.expected_delivery_date! < today
  )
}

/** The one word for a request line, from the database's own line state plus
 * how much of it has actually arrived. */
export function requestLineWord(request: PurchaseRequest, item: PurchaseRequestItem): { word: LineStatusWord | null; tone: 'go' | 'wait' | 'ok' } {
  if (request.status === 'pending_review') return { word: null, tone: 'wait' }
  // Older requests were received before orders were linked to lines, so their lines still say "open".
  if (request.status === 'received' && item.line_status === 'open') return { word: 'ซื้อแล้ว', tone: 'ok' }
  if (item.line_status === 'closed') return { word: 'ไม่ซื้อ', tone: 'wait' }
  if (item.line_status === 'arrived') return { word: 'ของมาแล้ว', tone: 'ok' }
  if (item.line_status === 'ordered') {
    const f = item.fulfillment
    if (f && f.received > 0 && f.received < f.allocated) return { word: 'มาบางส่วน', tone: 'wait' }
    return { word: 'สั่งแล้ว', tone: 'wait' }
  }
  return { word: 'รอสั่ง', tone: 'go' }
}

export function openLines(request: PurchaseRequest): PurchaseRequestItem[] {
  return (request.purchase_request_items || []).filter((i) => i.line_status === 'open')
}

/** One-word status of a request (with the "n of m" hint while some lines
 * still wait for an order). */
export function requestStatusWord(r: PurchaseRequest): { label: string; tone: DocTone } {
  switch (r.status) {
    case 'pending_review':
      return { label: 'รออนุมัติ', tone: 'late' }
    case 'rejected':
      return { label: 'ไม่อนุมัติ', tone: 'bad' }
    case 'cancelled':
      return { label: 'ยกเลิก', tone: 'bad' }
    case 'received':
      return { label: 'ของครบ', tone: 'ok' }
    case 'ordered':
      return isClosedOut(r) ? { label: 'ปิดรายการแล้ว', tone: 'wait' } : { label: 'รอของ', tone: 'wait' }
    default: {
      const items = r.purchase_request_items || []
      const live = items.filter((i) => i.line_status !== 'closed').length
      const open = openLines(r).length
      return { label: open > 0 && open < live ? `รอสั่ง ${open} จาก ${live}` : 'รอสั่ง', tone: 'go' }
    }
  }
}

export function orderStatusWord(po: PurchaseOrder): { label: string; tone: DocTone } {
  switch (po.status) {
    case 'draft':
      return { label: 'ร่าง', tone: 'wait' }
    case 'sent':
      return { label: 'รอของ', tone: 'go' }
    case 'partially_received':
      return { label: 'รับบางส่วน', tone: 'late' }
    case 'received':
      return { label: 'รอจ่าย', tone: 'go' }
    case 'paid':
      return { label: 'จ่ายแล้ว', tone: 'ok' }
    default:
      return { label: 'ยกเลิก', tone: 'bad' }
  }
}

export function receiptStatusWord(r: GoodsReceipt): { label: string; tone: DocTone } {
  return isReceiptPaid(r) ? { label: 'จ่ายแล้ว', tone: 'ok' } : { label: 'รอจ่าย', tone: 'go' }
}

// ---------------------------------------------------------------------------
// How documents point at each other
// ---------------------------------------------------------------------------

export type WorkIndex = {
  requestById: Map<string, PurchaseRequest>
  orderById: Map<string, PurchaseOrder>
  receiptById: Map<string, GoodsReceipt>
  voucherById: Map<string, PaymentVoucher>
  /** request id -> order ids that cover any of its lines (cancelled orders left out). */
  posOfRequest: Map<string, Set<string>>
  requestsOfPo: Map<string, Set<string>>
  receiptsOfPo: Map<string, GoodsReceipt[]>
  vouchersOfReceipt: Map<string, Set<string>>
}

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  const set = map.get(key) || new Set<V>()
  set.add(value)
  map.set(key, set)
}

export function buildIndex(data: WorkData): WorkIndex {
  const requestById = new Map(data.requests.map((r) => [r.id, r]))
  const orderById = new Map(data.orders.map((o) => [o.id, o]))
  const receiptById = new Map(data.receipts.map((r) => [r.id, r]))
  const voucherById = new Map(data.vouchers.map((v) => [v.id, v]))

  const posOfRequest = new Map<string, Set<string>>()
  const requestsOfPo = new Map<string, Set<string>>()
  for (const r of data.requests) {
    for (const item of r.purchase_request_items || []) {
      for (const l of item.fulfillment?.links || []) {
        if (l.cancelled) continue
        addTo(posOfRequest, r.id, l.poId)
        addTo(requestsOfPo, l.poId, r.id)
      }
      for (const link of item.purchase_request_po_links || []) {
        const po = link.purchase_order_items?.purchase_orders
        if (!po?.id || po.status === 'cancelled') continue
        addTo(posOfRequest, r.id, po.id)
        addTo(requestsOfPo, po.id, r.id)
      }
    }
  }
  // An order made straight from a request also carries the id on its header.
  for (const o of data.orders) {
    if (o.purchase_request_id && o.status !== 'cancelled') {
      addTo(posOfRequest, o.purchase_request_id, o.id)
      addTo(requestsOfPo, o.id, o.purchase_request_id)
    }
  }

  const receiptsOfPo = new Map<string, GoodsReceipt[]>()
  const vouchersOfReceipt = new Map<string, Set<string>>()
  for (const rc of data.receipts) {
    receiptsOfPo.set(rc.purchase_order_id, [...(receiptsOfPo.get(rc.purchase_order_id) || []), rc])
    for (const pv of rc.payment_voucher_receipts || []) addTo(vouchersOfReceipt, rc.id, pv.payment_voucher_id)
  }
  return { requestById, orderById, receiptById, voucherById, posOfRequest, requestsOfPo, receiptsOfPo, vouchersOfReceipt }
}

export type Chain = { PR: DocRef[]; PO: DocRef[]; RI: DocRef[]; PP: DocRef[] }

/** Every document related to this one, grouped by kind: the strip along the top of
 * each window (PR › PO › receipt › payment). */
export function buildChain(ref: DocRef, ix: WorkIndex): Chain {
  const prs = new Set<string>()
  const pos = new Set<string>()
  const ris = new Set<string>()
  const pps = new Set<string>()

  if (ref.type === 'PR') prs.add(ref.id)
  if (ref.type === 'PO') pos.add(ref.id)
  if (ref.type === 'RI') ris.add(ref.id)
  if (ref.type === 'PP') pps.add(ref.id)

  if (ref.type === 'PP') {
    const pv = ix.voucherById.get(ref.id)
    for (const x of pv?.payment_voucher_receipts || []) ris.add(x.goods_receipt_id)
  }
  if (ref.type === 'PP' || ref.type === 'RI') {
    for (const id of ris) {
      const rc = ix.receiptById.get(id)
      if (rc) pos.add(rc.purchase_order_id)
    }
  }
  if (ref.type === 'PR') for (const id of ix.posOfRequest.get(ref.id) || []) pos.add(id)
  if (ref.type !== 'PR') for (const id of pos) for (const pr of ix.requestsOfPo.get(id) || []) prs.add(pr)
  if (ref.type === 'PR' || ref.type === 'PO') {
    for (const id of pos) for (const rc of ix.receiptsOfPo.get(id) || []) ris.add(rc.id)
  }
  if (ref.type !== 'PP') for (const id of ris) for (const pv of ix.vouchersOfReceipt.get(id) || []) pps.add(pv)

  const mk = (type: DocType, ids: Set<string>): DocRef[] => Array.from(ids).map((id) => ({ type, id }))
  return { PR: mk('PR', prs), PO: mk('PO', pos), RI: mk('RI', ris), PP: mk('PP', pps) }
}

export function refNo(ref: DocRef, ix: WorkIndex): string {
  if (ref.type === 'PR') return docNo('PR', ix.requestById.get(ref.id)?.pr_no)
  if (ref.type === 'PO') return docNo('PO', ix.orderById.get(ref.id)?.po_no)
  if (ref.type === 'RI') return docNo('RI', ix.receiptById.get(ref.id)?.ri_no)
  return docNo('PP', ix.voucherById.get(ref.id)?.pp_no)
}

// ---------------------------------------------------------------------------
// Stage lists
// ---------------------------------------------------------------------------

function searchTextOf(ref: DocRef, ix: WorkIndex): string {
  if (ref.type === 'PR') {
    const r = ix.requestById.get(ref.id)
    if (!r) return ''
    const mats = (r.purchase_request_items || []).map((i) => i.material_types?.name || '').join(' ')
    const pos = Array.from(ix.posOfRequest.get(r.id) || []).map((id) => ix.orderById.get(id)?.po_no || '').join(' ')
    return `${docNo('PR', r.pr_no)} ${r.pr_no} ${requestPlotText(r)} ${requesterName(r)} ${mats} ${pos}`
  }
  if (ref.type === 'PO') {
    const o = ix.orderById.get(ref.id)
    if (!o) return ''
    const mats = (o.purchase_order_items || []).map((i) => i.material_types?.name || '').join(' ')
    const prs = Array.from(ix.requestsOfPo.get(o.id) || []).map((id) => docNo('PR', ix.requestById.get(id)?.pr_no)).join(' ')
    return `${o.po_no} ${o.suppliers?.name || ''} ${mats} ${prs}`
  }
  if (ref.type === 'RI') {
    const rc = ix.receiptById.get(ref.id)
    if (!rc) return ''
    const mats = (rc.goods_receipt_items || []).map((i) => i.purchase_order_items?.material_types?.name || '').join(' ')
    return `${rc.ri_no} ${rc.purchase_orders?.po_no || ''} ${rc.purchase_orders?.suppliers?.name || ''} ${rc.delivery_note_no || ''} ${mats}`
  }
  const pv = ix.voucherById.get(ref.id)
  if (!pv) return ''
  const ris = (pv.payment_voucher_receipts || []).map((x) => x.goods_receipts?.ri_no || '').join(' ')
  return `${pv.pp_no} ${pv.suppliers?.name || ''} ${ris}`
}

/** The เสร็จ list can be long; show the newest and let search reach the rest. */
export const DONE_LIMIT = 60

/** The documents waiting in one stage, most urgent first. */
export function stageRows(stage: WorkStage, data: WorkData, ix: WorkIndex, query: string, today: string): DocRef[] {
  const q = query.trim().toLowerCase()
  const keep = (ref: DocRef) => !q || searchTextOf(ref, ix).toLowerCase().includes(q)
  const out: DocRef[] = []

  if (stage === 'appr') {
    const rows = data.requests.filter((r) => r.status === 'pending_review')
    rows.sort((a, b) => (requestIsLate(b, today) ? 1 : 0) - (requestIsLate(a, today) ? 1 : 0) || a.pr_no - b.pr_no)
    for (const r of rows) out.push({ type: 'PR', id: r.id })
  } else if (stage === 'order') {
    for (const o of data.orders) if (o.status === 'draft') out.push({ type: 'PO', id: o.id })
    const rows = data.requests.filter((r) => r.status === 'approved')
    rows.sort((a, b) => (requestIsLate(b, today) ? 1 : 0) - (requestIsLate(a, today) ? 1 : 0) || a.pr_no - b.pr_no)
    for (const r of rows) out.push({ type: 'PR', id: r.id })
  } else if (stage === 'recv') {
    const rows = data.orders.filter((o) => o.status === 'sent' || o.status === 'partially_received')
    rows.sort((a, b) => (orderIsLate(b, today) ? 1 : 0) - (orderIsLate(a, today) ? 1 : 0) || (a.expected_delivery_date || '9999').localeCompare(b.expected_delivery_date || '9999'))
    for (const o of rows) out.push({ type: 'PO', id: o.id })
  } else if (stage === 'pay') {
    for (const rc of data.receipts) if (!isReceiptPaid(rc)) out.push({ type: 'RI', id: rc.id })
  } else {
    const dated: { ref: DocRef; at: string }[] = []
    for (const pv of data.vouchers) dated.push({ ref: { type: 'PP', id: pv.id }, at: pv.payment_date || pv.created_at })
    for (const r of data.requests) {
      if (r.status === 'received' || r.status === 'rejected' || r.status === 'cancelled' || isClosedOut(r)) dated.push({ ref: { type: 'PR', id: r.id }, at: r.reviewed_at || r.created_at })
    }
    dated.sort((a, b) => b.at.localeCompare(a.at))
    for (const d of dated) out.push(d.ref)
  }

  return out.filter(keep)
}

export function stageCounts(data: WorkData, ix: WorkIndex, query: string, today: string): Record<WorkStage, { count: number; late: number }> {
  const result = {} as Record<WorkStage, { count: number; late: number }>
  for (const { key } of WORK_STAGES) {
    const rows = stageRows(key, data, ix, query, today)
    let late = 0
    if (key === 'appr' || key === 'order') late = rows.filter((r) => r.type === 'PR' && requestIsLate(ix.requestById.get(r.id)!, today)).length
    if (key === 'recv') late = rows.filter((r) => orderIsLate(ix.orderById.get(r.id)!, today)).length
    result[key] = { count: rows.length, late }
  }
  return result
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type WorkSort = 'urgent' | 'newest' | 'oldest' | 'needed'

export const WORK_SORTS: { key: WorkSort; label: string }[] = [
  { key: 'urgent', label: 'เร่งด่วนก่อน' },
  { key: 'newest', label: 'ใหม่สุด' },
  { key: 'oldest', label: 'เก่าสุด' },
  { key: 'needed', label: 'วันที่ต้องการ' },
]

function createdAt(ref: DocRef, ix: WorkIndex): string {
  if (ref.type === 'PR') return ix.requestById.get(ref.id)?.created_at || ''
  if (ref.type === 'PO') return ix.orderById.get(ref.id)?.created_at || ''
  if (ref.type === 'RI') return ix.receiptById.get(ref.id)?.received_at || ''
  const v = ix.voucherById.get(ref.id)
  return v?.created_at || v?.payment_date || ''
}

function neededOn(ref: DocRef, ix: WorkIndex): string {
  if (ref.type === 'PR') return ix.requestById.get(ref.id)?.needed_by_date || ''
  if (ref.type === 'PO') return ix.orderById.get(ref.id)?.expected_delivery_date || ''
  return ''
}

/** Re-order a stage list. "urgent" keeps the stage's own order (late first). */
export function sortRefs(refs: DocRef[], mode: WorkSort, ix: WorkIndex): DocRef[] {
  if (mode === 'urgent') return refs
  const out = [...refs]
  if (mode === 'newest') out.sort((a, b) => createdAt(b, ix).localeCompare(createdAt(a, ix)))
  if (mode === 'oldest') out.sort((a, b) => createdAt(a, ix).localeCompare(createdAt(b, ix)))
  // Earliest needed date first; documents with no date go last.
  if (mode === 'needed') out.sort((a, b) => (neededOn(a, ix) || '9999').localeCompare(neededOn(b, ix) || '9999'))
  return out
}
