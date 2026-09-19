import { Calendar, User } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import { statusColorClasses } from '@/lib/sales/statusColors'
import type { PlotSaleDetail } from '@/actions/sales-actions'
import type { PlotJobRow } from '@/lib/types/plotDetail'

const DATE_FIELDS: { key: keyof NonNullable<PlotSaleDetail['sale']>; label: string }[] = [
  { key: 'bookedAt', label: 'วันจอง' },
  { key: 'contractAt', label: 'วันทำสัญญา' },
  { key: 'loanSubmittedAt', label: 'ยื่นกู้' },
  { key: 'loanApprovedAt', label: 'อนุมัติสินเชื่อ' },
  { key: 'inspectionAt', label: 'นัดตรวจบ้าน' },
  { key: 'transferAt', label: 'วันโอน' },
  { key: 'deliveredAt', label: 'วันส่งมอบ' },
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function PlotOverviewTab({
  saleDetail,
  jobs,
  jobsDone,
  canSeeCost,
}: {
  saleDetail: PlotSaleDetail
  jobs: PlotJobRow[]
  jobsDone: number
  canSeeCost: boolean
}) {
  const sale = saleDetail.sale
  const c = statusColorClasses(sale?.statusColor)
  const setDates = DATE_FIELDS.filter((f) => sale?.[f.key])
  const progressPercent = jobs.length > 0 ? Math.round((jobsDone / jobs.length) * 100) : 0

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">สถานะการขาย</h3>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${c.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
            {sale?.statusLabel || 'ว่าง'}
          </span>
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <User className="h-4 w-4 text-slate-400" />
          {saleDetail.customer?.fullName || '— ยังไม่มีลูกค้า —'}
        </div>

        <div className="mt-3 text-2xl font-bold text-slate-800">
          {sale?.salePrice != null
            ? `฿${formatCurrency(sale.salePrice)}`
            : sale?.listPrice != null
              ? <span className="text-base font-medium text-slate-500">ราคาตั้ง ฿{formatCurrency(sale.listPrice)}</span>
              : <span className="text-base font-medium text-slate-400">ยังไม่ระบุราคา</span>}
        </div>
        {sale?.salesRepName && <div className="mt-1 text-xs text-slate-400">พนักงานขาย: {sale.salesRepName}</div>}

        {setDates.length > 0 && (
          <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3">
            {setDates.map((f) => (
              <div key={f.key} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-slate-500">
                  <Calendar className="h-3 w-3" /> {f.label}
                </span>
                <span className="font-medium text-slate-700">{formatDate(sale![f.key] as string)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700">ความคืบหน้าก่อสร้าง</h3>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-800">{jobsDone}/{jobs.length}</span>
          <span className="text-sm text-slate-500">งานเสร็จ</span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="mt-1 text-right text-xs text-slate-400">{progressPercent}%</div>
        {!canSeeCost && (
          <p className="mt-4 text-xs text-slate-400">ราคาต้นทุนก่อสร้างไม่แสดงในมุมมองนี้</p>
        )}
      </Card>
    </div>
  )
}
