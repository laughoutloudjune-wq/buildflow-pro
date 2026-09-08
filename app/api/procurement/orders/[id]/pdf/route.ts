import { NextRequest, NextResponse } from 'next/server'
import { getPurchaseOrderById } from '@/actions/procurement-actions'
import { getOrganizationSettings } from '@/actions/settings-actions'
import { getSignatureSlots } from '@/actions/signature-slots-actions'
import { buildPurchaseOrderHtml } from '@/lib/pdf/purchaseOrderHtml'
import { renderPrintable } from '@/lib/pdf/renderPrintable'

// Puppeteer needs to spawn a real Chromium process, so this must run on the
// Node runtime (not edge). A new browser is launched per request and closed
// after rendering - simple and safe for this feature's traffic (internal PO
// documents, not a hot path); a shared browser pool can be added later if
// generation volume ever justifies the extra complexity.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [order, settings, slots] = await Promise.all([
    getPurchaseOrderById(id),
    getOrganizationSettings(),
    getSignatureSlots('purchase_order'),
  ])

  if (!order) {
    return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
  }

  const html = buildPurchaseOrderHtml(order, settings?.signature_url, slots)
  const format = request.nextUrl.searchParams.get('format') === 'png' ? 'png' : 'pdf'
  const download = request.nextUrl.searchParams.get('download') === '1'

  const buffer = await renderPrintable(html, format)

  if (format === 'png') {
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${order.po_no}.png"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${order.po_no}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
