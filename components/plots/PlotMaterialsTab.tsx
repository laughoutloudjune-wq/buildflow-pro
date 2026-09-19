import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { PlotMaterialRowView } from '@/lib/types/plotDetail'

export default function PlotMaterialsTab({ materials, canSeeCost }: { materials: PlotMaterialRowView[]; canSeeCost: boolean }) {
  if (materials.length === 0) {
    return (
      <Card className="p-8 text-center text-slate-400">
        ยังไม่มีวัสดุที่สั่งซื้อสำหรับแปลงนี้
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-700 border-b">
            <tr>
              <th className="px-4 py-3 font-semibold">วัสดุ</th>
              <th className="px-4 py-3 font-semibold text-right">สั่งซื้อ</th>
              <th className="px-4 py-3 font-semibold text-right">รับแล้ว</th>
              {canSeeCost && <th className="px-4 py-3 font-semibold text-right">มูลค่าสั่งซื้อ</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {materials.map((m) => (
              <tr key={m.materialTypeId} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{m.name}</td>
                <td className="px-4 py-3 text-right text-slate-600">{m.orderedQty.toLocaleString('th-TH')} {m.unit}</td>
                <td className="px-4 py-3 text-right text-slate-600">{m.receivedQty.toLocaleString('th-TH')} {m.unit}</td>
                {canSeeCost && (
                  <td className="px-4 py-3 text-right font-medium text-slate-700">
                    {m.orderedValue != null ? `฿${formatCurrency(m.orderedValue)}` : '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
