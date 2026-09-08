import { NextRequest, NextResponse } from 'next/server'
import { getPurchaseRequestById } from '@/actions/procurement-actions'
import { getSignatureSlots } from '@/actions/signature-slots-actions'
import { buildPurchaseRequestHtml } from '@/lib/pdf/purchaseRequestHtml'
import { renderPrintable } from '@/lib/pdf/renderPrintable'

// See app/api/procurement/orders/[id]/pdf/route.ts - same Puppeteer/Node
// runtime requirement and per-request browser lifecycle.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [purchaseRequest, slots] = await Promise.all([getPurchaseRequestById(id), getSignatureSlots('purchase_request')])

  if (!purchaseRequest) {
    return NextResponse.json({ error: 'Purchase request not found' }, { status: 404 })
  }

  const html = buildPurchaseRequestHtml(purchaseRequest, slots)
  const format = request.nextUrl.searchParams.get('format') === 'png' ? 'png' : 'pdf'
  const download = request.nextUrl.searchParams.get('download') === '1'
  const filename = `PR-${String(purchaseRequest.pr_no).padStart(4, '0')}`

  const buffer = await renderPrintable(html, format)

  if (format === 'png') {
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}.png"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
