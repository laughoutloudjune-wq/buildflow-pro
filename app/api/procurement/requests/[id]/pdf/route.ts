import { NextRequest, NextResponse } from 'next/server'
import { getPurchaseRequestById } from '@/actions/procurement-actions'
import { getSignatureSlots } from '@/actions/signature-slots-actions'
import { buildPurchaseRequestHtml } from '@/lib/pdf/purchaseRequestHtml'
import { respondWithPrintable } from '@/lib/pdf/printableResponse'

// See app/api/procurement/orders/[id]/pdf/route.ts - same Puppeteer/Node
// runtime requirement, same pooled browser and same conditional-response
// handling.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [purchaseRequest, slots] = await Promise.all([getPurchaseRequestById(id), getSignatureSlots('purchase_request')])

  if (!purchaseRequest) {
    return NextResponse.json({ error: 'Purchase request not found' }, { status: 404 })
  }

  const html = buildPurchaseRequestHtml(purchaseRequest, slots)

  return respondWithPrintable({
    request,
    html,
    format: request.nextUrl.searchParams.get('format') === 'png' ? 'png' : 'pdf',
    download: request.nextUrl.searchParams.get('download') === '1',
    filename: `PR-${String(purchaseRequest.pr_no).padStart(4, '0')}`,
  })
}
