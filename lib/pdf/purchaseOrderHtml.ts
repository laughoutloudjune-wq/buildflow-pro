import fs from 'fs'
import path from 'path'
import { bahtText } from '@/lib/bahtText'
import type { PurchaseOrder } from '@/lib/types/procurement'

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

function money(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Quantities are numeric(…) in Postgres, so whole numbers arrive as 10 and
// fractional ones as 10.5 - trim the pointless trailing zeros either way.
function qty(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 })
}

function thaiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Palette matches the approved "Modern Apple-style PO form" reference.
const c = {
  bg: '#fbfbfd',
  text: '#1d1d1f',
  muted: '#86868b',
  accent: '#0071e3',
  cardBorder: '#f0f0f2',
  divider: '#e8e8ed',
  tableHead: '#f5f5f7',
}

// Only statuses that change how the document should be read get a stamp.
// A 'sent' PO is the normal case and prints clean.
const STATUS_STAMP: Partial<Record<PurchaseOrder['status'], { label: string; color: string }>> = {
  draft: { label: 'ฉบับร่าง / DRAFT', color: '#86868b' },
  cancelled: { label: 'ยกเลิก / CANCELLED', color: '#dc2626' },
  received: { label: 'รับของแล้ว', color: '#059669' },
  partially_received: { label: 'รับของบางส่วน', color: '#d97706' },
  paid: { label: 'ชำระแล้ว', color: '#7c3aed' },
}

function kv(label: string, value: string, opts: { strong?: boolean } = {}): string {
  if (!value) return ''
  return `<div class="kv"><span class="muted">${label}</span><span class="${opts.strong ? 'strong' : ''}">${value}</span></div>`
}

/**
 * @param fallbackSignatureUrl organization-level signature, used only when the
 *   buying company has no signature of its own.
 */
