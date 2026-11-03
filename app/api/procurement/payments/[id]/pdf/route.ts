import { NextRequest, NextResponse } from 'next/server'
import { getPaymentVoucherById } from '@/actions/procurement/payments'
import { buildPaymentVoucherHtml } from '@/lib/pdf/paymentVoucherHtml'
import { respondWithPrintable } from '@/lib/pdf/printableResponse'

// Same Puppeteer/Node runtime requirement and pooled browser as the PO / RI
// routes (see app/api/procurement/orders/[id]/pdf/route.ts).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const voucher = await getPaymentVoucherById(id)
  if (!voucher) {
    return NextResponse.json({ error: 'Payment voucher not found' }, { status: 404 })
  }

  return respondWithPrintable({
    request,
    html: buildPaymentVoucherHtml(voucher),
    format: request.nextUrl.searchParams.get('format') === 'png' ? 'png' : 'pdf',
    download: request.nextUrl.searchParams.get('download') === '1',
    filename: voucher.pp_no,
  })
}
