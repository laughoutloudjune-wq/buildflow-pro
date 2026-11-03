/**
 * "ตอนนี้": the one thing a person needs to know about a document - what is
 * happening to it, who has to act, and where in the four steps (request,
 * order, receive, pay) it is stuck. The list rows and the top box of the
 * document window both read it, so they always agree. Pure functions over
 * the lists the page already loaded; no new data.
 */
import type { PaymentMethod } from '@/lib/types/procurement'
import { docNo } from '@/lib/status-labels'
import {
  isReceiptPaid,
  openLines,
  orderIsLate,
  receiptAmount,
  requestIsLate,
  type DocRef,
  type WorkIndex,
} from '@/lib/procurement/workQueue'

/** you = waiting for you, shop = waiting for the shop, late = past its date, done = finished. */
export type NowGroup = 'you' | 'shop' | 'late' | 'done'

export type Now = {
  word: string
  /** One short grey line for the list. */
  sub: string
  /** The plain sentence at the top of the window. */
  text: string
  group: NowGroup
  /** Which of the four steps it is stuck at: 0 request, 1 order, 2 receive, 3 pay, 4 everything done. */
  step: number
}

export const GROUP_LABEL: Record<NowGroup, string> = {
  you: 'รอคุณทำ',
  shop: 'รอร้าน',
  late: 'เลยกำหนด',
  done: 'จบแล้ว',
}

/** Tailwind classes per group: left bar, status word, soft box fill and border. */
export const GROUP_CLASS: Record<NowGroup, { bar: string; word: string; soft: string; border: string; dot: string }> = {
  you: { bar: 'border-l-amber-500', word: 'text-amber-700', soft: 'bg-amber-50', border: 'border-l-amber-500', dot: 'bg-amber-500' },
  shop: { bar: 'border-l-sky-500', word: 'text-sky-700', soft: 'bg-sky-50', border: 'border-l-sky-500', dot: 'bg-sky-500' },
  late: { bar: 'border-l-red-500', word: 'text-red-700', soft: 'bg-red-50', border: 'border-l-red-500', dot: 'bg-red-500' },
  done: { bar: 'border-l-emerald-500', word: 'text-emerald-700', soft: 'bg-emerald-50', border: 'border-l-emerald-500', dot: 'bg-emerald-500' },
}

const METHOD: Record<PaymentMethod, string> = {
  cash: 'เงินสด',
  bank_transfer: 'เงินโอน',
  director_loan: 'เงินกู้ยืมกรรมการ',
}

const baht = (n: number) => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function dayMs(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).getTime()
}

/** Whole days between two ISO dates (to - from); 0 if either is missing. */
export function daysBetween(from: string | null | undefined, to: string | null | undefined): number {
  if (!from || !to) return 0
  return Math.max(0, Math.round((dayMs(to) - dayMs(from)) / 86400000))
}

/** "2 พ.ย." for a date or timestamp. */
function shortDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })
}

function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' })
  return `${shortDate(iso)} ${time}`
}

export function nowOf(ref: DocRef, ix: WorkIndex, today: string): Now | null {
  if (ref.type === 'PR') return nowOfRequest(ref.id, ix, today)
  if (ref.type === 'PO') return nowOfOrder(ref.id, ix, today)
  if (ref.type === 'RI') return nowOfReceipt(ref.id, ix, today)
  return nowOfVoucher(ref.id, ix)
}

