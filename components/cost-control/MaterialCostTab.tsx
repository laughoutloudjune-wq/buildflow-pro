import Link from 'next/link'
import { formatCurrency } from '@/lib/currency'
import type { MaterialsSummaryRow } from '@/actions/procurement/materials-summary'

const PO_STATUS_LABEL: Record<string, string> = {
  draft: 'ร่าง',
  sent: 'ยืนยันสั่งซื้อ',
  partially_received: 'รับของบางส่วน',
  received: 'รับของแล้ว',
  paid: 'ชำระแล้ว',
}

/** Lifted from the materials tab of the now-retired ProjectCostReportModal -
 * same table, same columns, so nothing about how material cost is read
 * changes for anyone who used the old modal. */
export default function MaterialCostTab({ rows }: { rows: MaterialsSummaryRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.received_value, 0)

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-10 text-center text-sm text-slate-400">
        ยังไม่มีใบสั่งซื้อที่เกี่ยวข้องกับขอบเขตนี้
      </div>
    )
  }

  return (
    <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-50 text-xs font-medium text-slate-500">
          <tr>
            <th className="px-3 py-2">วัสดุ</th>
            <th className="px-3 py-2 text-right">สั่งซื้อรวม</th>
            <th className="px-3 py-2 text-right">รับแล้ว</th>
            <th className="px-3 py-2 text-right">มูลค่าที่รับแล้ว</th>
            <th className="px-3 py-2">ใบสั่งซื้อที่เกี่ยวข้อง</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row) => (
            <tr key={row.material_type_id} className="align-top">
              <td className="px-3 py-2.5 font-medium text-slate-800">{row.name}</td>
              <td className="px-3 py-2.5 text-right text-slate-700">
                {row.quantity_ordered.toLocaleString('th-TH')} {row.unit}
              </td>
              <td className="px-3 py-2.5 text-right text-emerald-700">
                {row.quantity_received.toLocaleString('th-TH')} {row.unit}
              </td>
              <td className="px-3 py-2.5 text-right font-medium text-slate-800">฿{formatCurrency(row.received_value)}</td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1">
                  {row.orders.map((o) => (
                    <Link
                      key={o.id}
                      href={`/dashboard/procurement/orders/${o.id}`}
                      title={PO_STATUS_LABEL[o.status] || o.status}
                      className="rounded-full bg-indigo-50 px-2 py-0.5 font-mono text-xs text-indigo-700 hover:bg-indigo-100"
                    >
                      {o.po_no}
                    </Link>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t bg-slate-50">
          <tr>
            <td colSpan={3} className="px-3 py-2 text-right font-semibold text-slate-700">รวม</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-800">฿{formatCurrency(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
