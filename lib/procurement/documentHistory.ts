// Turns raw document_events rows (one per inserted / updated / deleted table
// row, see 202610160001_document_history.sql) into readable history entries:
// one entry per user action (= one database transaction), with a title and a
// list of plain-language change lines.

export type DocumentEventRow = {
  id: number
  occurred_at: string
  tx_id: number
  actor_id: string | null
  table_name: string
  op: 'insert' | 'update' | 'delete'
  row_id: string | null
  pr_id: string | null
  po_id: string | null
  gr_id: string | null
  pv_id: string | null
  action: string | null
  reason: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
}

export type HistoryLookups = {
  actors: Map<string, string>
  materials: Map<number, { name: string; unit: string }>
  /** purchase_order_items id -> material id (live rows and deleted ones) */
  poiMaterial: Map<string, number>
  /** purchase_request_items id -> material id */
  priMaterial: Map<string, number>
  prNo: Map<string, string>
  poNo: Map<string, string>
  riNo: Map<string, string>
  ppNo: Map<string, string>
  plots: Map<string, string>
}

export type HistoryEntry = {
  key: string
  at: string
  actor: string
  title: string
  /** Document numbers this entry touched - only filled for the cross-document audit list. */
  docLabel: string | null
  reason: string | null
  tone: 'normal' | 'danger'
  lines: string[]
}

const PR_STATUS: Record<string, string> = {
  pending_review: 'รอตรวจ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
  ordered: 'สั่งซื้อแล้ว',
  received: 'รับของแล้ว',
}

const PO_STATUS: Record<string, string> = {
  draft: 'ร่าง',
  sent: 'ส่งแล้ว',
  partially_received: 'รับบางส่วน',
  received: 'รับครบแล้ว',
  paid: 'จ่ายแล้ว',
  cancelled: 'ยกเลิก',
}

const ACTION_TITLE: Record<string, string> = {
  undo_received: 'ยกเลิกการรับของ',
  delete_po: 'ลบใบสั่งซื้อ',
  void_voucher: 'ยกเลิกใบสำคัญจ่าย',
  cancel_po: 'ยกเลิกใบสั่งซื้อ',
  link_request_po: 'ผูกคำขอซื้อกับใบสั่งซื้อ',
  unlink_request_po: 'ยกเลิกการผูกคำขอซื้อกับใบสั่งซื้อ',
}

const DANGER_ACTIONS = new Set(['undo_received', 'delete_po', 'void_voucher', 'cancel_po'])

const HEADER_TABLES = new Set(['purchase_requests', 'purchase_orders', 'goods_receipts', 'payment_vouchers'])

/** Header columns worth showing when they change. Anything not listed (ids
 * of the people who confirmed/received, computed VAT, ...) is noise. */
const HEADER_FIELDS: Record<string, string> = {
  status: 'สถานะ',
  note: 'หมายเหตุ',
  review_note: 'หมายเหตุผู้ตรวจ',
  needed_by_date: 'ต้องการภายใน',
  project_id: 'โครงการ',
  plot_id: 'แปลง',
  plot_group_id: 'กลุ่มแปลง',
  supplier_id: 'ผู้จำหน่าย',
  supplier_branch_id: 'สาขาผู้จำหน่าย',
  company_id: 'บริษัทผู้สั่งซื้อ',
  order_date: 'วันที่สั่ง',
  expected_delivery_date: 'กำหนดส่ง',
  payment_terms: 'เงื่อนไขการชำระ',
  delivery_address: 'ที่อยู่จัดส่ง',
  discount_amount: 'ส่วนลด',
  vat_percent: 'VAT %',
  total_amount: 'ยอดรวม',
  is_outside_boq: 'นอก BOQ',
  outside_boq_reason: 'เหตุผลนอก BOQ',
  received_at: 'วันที่รับ',
  paid_at: 'วันที่จ่าย',
  delivery_note_no: 'เลขใบส่งของ',
  default_destination: 'ปลายทาง',
  payment_date: 'วันที่จ่าย',
  payment_method: 'วิธีจ่าย',
}

