import { expect, test } from '@playwright/test'
import { buildHistoryEntries, type DocumentEventRow, type HistoryLookups } from '@/lib/procurement/documentHistory'

// Pure-logic coverage for turning document_events rows into readable history
// (MATERIAL_TRAIL_PLAN.md Phase A) - no page/browser needed.

const PO = 'po-1'
const PR = 'pr-1'

function lookups(): HistoryLookups {
  return {
    actors: new Map([['u-1', 'จูน']]),
    materials: new Map([
      [10, { name: 'ปูนซีเมนต์', unit: 'ถุง' }],
      [20, { name: 'กระจกห้องน้ำ', unit: 'บาน' }],
    ]),
    poiMaterial: new Map([['poi-1', 10]]),
    priMaterial: new Map([['pri-1', 10]]),
    prNo: new Map([[PR, '42']]),
    poNo: new Map([[PO, 'PO-20261016001']]),
    riNo: new Map([['gr-1', 'RI-20261016001']]),
    ppNo: new Map(),
    plots: new Map([['plot-1', 'แปลง 101']]),
  }
}

let nextId = 1
function ev(overrides: Partial<DocumentEventRow>): DocumentEventRow {
  return {
    id: nextId++,
    occurred_at: '2026-10-16T03:00:00Z',
    tx_id: 1,
    actor_id: 'u-1',
    table_name: 'purchase_orders',
    op: 'update',
    row_id: null,
    pr_id: null,
    po_id: PO,
    gr_id: null,
    pv_id: null,
    action: null,
    reason: null,
    old_data: null,
    new_data: null,
    ...overrides,
  }
}

test.describe('buildHistoryEntries', () => {
  test('groups one undo-received action into one danger entry with its reason', () => {
    const events = [
      ev({ table_name: 'stock_movements', op: 'delete', gr_id: 'gr-1', action: 'undo_received', reason: 'นับจำนวนผิด', old_data: { type: 'in', source_type: 'goods_receipt', material_type_id: 10, quantity: 50 } }),
      ev({ table_name: 'purchase_order_items', op: 'update', action: 'undo_received', reason: 'นับจำนวนผิด', old_data: { quantity_received: 50 }, new_data: { material_type_id: 10, quantity_received: 0 } }),
      ev({ table_name: 'goods_receipts', op: 'delete', gr_id: 'gr-1', action: 'undo_received', reason: 'นับจำนวนผิด', old_data: { ri_no: 'RI-20261016001' } }),
      ev({ table_name: 'purchase_orders', op: 'update', action: 'undo_received', reason: 'นับจำนวนผิด', old_data: { status: 'received' }, new_data: { status: 'sent' } }),
    ]
    const entries = buildHistoryEntries(events, lookups())
    expect(entries).toHaveLength(1)
    const [entry] = entries
    expect(entry.title).toBe('ยกเลิกการรับของ')
    expect(entry.tone).toBe('danger')
    expect(entry.reason).toBe('นับจำนวนผิด')
    expect(entry.actor).toBe('จูน')
    expect(entry.lines).toContain('ลบรายการสต็อก: รับเข้า ปูนซีเมนต์ 50 ถุง')
    expect(entry.lines).toContain('ปูนซีเมนต์: รับแล้ว 50 → 0')
    expect(entry.lines).toContain('ใบรับสินค้า RI-20261016001 ถูกลบ')
    expect(entry.lines).toContain('สถานะ: รับครบแล้ว → ส่งแล้ว')
  })

  test('a PR saved with one quantity changed shows only that change', () => {
    // pr_update deletes every line and re-inserts them.
    const events = [
      ev({ table_name: 'purchase_request_items', op: 'delete', po_id: null, pr_id: PR, old_data: { material_type_id: 10, quantity_requested: 30 } }),
      ev({ table_name: 'purchase_request_items', op: 'delete', po_id: null, pr_id: PR, old_data: { material_type_id: 20, quantity_requested: 3 } }),
      ev({ table_name: 'purchase_request_items', op: 'insert', po_id: null, pr_id: PR, new_data: { material_type_id: 10, quantity_requested: 40 } }),
      ev({ table_name: 'purchase_request_items', op: 'insert', po_id: null, pr_id: PR, new_data: { material_type_id: 20, quantity_requested: 3 } }),
    ]
    const [entry] = buildHistoryEntries(events, lookups())
    expect(entry.title).toBe('แก้ไข')
    expect(entry.lines).toEqual(['ปูนซีเมนต์: จำนวนขอ 30 → 40 ถุง'])
  })

  test('a PR saved with no changes produces no entry', () => {
    const events = [
      ev({ table_name: 'purchase_request_items', op: 'delete', po_id: null, pr_id: PR, old_data: { material_type_id: 20, quantity_requested: 3 } }),
      ev({ table_name: 'purchase_request_items', op: 'insert', po_id: null, pr_id: PR, new_data: { material_type_id: 20, quantity_requested: 3 } }),
    ]
    expect(buildHistoryEntries(events, lookups())).toHaveLength(0)
  })

  test('creating a PO lists its lines and links, and separate actions stay separate', () => {
    const events = [
      ev({ tx_id: 1, occurred_at: '2026-10-16T01:00:00Z', table_name: 'purchase_orders', op: 'insert', new_data: { po_no: 'PO-20261016001', status: 'draft' } }),
      ev({ tx_id: 1, occurred_at: '2026-10-16T01:00:00Z', table_name: 'purchase_order_items', op: 'insert', new_data: { material_type_id: 10, quantity_ordered: 50, unit_price: 145 } }),
      ev({ tx_id: 1, occurred_at: '2026-10-16T01:00:00Z', table_name: 'purchase_order_item_allocations', op: 'insert', pr_id: PR, new_data: { purchase_order_item_id: 'poi-1', purchase_request_item_id: 'pri-1', quantity_allocated: 50 } }),
      ev({ tx_id: 2, occurred_at: '2026-10-16T02:00:00Z', table_name: 'purchase_orders', op: 'update', old_data: { status: 'draft' }, new_data: { status: 'sent' } }),
    ]
    const entries = buildHistoryEntries(events, lookups())
    expect(entries.map((e) => e.title)).toEqual(['เปลี่ยนสถานะ: ร่าง → ส่งแล้ว', 'สร้างใบสั่งซื้อ PO-20261016001'])
    const created = entries[1]
    expect(created.lines).toContain('+ ปูนซีเมนต์ 50 ถุง @ 145 บาท')
    expect(created.lines).toContain('ผูก PO-20261016001 ↔ PR-42: ปูนซีเมนต์ 50 ถุง')
    // Status already in the title - not repeated as a line.
    expect(entries[0].lines).toEqual([])
  })

  test('the audit list labels each entry with its document number', () => {
    const events = [
      ev({ table_name: 'purchase_orders', op: 'delete', action: 'delete_po', reason: 'สั่งซ้ำ', old_data: { po_no: 'PO-20261016001', total_amount: 7250 } }),
    ]
    const [entry] = buildHistoryEntries(events, lookups(), { withDocLabel: true })
    expect(entry.docLabel).toBe('PO-20261016001')
    expect(entry.title).toBe('ลบใบสั่งซื้อ')
    expect(entry.lines).toEqual(['ใบสั่งซื้อ PO-20261016001 ยอดรวม 7,250 บาท ถูกลบ'])
  })
})
