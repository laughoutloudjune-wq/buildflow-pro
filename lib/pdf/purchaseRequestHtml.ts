import fs from 'fs'
import path from 'path'
import type { PurchaseRequest, PurchaseRequestStatus } from '@/lib/types/procurement'
import type { SignatureSlot } from '@/lib/types/signatures'
import { originalQuantityRequested } from '@/lib/procurement/requestQuantities'

// Fonts are embedded as base64 data URIs rather than linked - Puppeteer's
// headless page has no guarantee of network access to either a third-party
// CDN or this app's own /fonts/ URL (depends on where the API route runs
// relative to the public site), so a self-contained @font-face is the only
// approach that can never silently fall back to a font with no Thai glyphs.
let cachedRegular: string | null = null
let cachedBold: string | null = null

function fontBase64(filename: string): string {
  const filePath = path.join(process.cwd(), 'public', 'fonts', filename)
  return fs.readFileSync(filePath).toString('base64')
}

function esc(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Quantities are numeric(…) in Postgres, so whole numbers arrive as 10 and
// fractional ones as 10.5 - trim the pointless trailing zeros either way.
function qty(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 })
}

function thaiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Same rule as the on-screen approval page: the request can't be ordered
 * faster than its slowest-lead-time line among what's still outstanding
 * (a line already fully covered by an earlier PO settles at 0 and
 * shouldn't extend the "order by" date). Null when nothing outstanding has
 * a lead time set yet. */
function maxLeadTimeDays(request: PurchaseRequest): number | null {
  const values = (request.purchase_request_items || [])
    .filter((item) => item.quantity_requested > 0)
    .map((item) => item.material_types?.lead_time_days)
    .filter((v): v is number => v != null)
  return values.length > 0 ? Math.max(...values) : null
}

function orderByDate(request: PurchaseRequest): Date | null {
  const leadTime = maxLeadTimeDays(request)
  if (leadTime == null || !request.needed_by_date) return null
  return new Date(new Date(request.needed_by_date).getTime() - leadTime * DAY_MS)
}

// Palette matches the purchase order document for a consistent paper trail.
const c = {
  bg: '#ffffff',
  text: '#1d1d1f',
  muted: '#595959',
  accent: '#1d1d1f',
  cardBorder: '#f0f0f2',
  divider: '#e8e8ed',
  tableHead: '#ffffff',
}

const STATUS_STAMP: Partial<Record<PurchaseRequestStatus, { label: string; color: string }>> = {
  pending_review: { label: 'รอตรวจสอบ / PENDING', color: '#d97706' },
  approved: { label: 'อนุมัติแล้ว / APPROVED', color: '#059669' },
  rejected: { label: 'ปฏิเสธ / REJECTED', color: '#dc2626' },
  ordered: { label: 'สั่งซื้อแล้ว', color: '#7c3aed' },
  cancelled: { label: 'ยกเลิก / CANCELLED', color: '#86868b' },
}

function kv(label: string, value: string, opts: { strong?: boolean; danger?: boolean } = {}): string {
  if (!value) return ''
  const cls = opts.danger ? 'discount' : opts.strong ? 'strong' : ''
  return `<div class="kv"><span class="muted">${label}</span><span class="${cls}">${value}</span></div>`
}

/** Resolves what a signature box actually shows for one slot: a system slot
 * pulls a real name/date from the request itself; a custom slot (system_key
 * null) only ever shows its configured label - it's a blank line for a
 * physical signature, or a stored stamp image if the slot has one. */
function slotContent(request: PurchaseRequest, slot: SignatureSlot): { name: string; dateLine: string } {
  if (slot.system_key === 'requester') {
    const name = esc(request.requester?.full_name || request.requester?.email) || '-'
    return { name, dateLine: `วันที่ ${thaiDate(request.created_at)}` }
  }
  if (slot.system_key === 'reviewer') {
    const name = request.reviewed_by ? esc(request.reviewer?.full_name || request.reviewer?.email) || '-' : ''
    const dateLine = request.reviewed_at ? `วันที่ ${thaiDate(request.reviewed_at)}` : 'วันที่ ................................'
    return { name, dateLine }
  }
  return { name: '', dateLine: '' }
}

/** Mirrors buildPurchaseOrderHtml's visual system (same fonts, page rules,
 * card/table styling) so a printed PR and PO read as the same family of
 * document - just without pricing, since a request has none yet. Signature
 * boxes come from the document's configured slots (Settings > ลายเซ็นในเอกสาร)
 * rather than a fixed count - see slotContent for what each one shows. */
export function buildPurchaseRequestHtml(request: PurchaseRequest, slots: SignatureSlot[]): string {
  if (!cachedRegular) cachedRegular = fontBase64('Sarabun-Regular.ttf')
  if (!cachedBold) cachedBold = fontBase64('Sarabun-Bold.ttf')

  return documentShell(renderPage(request, slots))
}

/** Several requests on as few sheets as they'll fit on, for printing a batch
 * without spending a sheet of paper per request. Each request becomes a
 * condensed block that flows down the page and is only pushed to the next
 * sheet when it doesn't fit whole (`page-break-inside: avoid`), so a handful
 * of short requests share one sheet.
 *
 * A single request still gets the full-page document - a lone compact block
 * stranded on an otherwise empty sheet just looks like a broken printout. */
export function buildPurchaseRequestsHtml(requests: PurchaseRequest[], slots: SignatureSlot[]): string {
  if (!cachedRegular) cachedRegular = fontBase64('Sarabun-Regular.ttf')
  if (!cachedBold) cachedBold = fontBase64('Sarabun-Bold.ttf')

  if (requests.length === 1) return documentShell(renderPage(requests[0], slots))

  return compactShell(requests.map((request) => renderCompactBlock(request, slots)).join(''), requests.length)
}

function renderPage(request: PurchaseRequest, slots: SignatureSlot[]): string {
  const items = request.purchase_request_items || []

  const itemRows = items
    .map((item, index) => {
      const leadTime = item.material_types?.lead_time_days
      return `
        <tr>
          <td class="idx">${index + 1}</td>
          <td>
            <div class="item-name">${esc(item.material_types?.name) || '-'}</div>
            ${item.note ? `<div class="item-desc">${esc(item.note)}</div>` : ''}
          </td>
          <td class="right nowrap">${qty(originalQuantityRequested(item))}</td>
          <td class="unit">${esc(item.material_types?.unit) || '-'}</td>
          <td class="right muted nowrap">${leadTime != null ? `${leadTime} วัน` : '-'}</td>
        </tr>`
    })
    .join('')

  const noteBlock = request.note
    ? `<div class="card notes"><div class="card-label">หมายเหตุ</div><div class="notes-text">${esc(request.note)}</div></div>`
    : ''

  const stamp = STATUS_STAMP[request.status]
  const stampBlock = stamp
    ? `<div class="stamp" style="color:${stamp.color};border-color:${stamp.color}">${stamp.label}</div>`
    : ''

  // Same three mutually-exclusive plot-scope sources as the on-screen page
  // and the PO document, in the same precedence.
  const plotScopeLine = (() => {
    if (request.plots?.name) return `แปลง ${esc(request.plots.name)}`
    if (request.plot_groups?.name) return `กลุ่มแปลง ${esc(request.plot_groups.name)}`
    const names = (request.purchase_request_plots || []).map((p) => p.plots?.name).filter((n): n is string => !!n)
    if (names.length > 0) return `แปลง ${esc(names.join(', '))}`
    return ''
  })()

  const leadTime = maxLeadTimeDays(request)
  const byDate = orderByDate(request)
  const isUrgent = byDate ? byDate.getTime() <= Date.now() : false
  const orderByLine = byDate
    ? kv('ควรสั่งภายในวันที่', `${thaiDate(byDate.toISOString())}${isUrgent ? ' (เลยกำหนด)' : ''}`, { strong: true, danger: isUrgent })
    : leadTime != null
      ? kv('ระยะเวลาสั่งของสูงสุด', `${leadTime} วัน`)
      : ''

  const requesterName = esc(request.requester?.full_name || request.requester?.email) || '-'

  const signatureBoxes = slots
    .map((slot) => {
      const { name, dateLine } = slotContent(request, slot)
      const image = slot.signature_url ? `<img src="${esc(slot.signature_url)}" class="signature-img" />` : '<div class="signature-spacer"></div>'
      return `
        <div class="signature-box">
          ${image}
          <div class="signature-line"></div>
          <div class="signature-label">${esc(slot.label)}</div>
          <div class="signature-name">${name}</div>
          <div class="signature-date">${dateLine}</div>
        </div>`
    })
    .join('')

  return `
  <div class="page">
    <div class="header">
      <div>
        <div class="project-name">${esc(request.projects?.name) || '-'}</div>
        ${plotScopeLine ? `<div class="project-sub">${plotScopeLine}</div>` : ''}
      </div>
      <div>
        <div class="title">Purchase Request</div>
        <div class="title-th">ใบขอซื้อ</div>
        <div class="doc-info">
          <div class="doc-row"><span class="doc-label">เลขที่</span><span class="doc-value">PR-${String(request.pr_no).padStart(4, '0')}</span></div>
          <div class="doc-row"><span class="doc-label">วันที่</span><span class="doc-value">${thaiDate(request.created_at)}</span></div>
        </div>
        ${stampBlock}
      </div>
    </div>

    <div class="divider"></div>

    <div class="card-row">
      <div class="card">
        <div class="card-label">รายละเอียดคำขอซื้อ</div>
        ${kv('ผู้ขอซื้อ', requesterName)}
        ${kv('ต้องการภายในวันที่', request.needed_by_date ? thaiDate(request.needed_by_date) : 'ไม่ระบุ')}
        ${orderByLine}
      </div>
      ${
        request.review_note
          ? `<div class="card"><div class="card-label">เหตุผลที่ปฏิเสธ</div><div class="kv"><span>${esc(request.review_note)}</span></div></div>`
          : ''
      }
    </div>

    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th class="idx">ลำดับ</th>
            <th>รายการ</th>
            <th class="right">จำนวน</th>
            <th class="unit">หน่วย</th>
            <th class="right">เวลาที่ต้องสั่ง</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>

    ${noteBlock}

    <div class="signature-row">${signatureBoxes}</div>
  </div>`
}

/** One request condensed into a block that shares a sheet with others: the
 * same facts as the full-page document (who asked, for what, by when, who
 * signs) at roughly a fifth of the height. The full document's one-per-sheet
 * layout is what it is because it's a standalone form - a batch printout
 * isn't, so everything that only existed to fill an A4 (the tall stamp, the
 * full-height table card, the 48px signature boxes) collapses here. */
function renderCompactBlock(request: PurchaseRequest, slots: SignatureSlot[]): string {
  const items = request.purchase_request_items || []

  const itemRows = items
    .map((item, index) => {
      const leadTime = item.material_types?.lead_time_days
      return `
        <tr>
          <td class="idx">${index + 1}</td>
          <td>${esc(item.material_types?.name) || '-'}${item.note ? ` <span class="muted">(${esc(item.note)})</span>` : ''}</td>
          <td class="right nowrap">${qty(originalQuantityRequested(item))}</td>
          <td class="unit">${esc(item.material_types?.unit) || '-'}</td>
          <td class="right muted nowrap">${leadTime != null ? `${leadTime} วัน` : '-'}</td>
        </tr>`
    })
    .join('')

  const stamp = STATUS_STAMP[request.status]
  const stampPill = stamp
    ? `<span class="pill" style="color:${stamp.color};border-color:${stamp.color}">${stamp.label}</span>`
    : ''

  const plotScopeLine = (() => {
    if (request.plots?.name) return `แปลง ${esc(request.plots.name)}`
    if (request.plot_groups?.name) return `กลุ่มแปลง ${esc(request.plot_groups.name)}`
    const names = (request.purchase_request_plots || []).map((p) => p.plots?.name).filter((n): n is string => !!n)
    if (names.length > 0) return `แปลง ${esc(names.join(', '))}`
    return ''
  })()

  const byDate = orderByDate(request)
  const isUrgent = byDate ? byDate.getTime() <= Date.now() : false
  const orderByLine = byDate
    ? `<div${isUrgent ? ' class="discount"' : ''}>ควรสั่งภายใน ${thaiDate(byDate.toISOString())}${isUrgent ? ' (เลยกำหนด)' : ''}</div>`
    : ''

  const signatureBoxes = slots
    .map((slot) => {
      const { name, dateLine } = slotContent(request, slot)
      const image = slot.signature_url
        ? `<img src="${esc(slot.signature_url)}" class="sig-img" />`
        : '<div class="sig-spacer"></div>'
      return `
        <div class="sig">
          ${image}
          <div class="sig-line"></div>
          <div class="sig-label">${esc(slot.label)}</div>
          <div class="sig-name">${name || '&nbsp;'}</div>
          ${dateLine ? `<div class="sig-date">${dateLine}</div>` : ''}
        </div>`
    })
    .join('')

  return `
  <div class="pr-block">
    <div class="pr-head">
      <div>
        <span class="pr-no">PR-${String(request.pr_no).padStart(4, '0')}</span>
        ${stampPill}
        <div class="pr-project">${esc(request.projects?.name) || '-'}</div>
        ${plotScopeLine ? `<div class="pr-scope">${plotScopeLine}</div>` : ''}
      </div>
      <div class="pr-meta">
        <div>ผู้ขอซื้อ ${esc(request.requester?.full_name || request.requester?.email) || '-'}</div>
        <div>วันที่ ${thaiDate(request.created_at)}${request.needed_by_date ? ` · ต้องการภายใน ${thaiDate(request.needed_by_date)}` : ''}</div>
        ${orderByLine}
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th class="idx">ลำดับ</th>
          <th>รายการ</th>
          <th class="right">จำนวน</th>
          <th class="unit">หน่วย</th>
          <th class="right">เวลาที่ต้องสั่ง</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    ${request.note ? `<div class="pr-note">หมายเหตุ: ${esc(request.note)}</div>` : ''}
    ${request.review_note ? `<div class="pr-note discount">เหตุผลที่ปฏิเสธ: ${esc(request.review_note)}</div>` : ''}

    <div class="sig-row">${signatureBoxes}</div>
  </div>`
}

/** Page margins live in `@page` here, not in a wrapper's padding the way the
 * single-request document does it: this content flows across however many
 * sheets it needs, and only `@page` margins repeat on every one of them. */
function compactShell(blocksHtml: string, count: number): string {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 0.4in 0.45in 0.5in; }
  ${fontFaces()}
  * { box-sizing: border-box; }
  html, body { width: 100%; }
  body {
    margin: 0;
    font-family: 'Sarabun', -apple-system, sans-serif;
    font-size: 9.5px;
    color: ${c.text};
    background: ${c.bg};
    -webkit-text-stroke: 0.3px currentColor;
  }
  .muted { color: ${c.muted}; }
  .discount { color: #dc2626; }
  .right { text-align: right; }
  .nowrap { white-space: nowrap; }

  .doc-title {
    display: flex; justify-content: space-between; align-items: baseline;
    border-bottom: 1.5px solid ${c.text}; padding-bottom: 5px; margin-bottom: 9px;
  }
  .doc-title-main { font-size: 12.5px; font-weight: 700; }
  .doc-title-sub { font-size: 8.5px; color: ${c.muted}; }

  /* The one rule this whole layout exists for: a request is never split
     across two sheets, so the printer fits as many whole blocks per sheet as
     the tallest one allows. */
  .pr-block {
    border: 1px solid ${c.divider}; border-radius: 9px; padding: 8px 10px; margin-bottom: 8px;
    page-break-inside: avoid;
  }

  .pr-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 5px; }
  .pr-no { font-size: 11.5px; font-weight: 700; letter-spacing: -0.01em; }
  .pill {
    display: inline-block; border: 1px solid; border-radius: 20px; padding: 0 6px; margin-left: 5px;
    font-size: 7.5px; font-weight: 700; letter-spacing: 0.03em; vertical-align: 1.5px;
  }
  .pr-project { font-size: 10px; font-weight: 700; margin-top: 1px; }
  .pr-scope { font-size: 8.5px; color: ${c.muted}; margin-top: 1px; }
  .pr-meta { text-align: right; font-size: 8.5px; color: ${c.muted}; line-height: 1.5; white-space: nowrap; }

  table.items { width: 100%; border-collapse: collapse; }
  table.items th {
    text-align: left; padding: 3px 6px; font-size: 7.5px; font-weight: 700; color: ${c.muted};
    text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid ${c.divider};
  }
  table.items th.right, table.items td.right { text-align: right; }
  table.items td { padding: 3px 6px; font-size: 9px; border-top: 1px solid ${c.cardBorder}; vertical-align: top; }
  table.items tr { page-break-inside: avoid; }
  .idx { color: ${c.muted}; width: 26px; }
  .unit { color: ${c.muted}; font-size: 8.5px; width: 46px; }

  .pr-note { font-size: 8.5px; color: ${c.muted}; margin-top: 4px; line-height: 1.45; }

  .sig-row { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 14px; margin-top: 7px; }
  .sig { flex: 0 0 128px; text-align: center; }
  .sig-img { height: 22px; object-fit: contain; object-position: bottom; display: block; margin: 0 auto 1px; }
  .sig-spacer { height: 16px; }
  .sig-line { border-top: 1px dotted #b8b8bf; margin-bottom: 2px; }
  .sig-label { font-size: 8px; font-weight: 700; }
  .sig-name { font-size: 7.5px; color: ${c.muted}; }
  .sig-date { font-size: 7px; color: ${c.muted}; }
</style>
</head>
<body>
  <div class="doc-title">
    <span class="doc-title-main">ใบขอซื้อ / Purchase Requests</span>
    <span class="doc-title-sub">รวม ${count} ใบ · พิมพ์เมื่อ ${thaiDate(new Date().toISOString())}</span>
  </div>
  ${blocksHtml}
</body>
</html>`
}

function fontFaces(): string {
  return `@font-face {
    font-family: 'Sarabun';
    src: url(data:font/ttf;base64,${cachedRegular}) format('truetype');
    font-weight: 400;
  }
  @font-face {
    font-family: 'Sarabun';
    src: url(data:font/ttf;base64,${cachedBold}) format('truetype');
    font-weight: 700;
  }`
}

function documentShell(pagesHtml: string): string {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 0; }
  ${fontFaces()}
  * { box-sizing: border-box; }
  html, body { width: 100%; }
  body {
    margin: 0;
    font-family: 'Sarabun', -apple-system, sans-serif;
    font-size: 10px;
    color: ${c.text};
    background: ${c.bg};
    -webkit-text-stroke: 0.3px currentColor;
  }
  .page { padding: 0.42in 0.45in; display: flex; flex-direction: column; min-height: 1078px; }

  .header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .project-name { font-size: 14.5px; font-weight: 700; line-height: 1.3; }
  .project-sub { font-size: 9px; color: ${c.muted}; margin-top: 1px; line-height: 1.4; }
  .title { font-size: 19px; font-weight: 700; text-align: right; letter-spacing: -0.02em; line-height: 1.15; }
  .title-th { font-size: 10px; font-weight: 400; color: ${c.muted}; text-align: right; margin-top: 1px; }
  .doc-info { margin-top: 7px; display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
  .doc-row { display: flex; align-items: center; gap: 6px; }
  .doc-label { font-size: 8px; font-weight: 700; color: ${c.muted}; text-transform: uppercase; letter-spacing: 0.04em; }
  .doc-value {
    min-width: 92px; background: #fff; border: 1px solid ${c.cardBorder}; border-radius: 7px;
    padding: 3.5px 10px; font-size: 10px; text-align: right;
  }
  .stamp {
    margin-top: 7px; border: 1.5px solid; border-radius: 6px; padding: 3px 9px;
    font-size: 9.5px; font-weight: 700; letter-spacing: 0.04em; text-align: center;
  }

  .divider { height: 1px; background: ${c.divider}; margin: 11px 0; }

  .card-row { display: flex; gap: 10px; margin-bottom: 10px; align-items: stretch; }
  .card {
    flex: 1; min-width: 0; background: #fff; border-radius: 12px; border: 1px solid ${c.cardBorder};
    padding: 10px 12px;
  }
  .card-label {
    font-size: 9px; font-weight: 700; color: ${c.accent}; text-transform: uppercase;
    letter-spacing: 0.06em; margin-bottom: 7px;
  }
  .kv { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; margin-bottom: 4px; line-height: 1.4; }
  .kv span:last-child { text-align: right; }
  .muted { color: ${c.muted}; }
  .strong { font-weight: 700; }
  .discount { color: #dc2626; }

  table { width: 100%; border-collapse: collapse; }
  .table-card { background: #fff; border-radius: 12px; border: 1px solid ${c.cardBorder}; overflow: hidden; margin-bottom: 10px; flex: 1 1 auto; }
  thead tr { background: ${c.tableHead}; }
  th {
    text-align: left; padding: 7px 10px; font-size: 8px; font-weight: 700; color: ${c.muted};
    text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1.5px solid ${c.divider};
  }
  th.right, td.right { text-align: right; }
  td { padding: 7px 10px; font-size: 10px; border-top: 1px solid ${c.cardBorder}; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .idx { color: ${c.muted}; width: 26px; }
  .unit { color: ${c.muted}; font-size: 9.5px; width: 46px; }
  .item-name { font-size: 10px; }
  .item-desc { font-size: 8.5px; color: ${c.muted}; margin-top: 1px; line-height: 1.4; }
  .nowrap { white-space: nowrap; }

  .notes { margin-bottom: 10px; }
  .notes-text { font-size: 9.5px; color: ${c.muted}; line-height: 1.5; white-space: pre-wrap; }

  /* flex-wrap so a customized document with more than 2-3 signature slots
     drops to a second row instead of overflowing the page width. */
  .signature-row { display: flex; flex-wrap: wrap; justify-content: center; column-gap: 28px; row-gap: 16px; margin-top: 18px; page-break-inside: avoid; }
  .signature-box { flex: 0 0 165px; text-align: center; }
  .signature-img { height: 48px; object-fit: contain; object-position: bottom; margin-bottom: 3px; }
  .signature-spacer { height: 48px; margin-bottom: 3px; }
  .signature-line { height: 1px; background: #d2d2d7; margin-bottom: 5px; }
  .signature-label { font-size: 9.5px; font-weight: 700; }
  .signature-name { font-size: 8.5px; color: ${c.muted}; margin-top: 1px; min-height: 11px; }
  .signature-date { font-size: 8px; color: ${c.muted}; margin-top: 4px; }
</style>
</head>
<body>${pagesHtml}</body>
</html>`
}