/** Columns that hold an id we can only say "changed" about (no name lookup). */
const OPAQUE_ID_FIELDS = new Set(['project_id', 'plot_group_id', 'supplier_id', 'supplier_branch_id', 'company_id'])

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function fmtNum(v: unknown): string {
  return num(v).toLocaleString('th-TH', { maximumFractionDigits: 2 })
}

function fmtValue(field: string, v: unknown, table: string, lookups: HistoryLookups): string {
  if (v === null || v === undefined || v === '') return '-'
  if (field === 'status') {
    const map = table === 'purchase_requests' ? PR_STATUS : PO_STATUS
    return map[String(v)] || String(v)
  }
  if (field === 'plot_id') return lookups.plots.get(String(v)) || 'แปลง'
  if (field === 'is_outside_boq') return v ? 'ใช่' : 'ไม่ใช่'
  if (field === 'default_destination') return v === 'site' ? 'ส่งตรงหน้างาน' : 'เข้าสโตร์'
  if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v))) return fmtNum(v)
  return String(v)
}

function data(e: DocumentEventRow): Record<string, unknown> {
  return (e.new_data || e.old_data || {}) as Record<string, unknown>
}

function materialLabel(id: number | null | undefined, lookups: HistoryLookups): { name: string; unit: string } {
  if (id == null) return { name: 'วัสดุ', unit: '' }
  return lookups.materials.get(Number(id)) || { name: `วัสดุ #${id}`, unit: '' }
}

function itemMaterialId(e: DocumentEventRow, lookups: HistoryLookups): number | null {
  const d = data(e)
  if (d.material_type_id != null) return Number(d.material_type_id)
  if (d.purchase_order_item_id) return lookups.poiMaterial.get(String(d.purchase_order_item_id)) ?? null
  if (d.purchase_request_item_id) return lookups.priMaterial.get(String(d.purchase_request_item_id)) ?? null
  return null
}

const ITEM_QTY_FIELD: Record<string, string> = {
  purchase_request_items: 'quantity_requested',
  purchase_order_items: 'quantity_ordered',
  goods_receipt_items: 'quantity_received',
}

const ITEM_UPDATE_FIELDS: Record<string, string> = {
  quantity_requested: 'จำนวนขอ',
  quantity_ordered: 'จำนวนสั่ง',
  quantity_received: 'รับแล้ว',
  unit_price: 'ราคา/หน่วย',
  discount_amount: 'ส่วนลด',
  material_type_id: 'วัสดุ',
  destination: 'ปลายทาง',
  note: 'หมายเหตุ',
}

/** pr_update rewrites every request line (delete all, insert all) and po_update
 * rewrites allocations the same way. A delete and an insert of the same thing
 * in one action is not a change - drop both, and turn same-material pairs with
 * a different quantity into one "a -> b" line. */