export function buildPurchaseOrderHtml(order: PurchaseOrder, fallbackSignatureUrl?: string | null): string {
  if (!cachedRegular) cachedRegular = fontBase64('Sarabun-Regular.ttf')
  if (!cachedBold) cachedBold = fontBase64('Sarabun-Bold.ttf')

  const items = order.purchase_order_items || []

  const itemRows = items
    .map((item, index) => {
      const gross = item.unit_price * item.quantity_ordered
      const net = gross - (item.discount_amount || 0)
      const discountNote =
        item.discount_amount > 0
          ? `<div class="item-discount">ส่วนลด ${
              item.discount_type === 'percent' ? `${item.discount_value}%` : ''
            } -${money(item.discount_amount)}</div>`
          : ''
      return `
        <tr>
          <td class="idx">${index + 1}</td>
          <td>
            <div class="item-name">${esc(item.material_types?.name) || '-'}</div>
            ${item.description ? `<div class="item-desc">${esc(item.description)}</div>` : ''}
            ${discountNote}
          </td>
          <td class="right nowrap">${qty(item.quantity_ordered)}</td>
          <td class="unit">${esc(item.material_types?.unit) || '-'}</td>
          <td class="right muted">${money(item.unit_price)}</td>
          <td class="right bold">${money(net)}</td>
        </tr>`
    })
    .join('')

  const logoBlock = order.companies?.logo_url
    ? `<img src="${esc(order.companies.logo_url)}" class="logo-img" />`
    : `<div class="logo-box">Logo</div>`

  const vatLine =
    order.vat_percent > 0
      ? `${order.vat_percent}% (${order.vat_type === 'inclusive' ? 'รวมภาษี' : 'แยกภาษี'})`
      : 'ไม่มี VAT'

  // Show the rate the discount was entered as, not just the resulting money -
  // "ส่วนลด 5%" is checkable by the supplier, a bare number is not.
  const discountLabel =
    order.discount_type === 'percent' ? `ส่วนลด ${order.discount_value}%` : 'ส่วนลด'
  const discountRow =
    order.discount_amount > 0
      ? `<div class="kv"><span class="muted">${discountLabel}</span><span class="discount">-${money(order.discount_amount)}</span></div>`
      : ''

  const noteBlock = order.note
    ? `<div class="card notes"><div class="card-label">หมายเหตุ / เงื่อนไข</div><div class="notes-text">${esc(order.note)}</div></div>`
    : ''

  // The signing entity is the company the PO is issued in the name of, so its
  // own signature wins; the organization-level one is only a fallback for
  // companies that haven't had one uploaded yet.
  const signatureUrl = order.companies?.signature_url || fallbackSignatureUrl
  const signatureImg = signatureUrl ? `<img src="${esc(signatureUrl)}" class="signature-img" />` : ''

  const stamp = STATUS_STAMP[order.status]
  const stampBlock = stamp
    ? `<div class="stamp" style="color:${stamp.color};border-color:${stamp.color}">${stamp.label}</div>`
    : ''

  const supplier = order.suppliers
  const company = order.companies

  // สำนักงานใหญ่ is the correct designation when no branch code is recorded.
  const supplierBranch = supplier?.branch_code ? `สาขา ${esc(supplier.branch_code)}` : 'สำนักงานใหญ่'

  const deliveryAddress = order.delivery_address || order.projects?.location || ''

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 0; }
  @font-face {
    font-family: 'Sarabun';
    src: url(data:font/ttf;base64,${cachedRegular}) format('truetype');
    font-weight: 400;
  }
  @font-face {
    font-family: 'Sarabun';
    src: url(data:font/ttf;base64,${cachedBold}) format('truetype');
    font-weight: 700;
  }
  * { box-sizing: border-box; }
  html, body { width: 100%; }
  /* Sizes below are in CSS px against A4's 794px print width (96px/inch),
     which is the width Chromium lays this out at for both page.pdf() and the
     PNG screenshot. 10px here is ~7.5pt on paper. Keep that reference in mind
     when adjusting: this document is typeset for paper, not for a screen. */
  body {
    margin: 0;
    font-family: 'Sarabun', -apple-system, sans-serif;
    font-size: 10px;
    color: ${c.text};
    background: ${c.bg};
  }
  .page { padding: 0.42in 0.45in; }

  /* Header
     The right column (title + number/date pills + any status stamp) is
     always taller than the company block, so centre the two against each
     other - pinning both to the top left a dead gap under the logo. */
  .header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .company-block { display: flex; gap: 12px; align-items: center; }
  .logo-img { width: 62px; height: 62px; border-radius: 14px; object-fit: contain; flex-shrink: 0; background: #fff; }
  .logo-box {
    width: 62px; height: 62px; border-radius: 14px; border: 1px solid ${c.cardBorder};
    background: #fff; display: flex; align-items: center; justify-content: center;
    font-size: 8px; color: ${c.muted}; flex-shrink: 0;
  }
  .company-name { font-size: 14.5px; font-weight: 700; line-height: 1.3; }
  .company-sub { font-size: 9px; color: ${c.muted}; margin-top: 1px; line-height: 1.4; }
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

  /* Cards */
  .card-row { display: flex; gap: 10px; margin-bottom: 10px; align-items: stretch; }
  .card {
    flex: 1; min-width: 0; background: #fff; border-radius: 12px; border: 1px solid ${c.cardBorder};
    padding: 10px 12px;
  }
  .card-label {
    font-size: 8px; font-weight: 700; color: ${c.accent}; text-transform: uppercase;
    letter-spacing: 0.06em; margin-bottom: 7px;
  }
  .card-line { font-size: 10px; margin-bottom: 3px; line-height: 1.45; }
  .card-line.name { font-weight: 700; font-size: 11px; }
  .card-line.muted { font-size: 9px; color: ${c.muted}; }
  .kv { display: flex; justify-content: space-between; gap: 10px; font-size: 9.5px; margin-bottom: 4px; line-height: 1.4; }
  .kv span:last-child { text-align: right; }
  .muted { color: ${c.muted}; }
  .strong { font-weight: 700; }

  /* Delivery strip - deliberately full width and high contrast; a wrong
     delivery address is the most expensive mistake on this document. */
  .delivery {
    background: #fff; border: 1px solid ${c.cardBorder}; border-left: 2.5px solid ${c.accent};
    border-radius: 9px; padding: 8px 12px; margin-bottom: 10px;
    display: flex; gap: 18px; align-items: baseline;
  }
  .delivery-label {
    font-size: 8px; font-weight: 700; color: ${c.accent}; text-transform: uppercase;
    letter-spacing: 0.06em; white-space: nowrap;
  }
  .delivery-text { font-size: 10px; flex: 1; line-height: 1.45; }
  .delivery-date { font-size: 9.5px; white-space: nowrap; }

  /* Items table */
  table { width: 100%; border-collapse: collapse; }
  .table-card { background: #fff; border-radius: 12px; border: 1px solid ${c.cardBorder}; overflow: hidden; margin-bottom: 10px; }
  thead tr { background: ${c.tableHead}; }
  th {
    text-align: left; padding: 7px 10px; font-size: 8px; font-weight: 700; color: ${c.muted};
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  th.right, td.right { text-align: right; }
  td { padding: 7px 10px; font-size: 10px; border-top: 1px solid ${c.cardBorder}; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .idx { color: ${c.muted}; width: 26px; }
  .unit { color: ${c.muted}; font-size: 9.5px; width: 46px; }
  .item-name { font-size: 10px; }
  .item-desc { font-size: 8.5px; color: ${c.muted}; margin-top: 1px; line-height: 1.4; }
  .item-discount { font-size: 8.5px; color: #dc2626; margin-top: 1px; }
  .nowrap { white-space: nowrap; }
  .bold { font-weight: 700; }
  .discount { color: #dc2626; }

  /* Totals + amount in words share a row so the spelled-out figure sits
     directly beside the numeric one it certifies. */
  .bottom-row { display: flex; gap: 10px; align-items: stretch; margin-bottom: 10px; }
  .words-card {
    flex: 1; background: #fff; border-radius: 12px; border: 1px solid ${c.cardBorder};
    padding: 10px 12px; display: flex; flex-direction: column; justify-content: center;
  }
  .words-text { font-size: 10.5px; font-weight: 700; line-height: 1.5; }
  .totals-card { width: 196px; flex-shrink: 0; background: #fff; border-radius: 12px; border: 1px solid ${c.cardBorder}; padding: 10px 12px; }
  .totals-divider { height: 1px; background: ${c.divider}; margin: 5px 0; }
  .totals-final { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; }

  .notes { margin-bottom: 10px; }
  .notes-text { font-size: 9.5px; color: ${c.muted}; line-height: 1.5; white-space: pre-wrap; }

  /* Signatures */
  .signature-row { display: flex; justify-content: space-between; gap: 16px; margin-top: 18px; page-break-inside: avoid; }
  .signature-box { flex: 1; text-align: center; }
  /* Height must match .signature-spacer exactly or the signed column sits
     lower than the blank ones and the three rules stop aligning. */
  .signature-img { height: 48px; object-fit: contain; object-position: bottom; margin-bottom: 3px; }
  .signature-spacer { height: 48px; margin-bottom: 3px; }
  .signature-line { height: 1px; background: #d2d2d7; margin-bottom: 5px; }
  .signature-label { font-size: 9.5px; font-weight: 700; }
  .signature-name { font-size: 8.5px; color: ${c.muted}; margin-top: 1px; min-height: 11px; }
  .signature-date { font-size: 8px; color: ${c.muted}; margin-top: 4px; }
</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="company-block">
        ${logoBlock}
        <div>
          <div class="company-name">${esc(company?.name) || '-'}</div>
          ${company?.address ? `<div class="company-sub">${esc(company.address)}</div>` : ''}
          <div class="company-sub">
            ${company?.tax_id ? `เลขประจำตัวผู้เสียภาษี: ${esc(company.tax_id)}` : ''}
            ${company?.phone ? `${company?.tax_id ? ' &nbsp;·&nbsp; ' : ''}โทร. ${esc(company.phone)}` : ''}
          </div>
        </div>
      </div>
      <div>
        <div class="title">Purchase Order</div>
        <div class="title-th">ใบสั่งซื้อ</div>
        <div class="doc-info">
          <div class="doc-row"><span class="doc-label">เลขที่</span><span class="doc-value">${esc(order.po_no)}</span></div>
          <div class="doc-row"><span class="doc-label">วันที่</span><span class="doc-value">${thaiDate(order.order_date)}</span></div>
        </div>
        ${stampBlock}
      </div>
    </div>

    <div class="divider"></div>

    <div class="card-row">
      <div class="card">
        <div class="card-label">ผู้จำหน่าย / Supplier</div>
        <div class="card-line name">${esc(supplier?.name) || '-'}</div>
        <div class="card-line muted">${esc(supplier?.address) || '-'}</div>
        <div class="card-line muted">เลขประจำตัวผู้เสียภาษี: ${esc(supplier?.tax_id) || '-'} &nbsp;·&nbsp; ${supplierBranch}</div>
        <div class="card-line muted">
          ผู้ติดต่อ: ${esc(supplier?.contact_name) || '-'}${supplier?.phone ? ` &nbsp;·&nbsp; โทร. ${esc(supplier.phone)}` : ''}
        </div>
      </div>
      <div class="card">
        <div class="card-label">รายละเอียดคำสั่งซื้อ</div>
        ${kv('โครงการ', esc(order.projects?.name) || '-')}
        ${kv('โครงการย่อย / แปลง', esc(order.plots?.name) || '-')}
        ${order.purchase_requests?.pr_no ? kv('อ้างอิงใบขอซื้อ', `PR-${order.purchase_requests.pr_no}`) : ''}
        ${kv('ผู้ขอซื้อ', esc(order.creator?.full_name) || '-')}
        ${kv('เงื่อนไขชำระเงิน', esc(order.payment_terms) || 'ไม่ระบุ', { strong: true })}
        ${kv('ภาษีมูลค่าเพิ่ม', vatLine)}
      </div>
    </div>

    ${
      deliveryAddress || order.expected_delivery_date
        ? `<div class="delivery">
             <span class="delivery-label">สถานที่ส่งของ</span>
             <span class="delivery-text">${esc(deliveryAddress) || '-'}</span>
             ${
               order.expected_delivery_date
                 ? `<span class="delivery-date"><span class="muted">กำหนดส่ง</span> <strong>${thaiDate(order.expected_delivery_date)}</strong></span>`
                 : ''
             }
           </div>`
        : ''
    }

    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th class="idx">ลำดับ</th>
            <th>รายการ</th>
            <th class="right">จำนวน</th>
            <th class="unit">หน่วย</th>
            <th class="right">ราคา/หน่วย</th>
            <th class="right">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>

    <div class="bottom-row">
      <div class="words-card">
        <div class="card-label">จำนวนเงินรวมทั้งสิ้น (ตัวอักษร)</div>
        <div class="words-text">${esc(bahtText(order.total_amount))}</div>
      </div>
      <div class="totals-card">
        <div class="kv"><span class="muted">รวมเป็นเงิน</span><span>${money(order.subtotal)}</span></div>
        ${discountRow}
        <div class="kv"><span class="muted">ภาษีมูลค่าเพิ่ม ${order.vat_percent > 0 ? `${order.vat_percent}%` : ''}</span><span>${money(order.vat_amount)}</span></div>
        <div class="totals-divider"></div>
        <div class="totals-final"><span>รวมทั้งสิ้น</span><span>฿${money(order.total_amount)}</span></div>
      </div>
    </div>

    ${noteBlock}

    <div class="signature-row">
      <div class="signature-box">
        <div class="signature-spacer"></div>
        <div class="signature-line"></div>
        <div class="signature-label">ผู้จัดทำ</div>
        <div class="signature-name">${esc(order.creator?.full_name) || ''}</div>
        <div class="signature-date">วันที่ ................................</div>
      </div>
      <div class="signature-box">
        ${signatureImg || '<div class="signature-spacer"></div>'}
        <div class="signature-line"></div>
        <div class="signature-label">ผู้อนุมัติ</div>
        <div class="signature-name"></div>
        <div class="signature-date">วันที่ ................................</div>
      </div>
      <div class="signature-box">
        <div class="signature-spacer"></div>
        <div class="signature-line"></div>
        <div class="signature-label">ผู้รับใบสั่งซื้อ</div>
        <div class="signature-name">ในนาม ${esc(supplier?.name) || ''}</div>
        <div class="signature-date">วันที่ ................................</div>
      </div>
    </div>
  </div>
</body>
</html>`
}
