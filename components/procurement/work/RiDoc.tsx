'use client'

import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/currency'
import { docNo } from '@/lib/status-labels'
import { buildChain, isReceiptPaid, receiptAmount, receiptStatusWord } from '@/lib/procurement/workQueue'
import { DocChainBar, DocFacts, DocModal, DocTable, StatusChip, fmtDate, qtyText, type MoreItem } from './docUi'
import type { DocCtx } from './types'

const DEST: Record<string, string> = { store: 'เข้าสโตร์', site: 'ส่งตรงหน้างาน' }

/** A goods receipt, in the one window layout. */
export default function RiDoc({ id, ctx }: { id: string; ctx: DocCtx }) {
  const receipt = ctx.ix.receiptById.get(id)
  if (!receipt) return null
  const status = receiptStatusWord(receipt)
  const chain = buildChain({ type: 'RI', id }, ctx.ix)
  const paid = isReceiptPaid(receipt)
  const items = receipt.goods_receipt_items || []

  const more: MoreItem[] = [
    { key: 'print', label: 'พิมพ์ / PDF', href: `/api/procurement/receipts/${id}/pdf` },
    { key: 'po', label: 'ดูใบสั่งซื้อ', onClick: () => ctx.go({ type: 'PO', id: receipt.purchase_order_id }) },
  ]

  return (
    <DocModal
      title={`ใบรับของ ${docNo('RI', receipt.ri_no)}`}
      status={<StatusChip label={status.label} tone={status.tone} />}
      onClose={ctx.close}
      onBack={ctx.back ?? undefined}
      backLabel={ctx.backLabel}
      position={ctx.position}
      more={more}
      primary={
        paid ? null : (
          <Button
            type="button"
            onClick={() => ctx.pay([id])}
          >
            จ่ายเงิน
          </Button>
        )
      }
    >
      <DocChainBar chain={chain} current={{ type: 'RI', id }} ix={ctx.ix} onGo={ctx.go} />
      <DocFacts
        items={[
          { label: 'ร้าน', value: receipt.purchase_orders?.suppliers?.name || '-' },
          { label: 'วันที่รับ', value: fmtDate(receipt.received_at) },
          { label: 'ใบส่งของร้าน', value: receipt.delivery_note_no || '–' },
          { label: 'ยอดรวม (ก่อน VAT)', value: `฿${formatCurrency(receiptAmount(receipt))}` },
        ]}
      />
      <DocTable>
        <thead>
          <tr>
            <th>วัสดุ</th>
            <th className="n">รับครั้งนี้</th>
            <th className="n hidden sm:table-cell">ราคา/หน่วย</th>
            <th className="n">รวม</th>
            <th className="hidden sm:table-cell">ไปที่</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const m = item.purchase_order_items?.material_types
            const dest = item.destination || receipt.default_destination
            return (
              <tr key={item.id}>
                <td>{m?.name || '-'}</td>
                <td className="n whitespace-nowrap">
                  {qtyText(Number(item.quantity_received))} {m?.unit || ''}
                </td>
                <td className="n hidden sm:table-cell">{formatCurrency(Number(item.unit_price_at_receipt))}</td>
                <td className="n">{formatCurrency(Number(item.quantity_received) * Number(item.unit_price_at_receipt))}</td>
                <td className="hidden sm:table-cell">{DEST[dest] || '-'}</td>
              </tr>
            )
          })}
        </tbody>
      </DocTable>
      {receipt.note && <p className="text-sm text-slate-600">หมายเหตุ: {receipt.note}</p>}
    </DocModal>
  )
}
