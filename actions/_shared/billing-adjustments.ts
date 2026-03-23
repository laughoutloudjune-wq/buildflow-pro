import type { BillingActionSignature } from '@/lib/types/billing'

export function encodeAdjustmentDescription(
  description: string,
  plotName?: string | null,
  signature?: BillingActionSignature | null
) {
  const cleanDesc = (description || '').trim()
  const cleanPlot = (plotName || '').trim()
  const segments: string[] = []
  if (cleanPlot) segments.push(`[PLOT:${cleanPlot}]`)
  if (signature?.user_id) {
    const name = (signature.full_name || '').replace(/[|]/g, ' ').trim() || '-'
    const role = (signature.role || '').replace(/[|]/g, ' ').trim() || '-'
    const action = (signature.action || '').replace(/[|]/g, ' ').trim() || 'edit'
    const at = signature.at || new Date().toISOString()
    segments.push(`[SIG:${signature.user_id}|${name}|${role}|${at}|${action}]`)
  }
  segments.push(cleanDesc)
  return segments.join(' ').trim()
}

export function decodeAdjustmentDescription(rawDescription: string | null | undefined) {
  let rest = rawDescription || ''
  let plot_name = ''
  let signature: BillingActionSignature | null = null

  while (true) {
    const m = rest.match(/^\[(PLOT|SIG):([^\]]+)\]\s*(.*)$/)
    if (!m) break
    const kind = m[1]
    const payload = m[2]
    rest = m[3] || ''
    if (kind === 'PLOT') {
      plot_name = payload.trim()
    } else if (kind === 'SIG') {
      const [user_id = '', full_name = '', role = '', at = '', action = ''] = payload.split('|')
      signature = { user_id, full_name, role, at, action }
    }
  }

  return { description: rest, plot_name, signature }
}

type AdjustmentWithDescription = {
  description?: string | null
}

export function normalizeAdjustmentsWithPlot<T extends AdjustmentWithDescription>(
  adjustments: T[] | null | undefined
): Array<
  T & {
    description: string
    plot_name: string
    signature: BillingActionSignature | null
    raw_description: string
  }
> {
  return (adjustments || []).map((adj) => {
    const parsed = decodeAdjustmentDescription(adj.description)
    return {
      ...adj,
      description: parsed.description,
      plot_name: parsed.plot_name || '',
      signature: parsed.signature || null,
      raw_description: adj.description || '',
    }
  })
}
