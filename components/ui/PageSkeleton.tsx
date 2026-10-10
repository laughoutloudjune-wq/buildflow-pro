import { Card } from '@/components/ui/Card'

type Variant = 'list' | 'detail' | 'dashboard'

const bar = 'rounded-md bg-slate-100'

/**
 * Page-shaped placeholder shown while a dashboard route loads, so content does
 * not jump when it arrives. `list` = filters + table, `detail` = summary cards
 * + sections, `dashboard` = KPI tiles + panels. The pulse is turned off under
 * prefers-reduced-motion (globals.css); the status text stays for screen readers.
 */
export default function PageSkeleton({
  variant = 'list',
  rows = 6,
  label = 'กำลังโหลด...',
}: {
  variant?: Variant
  rows?: number
  label?: string
}) {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">{label}</span>
      <div className="animate-pulse space-y-2" aria-hidden>
        <div className="h-7 w-56 max-w-full rounded-lg bg-slate-200" />
        <div className="h-4 w-80 max-w-full rounded-lg bg-slate-100" />
      </div>

      {variant === 'list' && (
        <>
          <Card className="animate-pulse p-4" aria-hidden>
            <div className="flex flex-wrap gap-3">
              <div className="h-10 w-44 rounded-[10px] bg-slate-100" />
              <div className="h-10 w-52 rounded-[10px] bg-slate-100" />
              <div className="h-10 w-60 rounded-[10px] bg-slate-100" />
            </div>
          </Card>
          <Card className="animate-pulse overflow-hidden" aria-hidden>
            <div className="h-11 border-b border-slate-100 bg-slate-50" />
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-slate-100 px-4 py-4 last:border-b-0">
                <div className={`h-4 w-1/4 ${bar}`} />
                <div className={`h-4 w-1/3 ${bar}`} />
                <div className={`ml-auto h-4 w-16 ${bar}`} />
              </div>
            ))}
          </Card>
        </>
      )}

      {variant === 'detail' && (
        <>
          <div className="grid animate-pulse gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="space-y-3 p-4">
                <div className={`h-3 w-20 ${bar}`} />
                <div className="h-6 w-28 rounded-md bg-slate-200" />
              </Card>
            ))}
          </div>
          <Card className="animate-pulse space-y-4 p-5" aria-hidden>
            <div className="h-5 w-40 rounded-md bg-slate-200" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <div className={`h-4 w-1/5 ${bar}`} />
                <div className={`h-4 w-1/2 ${bar}`} />
              </div>
            ))}
          </Card>
          <Card className="animate-pulse overflow-hidden" aria-hidden>
            <div className="h-11 border-b border-slate-100 bg-slate-50" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-slate-100 px-4 py-4 last:border-b-0">
                <div className={`h-4 w-1/3 ${bar}`} />
                <div className={`ml-auto h-4 w-20 ${bar}`} />
              </div>
            ))}
          </Card>
        </>
      )}

      {variant === 'dashboard' && (
        <>
          <div className="grid animate-pulse gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="min-h-[112px] space-y-3 p-4">
                <div className={`h-3 w-24 ${bar}`} />
                <div className="h-7 w-20 rounded-md bg-slate-200" />
                <div className={`h-3 w-32 ${bar}`} />
              </Card>
            ))}
          </div>
          <div className="grid animate-pulse gap-4 lg:grid-cols-2" aria-hidden>
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i} className="space-y-3 p-5">
                <div className="h-5 w-36 rounded-md bg-slate-200" />
                <div className="h-40 rounded-xl bg-slate-100" />
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
