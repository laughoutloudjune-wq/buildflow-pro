import { NextRequest, NextResponse } from 'next/server'
import { getGoodsReceiptById } from '@/actions/procurement-actions'
import { getBoqCheckForReceipts } from '@/actions/procurement/boq-control'
import { buildGoodsReceiptHtml } from '@/lib/pdf/goodsReceiptHtml'
import { respondWithPrintable } from '@/lib/pdf/printableResponse'

// See app/api/procurement/orders/[id]/pdf/route.ts - same Puppeteer/Node
// runtime requirement, same pooled browser and same conditional-response
// handling.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const receipt = await getGoodsReceiptById(id)
  if (!receipt) {
    return NextResponse.json({ error: 'Goods receipt not found' }, { status: 404 })
  }

  // Best-effort: a BOQ check failure (e.g. an outside-BOQ PO, or no plot
  // scope resolvable) must never block printing the receipt itself.
  const boqCheck = await getBoqCheckForReceipts([id]).catch(() => null)

  const html = buildGoodsReceiptHtml(receipt, boqCheck)

  return respondWithPrintable({
    request,
    html,
    format: request.nextUrl.searchParams.get('format') === 'png' ? 'png' : 'pdf',
    download: request.nextUrl.searchParams.get('download') === '1',
    filename: receipt.ri_no,
  })
}
