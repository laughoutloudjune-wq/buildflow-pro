import { NextRequest, NextResponse } from 'next/server'
import puppeteer from 'puppeteer'
import { getPurchaseOrderById } from '@/actions/procurement-actions'
import { getOrganizationSettings } from '@/actions/settings-actions'
import { buildPurchaseOrderHtml } from '@/lib/pdf/purchaseOrderHtml'

// Puppeteer needs to spawn a real Chromium process, so this must run on the
// Node runtime (not edge). A new browser is launched per request and closed
// in `finally` - simple and safe for this feature's traffic (internal PO
// documents, not a hot path); a shared browser pool can be added later if
// generation volume ever justifies the extra complexity.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A4 in CSS pixels at the 96px/inch that Chromium's print layout uses
// (8.27in x 11.69in). This must match the print width exactly: page.pdf()
// always re-lays the document out at the paper width regardless of viewport,
// so screenshotting at any other width silently produces different
// typography from the PDF - text that looks correct on paper but shrunken in
// the image. Resolution comes from deviceScaleFactor, never from a wider
// layout.
const A4_WIDTH_PX = 794
const A4_HEIGHT_PX = 1123

// 3x gives a ~288dpi image - sharp when zoomed, still a sane file size.
const PNG_SCALE = 3

// Footer only - the header template must stay empty or Chromium reserves
// vertical space at the top of every page and pushes the layout down.
const FOOTER_TEMPLATE = `
  <div style="width:100%;font-size:8px;color:#86868b;padding:0 0.55in 0.25in;
              font-family:sans-serif;display:flex;justify-content:flex-end;">
    <span>หน้า <span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [order, settings] = await Promise.all([getPurchaseOrderById(id), getOrganizationSettings()])

  if (!order) {
    return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
  }

  const html = buildPurchaseOrderHtml(order, settings?.signature_url)
  const format = request.nextUrl.searchParams.get('format') === 'png' ? 'png' : 'pdf'
  const download = request.nextUrl.searchParams.get('download') === '1'

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const page = await browser.newPage()
    // Without an explicit viewport, Chromium lays the page out against its
    // default 800x600 screen size before rendering, which can cramp or clip
    // flex/grid content - sizing this to A4's proportions at a high DPI keeps
    // the layout consistent between the PNG and the PDF, which matters
    // because both are generated from this same HTML.
    await page.setViewport({ width: A4_WIDTH_PX, height: A4_HEIGHT_PX, deviceScaleFactor: PNG_SCALE })
    await page.setContent(html, { waitUntil: 'load' })

    if (format === 'png') {
      // A single tall image rather than paginated pages: this is the copy
      // that gets pasted into a chat with the supplier, where one continuous
      // image reads better than several page-sized ones.
      //
      // Round the capture height up to whole A4 sheets so the image always
      // has true paper proportions - a supplier receiving this in a chat
      // should see a document, not a ragged screenshot. A short PO is
      // exactly one A4; a long one is exactly two, never a fraction.
      const contentHeight = await page.evaluate(() => {
        const el = document.querySelector('.page')
        return el ? Math.ceil(el.getBoundingClientRect().height) : document.body.scrollHeight
      })
      const sheets = Math.max(1, Math.ceil(contentHeight / A4_HEIGHT_PX))
      await page.setViewport({ width: A4_WIDTH_PX, height: A4_HEIGHT_PX * sheets, deviceScaleFactor: PNG_SCALE })
      const pngBuffer = await page.screenshot({ type: 'png' })
      return new NextResponse(Buffer.from(pngBuffer), {
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${order.po_no}.png"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const pdfBuffer = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: '0', bottom: '0.4in', left: '0', right: '0' },
    })

    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${order.po_no}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } finally {
    await browser.close()
  }
}
