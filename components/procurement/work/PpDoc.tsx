'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import ReasonDialog from '@/components/ui/ReasonDialog'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import { voidPaymentVoucher } from '@/actions/procurement-actions'
import { docNo } from '@/lib/status-labels'
import { buildChain } from '@/lib/procurement/workQueue'
import { DocFacts, DocModal, DocSteps, DocTable, fmtDate, type MoreItem } from './docUi'
import { nowOf } from '@/lib/procurement/nowStatus'
import type { DocCtx } from './types'

const METHOD: Record<string, string> = { cash: 'เงินสด', bank_transfer: 'เงินโอน', director_loan: 'เงินกู้ยืมกรรมการ' }

/** A payment voucher, in the one window layout: detail and print in one place. */
export default function PpDoc({ id, ctx }: { id: string; ctx: DocCtx }) {
  const voucher = ctx.ix.voucherById.get(id)
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [voiding, setVoiding] = useState(false)
  if (!voucher) return null
  const chain = buildChain({ type: 'PP', id }, ctx.ix)
  const now = nowOf({ type: 'PP', id }, ctx.ix, ctx.today)
  const lines = voucher.payment_voucher_receipts || []

  function confirmVoid(reason: string) {
    startTransition(async () => {
      const result = await voidPaymentVoucher(id, reason)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      setVoiding(false)
      toast.success('ยกเลิกใบจ่ายเงินแล้ว · ใบรับของกลับไปรอจ่าย')
      ctx.refresh()
      ctx.close()
    })
  }

  const more: MoreItem[] = [{ key: 'void', label: 'ยกเลิกใบจ่าย', onClick: () => setVoiding(true), danger: true }]

  return (
    <>
      <DocModal
        title={`ใบจ่ายเงิน ${docNo('PP', voucher.pp_no)}`}
        now={now}
        onClose={ctx.close}
        onBack={ctx.back ?? undefined}
        backLabel={ctx.backLabel}
        position={ctx.position}
        more={more}
        secondary={
          <a href={`/api/procurement/payments/${id}/pdf`} target="_blank" rel="noreferrer">
            <Button type="button" variant="secondary" disabled={isPending}>
              พิมพ์ใบจ่าย
            </Button>
          </a>
        }
      >
        <DocSteps chain={chain} current={{ type: 'PP', id }} ix={ctx.ix} now={now} onGo={ctx.go} />
        <DocFacts
          items={[
            { label: 'ร้าน', value: voucher.suppliers?.name || '-' },
            { label: 'วันที่จ่าย', value: fmtDate(voucher.payment_date) },
            { label: 'วิธีจ่าย', value: METHOD[voucher.payment_method] || voucher.payment_method },
            { label: 'ยอดจ่าย', value: `฿${formatCurrency(Number(voucher.total_amount))}` },
          ]}
        />
        <DocTable>
          <thead>
            <tr>
              <th>ใบรับของ</th>
              <th className="hidden sm:table-cell">ใบสั่งซื้อ</th>
              <th className="n hidden sm:table-cell">ก่อน VAT</th>
              <th className="n hidden sm:table-cell">VAT</th>
              <th className="n">ยอดรวม VAT</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const receipt = ctx.ix.receiptById.get(line.goods_receipt_id)
              const poId = receipt?.purchase_order_id
              return (
                <tr key={line.id}>
                  <td>
                    {receipt ? (
                      <button type="button" className="font-mono text-xs text-indigo-600 hover:underline" onClick={() => ctx.go({ type: 'RI', id: receipt.id })}>
                        {line.goods_receipts?.ri_no}
                      </button>
                    ) : (
                      <span className="font-mono text-xs">{line.goods_receipts?.ri_no || '-'}</span>
                    )}
                  </td>
                  <td className="hidden sm:table-cell">
                    {poId ? (
                      <button type="button" className="font-mono text-xs text-indigo-600 hover:underline" onClick={() => ctx.go({ type: 'PO', id: poId })}>
                        {line.goods_receipts?.purchase_orders?.po_no}
                      </button>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="n hidden sm:table-cell">{formatCurrency(Number(line.subtotal))}</td>
                  <td className="n hidden sm:table-cell">{formatCurrency(Number(line.vat_amount))}</td>
                  <td className="n">{formatCurrency(Number(line.amount))}</td>
                </tr>
              )
            })}
          </tbody>
        </DocTable>
        {voucher.note && <p className="text-sm text-slate-600">หมายเหตุ: {voucher.note}</p>}
      </DocModal>
      <ReasonDialog isOpen={voiding} title="ยกเลิกใบจ่ายเงิน" label="เหตุผล" required busy={isPending} onConfirm={confirmVoid} onCancel={() => setVoiding(false)} />
    </>
  )
}
