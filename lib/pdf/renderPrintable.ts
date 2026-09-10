import type { Browser } from 'puppeteer-core'

// A4 in CSS pixels at the 96px/inch that Chromium's print layout uses
// (8.27in x 11.69in). This must match the print width exactly: page.pdf()
// always re-lays the document out at the paper width regardless of viewport,
// so screenshotting at any other width silently produces different
// typography from the PDF - text that looks correct on paper but shrunken in
// the image. Resolution comes from deviceScaleFactor, never from a wider
// layout.
const A4_WIDTH_PX = 794
const A4_HEIGHT_PX = 1123

// 2x is ~192dpi - still comfortably sharp zoomed in and when pasted into a
// chat, which is what this image is for. It was 3x, but PNG encoding cost
// scales with pixel count and 3x was the single most expensive step of a
// preview: measured on an 18-row A4 document, 3x took 827ms and produced
// 399KB, versus 138ms and 254KB at 2x - 6x faster to encode and a third
// smaller, for a resolution the preview modal (max-w-3xl) can't display
// anyway. Raise it back only if the pasted image is genuinely too soft.
const PNG_SCALE = 2

// Footer only - the header template must stay empty or Chromium reserves
// vertical space at the top of every page and pushes the layout down.
const FOOTER_TEMPLATE = `
  <div style="width:100%;font-size:8px;color:#86868b;padding:0 0.55in 0.25in;
              font-family:sans-serif;display:flex;justify-content:flex-end;">
    <span>หน้า <span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`

// Vercel's serverless functions have no system Chrome, and the full
// `puppeteer` package's own bundled-Chrome download is a build-time cache
// path that doesn't ship with the deployed function - hitting this route in
// production threw "Could not find Chrome" even though it worked locally.
// @sparticuz/chromium is a Chromium build packaged specifically to fit and
// run inside that environment, driven through puppeteer-core (same Page API,
// no bundled browser of its own). Locally there's a real Chrome the full
// `puppeteer` package already manages, so dev keeps using that - simpler
// than making the serverless build of Chromium behave on Windows.
async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
    const [{ default: chromium }, { default: puppeteerCore }] = await Promise.all([
      import('@sparticuz/chromium'),
      import('puppeteer-core'),
    ])
    return puppeteerCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }
  // The full `puppeteer` package is puppeteer-core plus its own bundled
  // browser; its Browser/Page instances are the same shape, just typed
  // against a separately-versioned copy of the same lib - cast rather than
  // fight the two nominally-distinct-but-identical types.
  const { default: puppeteer } = await import('puppeteer')
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  return browser as unknown as Browser
}

// Launching Chromium is by far the most expensive part of rendering a
// document - ~1s on a dev machine, several seconds on Vercel where the
// packaged browser has to be unpacked before it can start. It used to be paid
// on every single request. A Vercel function stays warm for minutes after an
// invocation and module state survives in that window, so the browser is
// cached here and reused instead.
//
// Held on globalThis rather than a plain module variable so `next dev`'s HMR,
// which re-evaluates this module on edit, reattaches to the existing browser
// instead of orphaning a Chrome process on every save.
const browserCache = globalThis as typeof globalThis & {
  __printableBrowser?: Promise<Browser> | null
}

async function getBrowser(): Promise<Browser> {
  const cached = browserCache.__printableBrowser
  if (cached) {
    try {
      const browser = await cached
      if (browser.connected) return browser
    } catch {
      // The cached launch itself rejected - fall through and start a new one.
    }
  }

  const launched = launchBrowser()
  browserCache.__printableBrowser = launched

  // Self-heal: if this browser dies (Lambda froze it, OOM, crash) drop it from
  // the cache immediately rather than waiting for the next render to fail.
  void launched
    .then((browser) => {
      browser.once('disconnected', () => {
        if (browserCache.__printableBrowser === launched) {
          browserCache.__printableBrowser = null
        }
      })
    })
    .catch(() => {
      if (browserCache.__printableBrowser === launched) {
        browserCache.__printableBrowser = null
      }
    })

  return launched
}