function nowOfRequest(id: string, ix: WorkIndex, today: string): Now | null {
  const r = ix.requestById.get(id)
  if (!r) return null
  const lateDays = requestIsLate(r, today) ? daysBetween(r.needed_by_date, today) : 0
  const lateTail = lateDays > 0 ? ` · เลยวันต้องการ ${lateDays} วัน` : ''
  const requester = r.requester?.full_name || r.requester?.email || 'ผู้ขอ'
  const items = r.purchase_request_items || []
  const poIds = Array.from(ix.posOfRequest.get(id) || [])
  const orders = poIds.map((p) => ix.orderById.get(p)).filter((o): o is NonNullable<typeof o> => Boolean(o))
  const poNos = orders.map((o) => docNo('PO', o.po_no)).join(', ')

  if (r.status === 'pending_review') {
    return {
      word: 'รออนุมัติ',
      sub: `รอคุณตรวจ · ส่งมา ${shortDateTime(r.created_at)}${lateTail}`,
      text: `${requester} ขอ ${items.length} รายการ · ต้องการ ${shortDate(r.needed_by_date)}${lateTail} · กดอนุมัติแล้วไปใบถัดไปให้เอง`,
      group: lateDays > 0 ? 'late' : 'you',
      step: 0,
    }
  }
  if (r.status === 'rejected') {
    return { word: 'ไม่อนุมัติ', sub: r.review_note || 'ไม่ได้ระบุเหตุผล', text: `เหตุผล: ${r.review_note || '-'} · ผู้ขอเห็นเหตุผลนี้แล้ว`, group: 'late', step: 0 }
  }
  if (r.status === 'cancelled') {
    return { word: 'ยกเลิก', sub: 'คำขอนี้ถูกยกเลิกแล้ว', text: 'คำขอนี้ถูกยกเลิกแล้ว', group: 'done', step: 4 }
  }

  const open = openLines(r)
  const live = items.filter((i) => i.line_status !== 'closed').length
  if (r.status === 'approved' && open.length > 0) {
    const word = open.length < live ? `รอสั่ง ${open.length} จาก ${live}` : 'รอสั่ง'
    const partial = poNos ? `สั่งแล้วบางรายการใน ${poNos}` : 'ยังไม่มีใบสั่งซื้อ'
    return {
      word,
      sub: `${partial}${lateTail}`,
      text: `${poNos ? `สั่งแล้วบางรายการใน ${poNos} · ` : ''}รายการที่ยังไม่ได้สั่งอยู่ด้านล่าง ติ๊กเลือกแล้วกด “ออกใบสั่งซื้อ”${lateTail}`,
      group: lateDays > 0 ? 'late' : 'you',
      step: 1,
    }
  }

  if (r.status === 'received') {
    const unpaid = orders.some((o) => (ix.receiptsOfPo.get(o.id) || []).some((rc) => !isReceiptPaid(rc)))
    return {
      word: 'ของครบ',
      sub: `มาครบทุกรายการ${unpaid ? ' · ร้านยังรอจ่าย' : ''}`,
      text: `ของมาครบทุกรายการ · ${unpaid ? 'ร้านยังรอจ่ายเงิน' : 'จ่ายร้านครบแล้ว'}`,
      group: unpaid ? 'you' : 'done',
      step: unpaid ? 3 : 4,
    }
  }

  // Fully ordered (or approved with every line ordered / closed): waiting for goods.
  const liveOrders = orders.filter((o) => o.status !== 'cancelled')
  const lateOrder = liveOrders.find((o) => orderIsLate(o, today))
  const first = lateOrder || liveOrders[0]
  const arrived = items.filter((i) => i.line_status === 'arrived').length
  const where = first ? `${first.suppliers?.name || '-'} · ${docNo('PO', first.po_no)} · นัดส่ง ${shortDate(first.expected_delivery_date)}` : 'รอใบสั่งซื้อ'
  const lateOrderDays = lateOrder ? daysBetween(lateOrder.expected_delivery_date, today) : 0
  return {
    word: lateOrder ? `ของเลยกำหนด ${lateOrderDays} วัน` : 'รอของ',
    sub: where,
    text: first
      ? `สั่งครบแล้วใน ${docNo('PO', first.po_no)} (${first.suppliers?.name || '-'}) · ร้านนัดส่ง ${shortDate(first.expected_delivery_date)} · ${arrived > 0 ? `มาครบ ${arrived} จาก ${live} รายการ` : 'ยังไม่มาเลย'}`
      : 'สั่งครบแล้ว',
    group: lateOrder ? 'late' : 'shop',
    step: 2,
  }
}

