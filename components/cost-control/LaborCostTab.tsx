import { formatCurrency } from '@/lib/currency'
import type { LaborLedgerEntry } from '@/lib/labor-budget'

/** Lifted from the labor tab of the now-retired ProjectCostReportModal. */
export default function LaborCostTab({ entries }: { entries: LaborLedgerEntry[] }) {
  const total = entries.reduce((sum, e) => sum + e.approved, 0)

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-10 text-center text-sm text-slate-400">
        ยังไม่มีงานผู้รับเหมาที่เกี่ยวข้องกับขอบเขตนี้
      </div>
    )
  }

  return (
    <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-50 text-xs font-medium text-slate-500">
          <tr>
            <th className="px-3 py-2">ผู้รับเหมา</th>
            <th className="px-3 py-2">รายการงาน / แปลง</th>
            <th className="px-3 py-2 text-right">งบประมาณ</th>
            <th className="px-3 py-2 text-right">อนุมัติแล้ว</th>
            <th className="px-3 py-2 text-right">ค้างอนุมัติ</th>
            <th className="px-3 py-2 text-right">คงเหลือ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {entries.map((entry) => (
            <tr key={entry.jobId} className="align-top">
              <td className="px-3 py-2.5 text-slate-700">{entry.contractorName}</td>
              <td className="px-3 py-2.5">
                <div className="font-medium text-slate-800">{entry.itemName}</div>
                <div className="text-xs text-slate-400">แปลง {entry.plotName}</div>
              </td>
              <td className="px-3 py-2.5 text-right text-slate-700">฿{formatCurrency(entry.budget)}</td>
              <td className="px-3 py-2.5 text-right text-emerald-700">฿{formatCurrency(entry.approved)}</td>
              <td className="px-3 py-2.5 text-right text-amber-700">{entry.pending > 0 ? `฿${formatCurrency(entry.pending)}` : '-'}</td>
              <td className={`px-3 py-2.5 text-right font-medium ${entry.remaining < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                ฿{formatCurrency(entry.remaining)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t bg-slate-50">
          <tr>
            <td colSpan={3} className="px-3 py-2 text-right font-semibold text-slate-700">รวม</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-800">฿{formatCurrency(total)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