/** Drop the pooled browser and do a best-effort close. Called only when a
 * render has already failed, where the overwhelmingly likely cause is that
 * the browser is dead anyway and `close()` is a no-op. This feature's traffic
 * is a handful of internal users, so a second render racing this close is
 * vanishingly unlikely - and if it ever happened, that render gets the same
 * one-shot retry below. */
async function discardBrowser() {
  const cached = browserCache.__printableBrowser
  browserCache.__printableBrowser = null
  if (!cached) return
  try {
    const browser = await cached
    await browser.close()
  } catch {
    // Already gone, which is the expected case here.
  }
}

/**
 * Renders a self-contained A4 HTML document (own @font-face, own @page rules
 * - see lib/pdf/purchaseOrderHtml.ts and purchaseRequestHtml.ts) to a PDF or
 * PNG buffer via a headless Chromium. Shared by every procurement print
 * route so the Vercel-vs-local browser launch and paper-sizing logic above
 * lives in exactly one place.
 *
 * The browser is pooled across requests (see `getBrowser`). The failure mode
 * that buys is a browser that looked alive but was broken by a freeze/thaw
 * cycle between invocations - so a failed render discards the pool and retries
 * exactly once on a freshly launched browser. That retry is what makes pooling
 * safe to ship: the worst case is one cold launch, which is precisely the old
 * per-request behaviour, and the best case skips it entirely.
 */
// Return type is inferred (not annotated `Buffer`/`Uint8Array`) - an
// explicit annotation here resolves against a `Buffer` global that doesn't
// structurally match Next's `BodyInit` the way the inferred type from
// Puppeteer's own return values does.
export async function renderPrintable(html: string, format: 'pdf' | 'png') {
  try {
    return await renderWith(await getBrowser(), html, format)
  } catch (error) {
    console.warn('[renderPrintable] render failed, relaunching browser and retrying once', error)
    await discardBrowser()
    return await renderWith(await getBrowser(), html, format)
  }
}

async function renderWith(browser: Browser, html: string, format: 'pdf' | 'png') {
  // Only the page is closed here, never the browser - closing the browser is
  // what this pooling exists to avoid.
  const page = await browser.newPage()

  try {
    // Without an explicit viewport, Chromium lays the page out against its
    // default 800x600 screen size before rendering, which can cramp or clip
    // flex/grid content - sizing this to A4's proportions at a high DPI keeps
    // the layout consistent between the PNG and the PDF, which matters
    // because both are generated from this same HTML.
    await page.setViewport({ width: A4_WIDTH_PX, height: A4_HEIGHT_PX, deviceScaleFactor: PNG_SCALE })
    await page.setContent(html, { waitUntil: 'load' })

    if (format === 'png') {
      // A single tall image rather than paginated pages: this is the copy
      // that gets pasted into a chat, where one continuous image reads
      // better than several page-sized ones.
      //
      // Round the capture height up to whole A4 sheets so the image always
      // has true paper proportions - a short document is exactly one A4, a
      // long one is exactly two, never a fraction.
      const contentHeight = await page.evaluate(() => {
        const el = document.querySelector('.page')
        return el ? Math.ceil(el.getBoundingClientRect().height) : document.body.scrollHeight
      })
      const sheets = Math.max(1, Math.ceil(contentHeight / A4_HEIGHT_PX))
      await page.setViewport({ width: A4_WIDTH_PX, height: A4_HEIGHT_PX * sheets, deviceScaleFactor: PNG_SCALE })
      const pngBuffer = await page.screenshot({ type: 'png' })
      return Buffer.from(pngBuffer)
    }

    const pdfBuffer = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: '0', bottom: '0.4in', left: '0', right: '0' },
    })
    return Buffer.from(pdfBuffer)
  } finally {
    // Must always run: a pooled browser outlives the request, so a page left
    // open here would accumulate for the life of the container and eventually
    // exhaust the function's memory.
    await page.close().catch(() => {})
  }
}