function pairRewrites(events: DocumentEventRow[], lookups: HistoryLookups): { rest: DocumentEventRow[]; lines: string[] } {
  const lines: string[] = []
  const used = new Set<number>()
  const deletes = events.filter((e) => e.op === 'delete')
  const inserts = events.filter((e) => e.op === 'insert')

  for (const del of deletes) {
    const d = del.old_data || {}
    const match = inserts.find((ins) => {
      if (used.has(ins.id) || ins.table_name !== del.table_name) return false
      const n = ins.new_data || {}
      switch (del.table_name) {
        case 'purchase_request_items':
          return n.material_type_id === d.material_type_id
        case 'purchase_order_item_allocations':
          return n.purchase_order_item_id === d.purchase_order_item_id && n.purchase_request_item_id === d.purchase_request_item_id
        case 'purchase_order_plots':
        case 'purchase_request_plots':
          return n.plot_id === d.plot_id
        default:
          return false
      }
    })
    if (!match) continue
    used.add(del.id)
    used.add(match.id)

    const qtyField = del.table_name === 'purchase_request_items' ? 'quantity_requested' : del.table_name === 'purchase_order_item_allocations' ? 'quantity_allocated' : null
    if (qtyField && num(d[qtyField]) !== num((match.new_data || {})[qtyField])) {
      const m = materialLabel(itemMaterialId(del, lookups), lookups)
      const label = del.table_name === 'purchase_request_items' ? 'จำนวนขอ' : 'จำนวนที่ผูก'
      lines.push(`${m.name}: ${label} ${fmtNum(d[qtyField])} → ${fmtNum((match.new_data || {})[qtyField])} ${m.unit}`.trim())
    }
  }

  return { rest: events.filter((e) => !used.has(e.id)), lines }
}