function nowOfOrder(id: string, ix: WorkIndex, today: string): Now | null {
  const o = ix.orderById.get(id)
  if (!o) return null
  const items = o.purchase_order_items || []
  const done = items.filter((i) => Number(i.quantity_received) >= Number(i.quantity_ordered) && Number(i.quantity_ordered) > 0).length
  const any = items.some((i) => Number(i.quantity_received) > 0)

  if (o.status === 'draft') {
    return { word: 'ร่าง ยังไม่ส่ง', sub: 'ตรวจราคาแล้วกดส่งให้ร้าน', text: 'ยังไม่ได้ส่งให้ร้าน · ตรวจจำนวนและราคาแล้วกดส่ง', group: 'you', step: 1 }
  }
  if (o.status === 'sent' || o.status === 'partially_received') {
    const late = orderIsLate(o, today)
    const lateDays = late ? daysBetween(o.expected_delivery_date, today) : 0
    const progress = any ? `มาครบ ${done} จาก ${items.length} รายการ` : 'ยังไม่มาเลย'
    return {
      word: late ? `เลยกำหนด ${lateDays} วัน` : any ? 'มาบางส่วน' : 'รอของ',
      sub: `${progress} · นัดส่ง ${shortDate(o.expected_delivery_date)}`,
      text: `ส่งร้านแล้ว ${shortDate(o.order_date)} · ${any ? `ของยังค้าง ${items.length - done} รายการ (ดูคอลัมน์ “ค้าง”)` : 'ยังไม่มีของมาเลย'} · นัดส่ง ${shortDate(o.expected_delivery_date)} · ของมาถึงแล้วกด “รับของ”`,
      group: late ? 'late' : 'shop',
      step: 2,
    }
  }
  if (o.status === 'received') {
    return { word: 'รอจ่าย', sub: 'ของมาครบแล้ว · ยังไม่จ่ายร้าน', text: `ของมาครบแล้ว · ยังไม่ได้จ่ายร้าน ${baht(Number(o.total_amount))}`, group: 'you', step: 3 }
  }
  if (o.status === 'paid') {
    return { word: 'จ่ายแล้ว', sub: 'จ่ายร้านครบแล้ว', text: 'ของมาครบและจ่ายร้านครบแล้ว', group: 'done', step: 4 }
  }
  return { word: 'ยกเลิก', sub: 'ใบสั่งซื้อนี้ถูกยกเลิก', text: 'ใบสั่งซื้อนี้ถูกยกเลิกแล้ว', group: 'done', step: 4 }
}

function nowOfReceipt(id: string, ix: WorkIndex, today: string): Now | null {
  const r = ix.receiptById.get(id)
  if (!r) return null
  if (isReceiptPaid(r)) {
    const ppId = r.payment_voucher_receipts?.[0]?.payment_voucher_id
    const ppNo = ppId ? ix.voucherById.get(ppId)?.pp_no : null
    return { word: 'จ่ายแล้ว', sub: `ใน ${ppNo ? docNo('PP', ppNo) : 'ใบจ่ายเงิน'}`, text: `จ่ายแล้วใน ${ppNo ? docNo('PP', ppNo) : 'ใบจ่ายเงิน'}`, group: 'done', step: 4 }
  }
  const days = daysBetween(r.received_at, today)
  return {
    word: 'รอจ่าย',
    sub: `รับของ ${shortDate(r.received_at)} · ค้าง ${days} วัน`,
    text: `รับของจาก ${r.purchase_orders?.po_no ? docNo('PO', r.purchase_orders.po_no) : 'ใบสั่งซื้อ'} เมื่อ ${shortDate(r.received_at)} · ยอด ${baht(receiptAmount(r))} ยังไม่จ่าย`,
    group: 'you',
    step: 3,
  }
}

function nowOfVoucher(id: string, ix: WorkIndex): Now | null {
  const v = ix.voucherById.get(id)
  if (!v) return null
  const count = (v.payment_voucher_receipts || []).length
  return {
    word: 'จ่ายแล้ว',
    sub: `${METHOD[v.payment_method] || v.payment_method} · ${shortDate(v.payment_date)}`,
    text: `จ่าย ${baht(Number(v.total_amount))} ให้ ${v.suppliers?.name || '-'} · ${METHOD[v.payment_method] || v.payment_method} ${shortDate(v.payment_date)} · ${count} ใบรับของ`,
    group: 'done',
    step: 4,
  }
}
