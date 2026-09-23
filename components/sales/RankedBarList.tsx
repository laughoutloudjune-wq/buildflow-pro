import { Card } from '@/components/ui/Card'

export type RankedBarItem = {
  key: string
  label: string
  /** Drives the bar's width, scaled against the list's own max. */
  metric: number
  /** Right-aligned text, e.g. "21/37" or "฿1,234,567". Falls back to `metric`. */
  secondary?: string
  /** Bar fill color - a Tailwind bg-* class. One fixed hue for a plain
   * magnitude ranking (the default); pass per-item only when the color
   * itself carries meaning (e.g. a status's own reserved color). */
  colorClass?: string
}

/** A single-hue horizontal bar ranking - project/house-model/sales-rep
 * leaderboards all share this shape (one measure, several named
 * categories), so one component instead of three near-identical tables. */
export default function RankedBarList({
  title,
  items,
  emptyLabel = 'ยังไม่มีข้อมูล',
  defaultColorClass = 'bg-indigo-500',
}: {
  title: string
  items: RankedBarItem[]
  emptyLabel?: string
  defaultColorClass?: string
}) {
  const max = Math.max(1, ...items.map((i) => i.metric))

  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-semibold text-slate-700">{title}</h3>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">{emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-slate-700">{item.label}</span>
                <span className="shrink-0 text-slate-500">{item.secondary ?? item.metric.toLocaleString('th-TH')}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${item.colorClass || defaultColorClass}`}
                  style={{ width: `${Math.max(2, (item.metric / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
