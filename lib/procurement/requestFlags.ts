import { requestLineUnit } from '@/lib/procurement/requestQuantities'
import type { PurchaseRequest, PurchaseRequestItem } from '@/lib/types/procurement'

export type RequestLineFlag = 'substituted' | 'different' | 'open' | 'late' | 'closed'

export type RequestLineFlags = {
  item: PurchaseRequestItem
  substituted: boolean
  different: boolean
  late: boolean
  open: boolean
  closed: boolean
}

/** How one request line compares with what was ordered against it. Flags are
 * information for the PM: none of them blocks anything. Shared by the request
 * page comparison card and the request list's "needs attention" filter, so
 * both count the same lines. */
export function compareRequestLine(request: PurchaseRequest, item: PurchaseRequestItem, now: number): RequestLineFlags {
  const links = (item.fulfillment?.links || []).filter((l) => !l.cancelled)
  const unit = requestLineUnit(item)
  const asked = Number(item.quantity_requested) || 0
  const substituted = links.some((l) => l.isSubstitute)
  const different = links.some((l) => l.unit !== unit || Math.abs(l.allocated - asked) > 1e-9)
  const open = item.line_status === 'open'
  const late = open && !!request.needed_by_date && new Date(request.needed_by_date).getTime() < now
  return {
    item,
    substituted,
    different: links.length > 0 && different && !substituted,
    late,
    open,
    closed: item.line_status === 'closed',
  }
}

export function lineHasFlag(f: RequestLineFlags, flag: RequestLineFlag): boolean {
  return f[flag]
}

/** True when the PM has something to look at: an approved/ordered request they
 * have not marked reviewed, with a changed line or one that is overdue. */
export function requestNeedsAttention(request: PurchaseRequest, now: number): boolean {
  if (request.pm_reviewed_at) return false
  if (request.status !== 'approved' && request.status !== 'ordered' && request.status !== 'received') return false
  return (request.purchase_request_items || []).some((item) => {
    const f = compareRequestLine(request, item, now)
    return f.substituted || f.different || f.late
  })
}
