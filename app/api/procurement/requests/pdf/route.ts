import { NextRequest, NextResponse } from 'next/server'
import { getPurchaseRequestsByIds } from '@/actions/procurement-actions'
import { getSignatureSlots } from '@/actions/signature-slots-actions'
import { buildPurchaseRequestsHtml } from '@/lib/pdf/purchaseRequestHtml'
import { respondWithPrintable } from '@/lib/pdf/printableResponse'

// Combined print for several purchase requests at once - see
// app/api/procurement/requests/[id]/pdf/route.ts for the single-request
// version this mirrors (same Puppeteer/Node runtime requirement, same pooled
// browser). One PDF that packs as many requests onto each sheet as will fit
// (buildPurchaseRequestsHtml), so printing a batch doesn't spend a sheet of
// paper per request.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const ids = (request.nextUrl.searchParams.get('ids') || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  if (ids.length === 0) {
    return NextResponse.json({ error: 'No purchase request ids given' }, { status: 400 })
  }

  const [purchaseRequests, slots] = await Promise.all([getPurchaseRequestsByIds(ids), getSignatureSlots('purchase_request')])

  if (purchaseRequests.length === 0) {
    return NextResponse.json({ error: 'Purchase requests not found' }, { status: 404 })
  }

  const html = buildPurchaseRequestsHtml(purchaseRequests, slots)

  const first = String(purchaseRequests[0].pr_no).padStart(4, '0')
  const last = String(purchaseRequests[purchaseRequests.length - 1].pr_no).padStart(4, '0')
  const filename = purchaseRequests.length === 1 ? `PR-${first}` : `PR-${first}-${last}`

  return respondWithPrintable({
    request,
    html,
    format: request.nextUrl.searchParams.get('format') === 'png' ? 'png' : 'pdf',
    download: request.nextUrl.searchParams.get('download') === '1',
    filename,
  })
}