function describeEvent(e: DocumentEventRow, lookups: HistoryLookups, titleIsStatus: boolean): string[] {
  const d = data(e)

  if (HEADER_TABLES.has(e.table_name)) {
    if (e.op === 'insert') return []
    if (e.op === 'delete') {
      const parts: string[] = []
      if (e.table_name === 'purchase_orders') parts.push(`ใบสั่งซื้อ ${d.po_no ?? ''} ยอดรวม ${fmtNum(d.total_amount)} บาท ถูกลบ`)
      if (e.table_name === 'goods_receipts') parts.push(`ใบรับสินค้า ${d.ri_no ?? ''} ถูกลบ`)
      if (e.table_name === 'payment_vouchers') parts.push(`ใบสำคัญจ่าย ${d.pp_no ?? ''} ยอด ${fmtNum(d.total_amount)} บาท ถูกลบ`)
      if (e.table_name === 'purchase_requests') parts.push(`คำขอซื้อ PR-${d.pr_no ?? ''} ถูกลบ`)
      return parts
    }
    const old = e.old_data || {}
    const lines: string[] = []
    for (const field of Object.keys(old)) {
      const label = HEADER_FIELDS[field]
      if (!label) continue
      if (field === 'status' && titleIsStatus) continue
      if (OPAQUE_ID_FIELDS.has(field)) {
        lines.push(`เปลี่ยน${label}`)
        continue
      }
      lines.push(`${label}: ${fmtValue(field, old[field], e.table_name, lookups)} → ${fmtValue(field, (e.new_data || {})[field], e.table_name, lookups)}`)
    }
    return lines
  }

  const m = materialLabel(itemMaterialId(e, lookups), lookups)

  switch (e.table_name) {
    case 'purchase_request_items':
    case 'purchase_order_items':
    case 'goods_receipt_items': {
      const qtyField = ITEM_QTY_FIELD[e.table_name]
      if (e.op === 'insert') {
        const price = e.table_name === 'purchase_order_items' && d.unit_price != null ? ` @ ${fmtNum(d.unit_price)} บาท` : ''
        const dest = e.table_name === 'goods_receipt_items' && d.destination === 'site' ? ' (ส่งตรงหน้างาน)' : ''
        return [`+ ${m.name} ${fmtNum(d[qtyField])} ${m.unit}${price}${dest}`.replace(/\s+/g, ' ').trim()]
      }
      if (e.op === 'delete') return [`− ${m.name} ${fmtNum(d[qtyField])} ${m.unit}`.replace(/\s+/g, ' ').trim()]
      const old = e.old_data || {}
      const changes = Object.keys(old)
        .filter((f) => ITEM_UPDATE_FIELDS[f])
        .map((f) => {
          if (f === 'material_type_id') return `วัสดุ ${materialLabel(Number(old[f]), lookups).name} → ${m.name}`
          if (f === 'destination') return `ปลายทาง ${old[f] === 'site' ? 'หน้างาน' : 'สโตร์'} → ${d[f] === 'site' ? 'หน้างาน' : 'สโตร์'}`
          if (f === 'note') return `หมายเหตุ ${old[f] || '-'} → ${d[f] || '-'}`
          return `${ITEM_UPDATE_FIELDS[f]} ${fmtNum(old[f])} → ${fmtNum(d[f])}`
        })
      return changes.length > 0 ? [`${m.name}: ${changes.join(', ')}`] : []
    }
    case 'purchase_order_item_allocations': {
      const prNo = e.pr_id ? lookups.prNo.get(e.pr_id) : null
      const poNo = e.po_id ? lookups.poNo.get(e.po_id) : null
      const link = [poNo, prNo ? `PR-${prNo}` : null].filter(Boolean).join(' ↔ ')
      if (e.op === 'insert') return [`ผูก ${link}: ${m.name} ${fmtNum(d.quantity_allocated)} ${m.unit}`.trim()]
      if (e.op === 'delete') return [`ยกเลิกการผูก ${link}: ${m.name} ${fmtNum(d.quantity_allocated)} ${m.unit}`.trim()]
      const old = e.old_data || {}
      if ('quantity_allocated' in old) return [`${link}: จำนวนที่ผูก ${fmtNum(old.quantity_allocated)} → ${fmtNum(d.quantity_allocated)}`]
      return []
    }
    case 'purchase_order_plots':
    case 'purchase_request_plots': {
      const name = lookups.plots.get(String(d.plot_id)) || 'แปลง'
      if (e.op === 'insert') return [`+ แปลง ${name}`]
      if (e.op === 'delete') return [`− แปลง ${name}`]
      return []
    }
    case 'purchase_request_item_settlements': {
      if (e.op === 'insert') return [`ปิดยอดค้าง ${m.name} ${fmtNum(d.quantity)} ${m.unit}${d.reason ? ` (${d.reason})` : ''}`]
      if (e.op === 'delete') return [`ยกเลิกการปิดยอด ${m.name} ${fmtNum(d.quantity)} ${m.unit}`]
      return []
    }
    case 'stock_movements': {
      const dir = d.type === 'in' ? 'รับเข้า' : 'จ่ายออก'
      const site = d.source_type === 'direct_to_site' ? ' (ส่งตรงหน้างาน)' : ''
      if (e.op === 'delete') return [`ลบรายการสต็อก: ${dir} ${m.name} ${fmtNum(d.quantity)} ${m.unit}${site}`.trim()]
      return [`แก้รายการสต็อก: ${m.name}`]
    }
    case 'payment_voucher_receipts': {
      const ri = d.goods_receipt_id ? lookups.riNo.get(String(d.goods_receipt_id)) : null
      if (e.op === 'insert') return [`+ ใบรับสินค้า ${ri || ''} ${fmtNum(d.amount)} บาท`.replace(/\s+/g, ' ')]
      if (e.op === 'delete') return [`− ใบรับสินค้า ${ri || ''} ${fmtNum(d.amount)} บาท`.replace(/\s+/g, ' ')]
      return []
    }
    default:
      return []
  }
}

