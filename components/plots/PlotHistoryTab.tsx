import { FileText, Tag } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { PlotHistoryRowView } from '@/lib/types/plotDetail'

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function PlotHistoryTab({ history }: { history: PlotHistoryRowView[] }) {
  if (history.length === 0) {
    return <Card className="p-8 text-center text-slate-400">ยังไม่มีประวัติสำหรับแปลงนี้</Card>
  }

  return (
    <Card className="p-5">
      <div className="space-y-4">
        {history.map((h) => (
          <div key={h.id} className="flex gap-3 border-l-2 border-slate-100 pl-4">
            <div className="mt-0.5 shrink-0 text-slate-400">
              {h.kind === 'sale_event' ? <Tag className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="font-medium text-slate-800">{h.label}</span>
                <span className="text-xs text-slate-400">{formatDateTime(h.happenedAt)}</span>
              </div>
              {h.detail && <p className="mt-0.5 text-sm text-slate-500">{h.detail}</p>}
              <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                {h.actorName && <span>โดย {h.actorName}</span>}
                {h.amount != null && <span className="font-medium text-slate-600">฿{formatCurrency(h.amount)}</span>}
              </div>
              {h.jobs && h.jobs.length > 0 && (
                <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 px-3 py-2">
                  {h.jobs.map((j, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 text-xs text-slate-600">
                      <span className="min-w-0 truncate">
                        {j.itemName} {j.unit && <span className="text-slate-400">({j.unit})</span>}
                      </span>
                      <span className="shrink-0 text-slate-400">
                        {j.quantityLabel}
                        {j.amount != null && <span className="ml-2 font-medium text-slate-600">฿{formatCurrency(j.amount)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
