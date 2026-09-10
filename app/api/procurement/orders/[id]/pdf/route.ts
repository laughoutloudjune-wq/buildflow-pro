import { NextRequest, NextResponse } from 'next/server'
import { getPurchaseOrderById } from '@/actions/procurement-actions'
import { getOrganizationSettings } from '@/actions/settings-actions'
import { getSignatureSlots } from '@/actions/signature-slots-actions'
import { buildPurchaseOrderHtml } from '@/lib/pdf/purchaseOrderHtml'
import { respondWithPrintable } from '@/lib/pdf/printableResponse'

// Puppeteer needs to spawn a real Chromium process, so this must run on the
// Node runtime (not edge). Two layers keep that off the critical path: the
// browser is pooled across requests (lib/pdf/renderPrintable.ts), and a
// repeat view of an unchanged document is answered with a 304 before any
// rendering happens at all (lib/pdf/printableResponse.ts).
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

  return respondWithPrintable({
    request,
    html,
    format: request.nextUrl.searchParams.get('format') === 'png' ? 'png' : 'pdf',
    download: request.nextUrl.searchParams.get('download') === '1',
    filename: order.po_no,
  })
}
