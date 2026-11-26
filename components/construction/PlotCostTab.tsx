import { MONEY, baht } from '@/components/construction/vocab'
import type { PlotJobRow, PlotMaterialRowView } from '@/lib/types/plotDetail'
import type { PlotExtraWorkRow } from '@/actions/_shared/plot-cost'

/**
 * ต้นทุน of one plot in the five money words: labor on contract, extra work
 * (DC), and material. Same sources as the board row, so they never disagree.
 */
export default function PlotCostTab({ jobs, extraWork, materials }: { jobs: PlotJobRow[]; extraWork: PlotExtraWorkRow[]; materials: PlotMaterialRowView[] }) {
  const contract = jobs.reduce((s, j) => s + (j.cost?.totalBoq ?? 0), 0)
  const paid = jobs.reduce((s, j) => s + (j.cost?.paid ?? 0), 0)
  const dcApproved = extraWork.filter((e) => e.status === 'approved').reduce((s, e) => s + e.value, 0)
  const dcPending = extraWork.filter((e) => e.status !== 'approved').reduce((s, e) => s + e.value, 0)
  const materialUsed = materials.reduce((s, m) => s + (m.issuedValue ?? 0), 0)
  const materialOrdered = materials.reduce((s, m) => s + (m.orderedValue ?? 0), 0)
  const total = contract + dcApproved + materialUsed

  const rows: { label: string; main: string; detail: string }[] = [
    { label: MONEY.contract, main: baht(contract), detail: `${MONEY.paid} ${baht(paid)} · ${MONEY.left} ${baht(Math.max(0, contract - paid))}` },
    { label: MONEY.dc, main: baht(dcApproved), detail: dcPending > 0 ? `รออนุมัติอีก ${baht(dcPending)}` : 'อนุมัติแล้วทั้งหมด' },
    { label: MONEY.material, main: baht(materialUsed), detail: `เบิกจากสโตร์เข้าแปลงนี้ · สั่งซื้อแล้ว ${baht(materialOrdered)}` },
  ]
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-slate-100">
                <td className="w-[28%] px-4 py-3 font-medium text-slate-800">{r.label}</td>
                <td className="w-[24%] px-4 py-3 text-right text-base font-bold tabular-nums text-slate-900">{r.main}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{r.detail}</td>
              </tr>
            ))}
            <tr className="bg-slate-50">
              <td className="px-4 py-3 font-semibold text-slate-900">รวมต้นทุนแปลงนี้</td>
              <td className="px-4 py-3 text-right text-base font-bold tabular-nums text-indigo-700">{baht(total)}</td>
              <td className="px-4 py-3 text-xs text-slate-500">ค่าแรงตามสัญญา + งานเพิ่ม (DC) ที่อนุมัติ + วัสดุที่ใช้</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">ยังไม่รวมค่าใช้จ่ายอื่น (เช่น ค่าเช่ารถเครน ค่าขนส่ง) และค่าเครื่องจักร เพราะระบบยังไม่มีการบันทึกส่วนนี้</p>
    </div>
  )
}
