import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { renderPrintable } from '@/lib/pdf/renderPrintable'

/**
 * Rendering a printable costs a full Chromium launch (~1s locally, several
 * seconds on Vercel where the packaged browser has to be unpacked first) plus
 * the screenshot itself. These documents change rarely, but the responses
 * used to be sent `no-store`, so re-opening the *same* preview paid that cost
 * again every single time.
 *
 * The fix is a conditional response. `buildPurchaseOrderHtml`/
 * `buildPurchaseRequestHtml` are pure functions of the data they're handed,
 * so hashing the HTML gives an ETag that changes exactly when the rendered
 * document would change - covering the record itself, org settings, and the
 * signature slots in one value, with no field-by-field cache key to keep in
 * sync. (`purchaseRequestHtml` folds in an "urgent" flag derived from the
 * current date; that flipping is a genuine change to the document, so it
 * correctly busts the ETag too.)
 *
 * On a revalidation that matches we return 304 *before* launching Chromium,
 * which is the entire point: the repeat view costs an auth check and a couple
 * of queries instead of a browser.
 *
 * `private` matters for correctness, not just speed - these are per-user
 * authorised documents and must never be held in Vercel's shared edge cache
 * or any intermediary proxy. `max-age=0, must-revalidate` keeps every view
 * correct: the browser always asks, it just gets a cheap answer. A non-zero
 * max-age would serve a stale preview to someone who just edited the record
 * and immediately re-opened it, which is a normal workflow here.
 */
// `format` is always exactly three characters ('pdf' or 'png'), so hashing
// it straight before the HTML is unambiguous - no separator needed.
export async function respondWithPrintable({
  request,
  html,
  format,
  download,
  filename,
}: {
  request: NextRequest
  html: string
  format: 'pdf' | 'png'
  download: boolean
  filename: string
}) {
  const etag = `"${createHash('sha1').update(format).update(html).digest('base64url')}"`

  const cacheHeaders = {
    ETag: etag,
    'Cache-Control': 'private, max-age=0, must-revalidate',
  }

  if (isFreshFor(request.headers.get('if-none-match'), etag)) {
    return new NextResponse(null, { status: 304, headers: cacheHeaders })
  }

  const buffer = await renderPrintable(html, format)
  const extension = format === 'png' ? 'png' : 'pdf'

  return new NextResponse(buffer, {
    headers: {
      ...cacheHeaders,
      'Content-Type': format === 'png' ? 'image/png' : 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}.${extension}"`,
    },
  })
}

/** `If-None-Match` is a comma-separated list and each entry may carry the
 * `W/` weak validator prefix; `*` matches anything that exists. Compare on
 * the opaque value so a weak validator still counts as a hit - these bodies
 * are byte-identical for a given ETag, so weak and strong mean the same
 * thing here. */
function isFreshFor(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false
  const normalize = (value: string) => value.trim().replace(/^W\//, '')
  return ifNoneMatch
    .split(',')
    .some((candidate) => candidate.trim() === '*' || normalize(candidate) === normalize(etag))
}
