import { formatCurrency } from '@/lib/currency'
import { statusColorClasses } from '@/lib/sales/statusColors'
import type { PlotSaleDetail } from '@/actions/sales-actions'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** The few facts people open a plot to find, before any tab: deal status,
 * who it is sold to, price, construction progress, target date and size. */
export default function PlotKeyFacts({
  saleDetail,
  jobsDone,
  jobsTotal,
  targetCompletionDate,
  landAreaSqwa,
}: {
  saleDetail: PlotSaleDetail
  jobsDone: number
  jobsTotal: number
  targetCompletionDate: string | null
  landAreaSqwa: number | null
}) {
  const sale = saleDetail.sale
  const c = statusColorClasses(sale?.statusColor)
  const percent = jobsTotal > 0 ? Math.round((jobsDone / jobsTotal) * 100) : 0
  const price =
    sale?.salePrice != null
      ? { label: 'ราคาขาย', value: `฿${formatCurrency(sale.salePrice)}` }
      : sale?.listPrice != null
        ? { label: 'ราคาตั้ง', value: `฿${formatCurrency(sale.listPrice)}` }
        : { label: 'ราคา', value: 'ยังไม่ระบุ' }

  return (
    <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-6">
      <div>
        <dt className="text-xs text-slate-500">สถานะการขาย</dt>
        <dd className="mt-1">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${c.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
            {sale?.statusLabel || 'ว่าง'}
          </span>
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-slate-500">ลูกค้า</dt>
        <dd className="mt-1 truncate text-sm font-medium text-slate-800" title={saleDetail.customer?.fullName || undefined}>
          {saleDetail.customer?.fullName || 'ยังไม่มีลูกค้า'}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">{price.label}</dt>
        <dd className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{price.value}</dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">ก่อสร้าง</dt>
        <dd className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
          {jobsTotal > 0 ? `${jobsDone}/${jobsTotal} งาน · ${percent}%` : 'ยังไม่มีงาน'}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">กำหนดแล้วเสร็จ</dt>
        <dd className="mt-1 text-sm font-medium text-slate-800">{targetCompletionDate ? formatDate(targetCompletionDate) : 'ยังไม่กำหนด'}</dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">เนื้อที่</dt>
        <dd className="mt-1 text-sm font-medium text-slate-800">{landAreaSqwa != null ? `${landAreaSqwa} ตร.ว.` : '—'}</dd>
      </div>
    </dl>
  )
}