function titleFor(events: DocumentEventRow[], lookups: HistoryLookups): { title: string; isStatus: boolean } {
  const action = events.find((e) => e.action)?.action
  if (action && ACTION_TITLE[action]) return { title: ACTION_TITLE[action], isStatus: false }

  const header = (table: string, op: DocumentEventRow['op']) => events.find((e) => e.table_name === table && e.op === op)

  const prIns = header('purchase_requests', 'insert')
  if (prIns) return { title: `สร้างคำขอซื้อ PR-${data(prIns).pr_no ?? ''}`, isStatus: false }
  const poIns = header('purchase_orders', 'insert')
  if (poIns) return { title: `สร้างใบสั่งซื้อ ${data(poIns).po_no ?? ''}`, isStatus: false }
  const grIns = header('goods_receipts', 'insert')
  if (grIns) return { title: `รับของ ${data(grIns).ri_no ?? ''}`, isStatus: false }
  const pvIns = header('payment_vouchers', 'insert')
  if (pvIns) return { title: `ออกใบสำคัญจ่าย ${data(pvIns).pp_no ?? ''}`, isStatus: false }

  const statusChange = events.find((e) => HEADER_TABLES.has(e.table_name) && e.op === 'update' && e.old_data && 'status' in e.old_data)
  if (statusChange) {
    const from = fmtValue('status', statusChange.old_data?.status, statusChange.table_name, lookups)
    const to = fmtValue('status', statusChange.new_data?.status, statusChange.table_name, lookups)
    return { title: `เปลี่ยนสถานะ: ${from} → ${to}`, isStatus: true }
  }

  if (events.some((e) => e.table_name === 'purchase_request_item_settlements' && e.op === 'insert')) return { title: 'ปิดยอดค้างคำขอซื้อ', isStatus: false }
  if (events.some((e) => e.table_name === 'purchase_request_item_settlements' && e.op === 'delete')) return { title: 'ยกเลิกการปิดยอดค้าง', isStatus: false }
  if (events.some((e) => e.table_name === 'purchase_order_item_allocations' && e.op === 'insert')) return { title: 'ผูกใบสั่งซื้อกับคำขอซื้อ', isStatus: false }

  return { title: 'แก้ไข', isStatus: false }
}

function docLabelFor(events: DocumentEventRow[], lookups: HistoryLookups): string | null {
  const labels = new Set<string>()
  for (const e of events) {
    const d = data(e)
    if (e.table_name === 'purchase_orders' && d.po_no) labels.add(String(d.po_no))
    else if (e.po_id && lookups.poNo.get(e.po_id)) labels.add(lookups.poNo.get(e.po_id)!)
    if (e.table_name === 'purchase_requests' && d.pr_no != null) labels.add(`PR-${d.pr_no}`)
    else if (e.pr_id && lookups.prNo.get(e.pr_id) && !e.po_id) labels.add(`PR-${lookups.prNo.get(e.pr_id)}`)
    if (e.table_name === 'payment_vouchers' && d.pp_no) labels.add(String(d.pp_no))
    else if (e.pv_id && lookups.ppNo.get(e.pv_id)) labels.add(lookups.ppNo.get(e.pv_id)!)
  }
  return labels.size > 0 ? Array.from(labels).join(', ') : null
}

export function buildHistoryEntries(
  events: DocumentEventRow[],
  lookups: HistoryLookups,
  opts: { withDocLabel?: boolean } = {}
): HistoryEntry[] {
  const groups = new Map<number, DocumentEventRow[]>()
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    const list = groups.get(e.tx_id) || []
    list.push(e)
    groups.set(e.tx_id, list)
  }

  const entries: HistoryEntry[] = []
  for (const [txId, group] of groups) {
    const { title, isStatus } = titleFor(group, lookups)
    const { rest, lines: pairedLines } = pairRewrites(group, lookups)
    const lines = [...pairedLines]
    for (const e of rest) lines.push(...describeEvent(e, lookups, isStatus))

    // A pure no-op rewrite (PR saved without changes) leaves nothing to show.
    if (title === 'แก้ไข' && lines.length === 0) continue

    const action = group.find((e) => e.action)?.action || null
    const first = group[0]
    entries.push({
      key: String(txId),
      at: first.occurred_at,
      actor: first.actor_id ? lookups.actors.get(first.actor_id) || 'ผู้ใช้' : 'ระบบ',
      title,
      docLabel: opts.withDocLabel ? docLabelFor(group, lookups) : null,
      reason: group.find((e) => e.reason)?.reason || null,
      tone: action && DANGER_ACTIONS.has(action) ? 'danger' : 'normal',
      lines,
    })
  }

  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}
