/**
 * One bar for "how much of the budget is gone": the solid part is what was
 * actually used (withdrawn), the lighter part is what is on order beyond that,
 * and the track is the budget (BOQ + allowance). Both parts are clipped to the
 * track; going over the budget turns the bar red and the percent says by how
 * much. Pure display - the status itself still comes from rowStatus().
 */
export default function UsageBar({
  used,
  ordered,
  ceiling,
  over,
  watch,
}: {
  used: number
  ordered: number
  ceiling: number
  over: boolean
  watch: boolean
}) {
  if (ceiling <= 0) return <span className="text-xs text-slate-400">-</span>
  const usedPct = Math.min((used / ceiling) * 100, 100)
  const orderedPct = Math.min(Math.max(((ordered - used) / ceiling) * 100, 0), 100 - usedPct)
  const tone = over ? 'bg-red-500' : watch ? 'bg-amber-500' : 'bg-emerald-500'
  const percent = Math.round((used / ceiling) * 100)
  return (
    <div
      className="flex items-center gap-2"
      title={`ใช้จริง ${used.toLocaleString('th-TH')} · ยอดสั่ง ${ordered.toLocaleString('th-TH')} · งบ ${ceiling.toLocaleString('th-TH')}`}
    >
      <div className="flex h-2 w-28 overflow-hidden rounded-full bg-slate-100">
        <div className={tone} style={{ width: `${usedPct}%` }} />
        <div className="bg-slate-300" style={{ width: `${orderedPct}%` }} />
      </div>
      <span className={`w-10 text-right text-xs font-medium ${over ? 'text-red-600' : 'text-slate-600'}`}>{percent}%</span>
    </div>
  )
}
