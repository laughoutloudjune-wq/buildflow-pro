import fs from 'fs'
import path from 'path'
import type { PaymentMethod, PaymentVoucher } from '@/lib/types/procurement'

// Same font-embedding approach as purchaseOrderHtml.ts/purchaseRequestHtml.ts
// - Puppeteer's headless page has no guaranteed access to /fonts/, so the
// Thai font is inlined as a data URI rather than linked.
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

function thaiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Same palette as the PO/PR documents so a printed PP reads as the same
// family of paper trail.
const c = {
  bg: '#ffffff',
  text: '#1d1d1f',
  muted: '#595959',
  accent: '#1d1d1f',
  cardBorder: '#f0f0f2',
  divider: '#e8e8ed',
}

function kv(label: string, value: string, opts: { strong?: boolean } = {}): string {
  if (!value) return ''
  return `<div class="kv"><span class="muted">${label}</span><span class="${opts.strong ? 'strong' : ''}">${value}</span></div>`
}


const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'เงินสด',
  bank_transfer: 'เงินโอน',
  director_loan: 'เงินกู้ยืมกรรมการ',
}

export function buildPaymentVoucherHtml(voucher: PaymentVoucher): string {
  if (!cachedRegular) cachedRegular = fontBase64('Sarabun-Regular.ttf')
  if (!cachedBold) cachedBold = fontBase64('Sarabun-Bold.ttf')

  const lines = voucher.payment_voucher_receipts || []
  const rows = lines
    .map(
      (line, index) => `
        <tr>
          <td class="idx">${index + 1}</td>
          <td>${esc(line.goods_receipts?.ri_no) || '-'}</td>
          <td>${esc(line.goods_receipts?.purchase_orders?.po_no) || '-'}</td>
          <td class="right muted">${money(Number(line.subtotal) || 0)}</td>
          <td class="right muted">${money(Number(line.vat_amount) || 0)}</td>
          <td class="right bold">${money(Number(line.amount) || 0)}</td>
        </tr>`
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 0; }
  @font-face { font-family: 'Sarabun'; src: url(data:font/ttf;base64,${cachedRegular}) format('truetype'); font-weight: 400; }
  @font-face { font-family: 'Sarabun'; src: url(data:font/ttf;base64,${cachedBold}) format('truetype'); font-weight: 700; }
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

  .divider { height: 1px; background: ${c.divider}; margin: 11px 0; }

  .card-row { display: flex; gap: 10px; margin-bottom: 10px; align-items: stretch; }
  .card { flex: 1; min-width: 0; background: #fff; border-radius: 12px; border: 1px solid ${c.cardBorder}; padding: 10px 12px; }
  .card-label { font-size: 9px; font-weight: 700; color: ${c.accent}; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 7px; }
  .kv { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; margin-bottom: 4px; line-height: 1.4; }
  .kv span:last-child { text-align: right; }
  .muted { color: ${c.muted}; }
  .strong { font-weight: 700; }

  table { width: 100%; border-collapse: collapse; }
  .table-card { background: #fff; border-radius: 12px; border: 1px solid ${c.cardBorder}; overflow: hidden; margin-bottom: 10px; }
  th { text-align: left; padding: 7px 10px; font-size: 8px; font-weight: 700; color: ${c.muted}; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1.5px solid ${c.divider}; }
  th.right, td.right { text-align: right; }
  td { padding: 7px 10px; font-size: 10px; border-top: 1px solid ${c.cardBorder}; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .idx { color: ${c.muted}; width: 26px; }
  .unit { color: ${c.muted}; font-size: 9.5px; width: 46px; }
  .item-name { font-size: 10px; }
  .bold { font-weight: 700; }
  .nowrap { white-space: nowrap; }

  .totals-row { display: flex; justify-content: flex-end; margin-bottom: 10px; }
  .totals-card { min-width: 260px; background: #fff; border-radius: 12px; border: 1px solid ${c.cardBorder}; padding: 10px 14px; }
  .totals-final { display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; }

  .notes { margin-bottom: 10px; }
  .notes-text { font-size: 9.5px; color: ${c.muted}; line-height: 1.5; white-space: pre-wrap; }

  .signature-row { display: flex; flex-wrap: wrap; justify-content: center; column-gap: 28px; row-gap: 16px; margin-top: 18px; page-break-inside: avoid; }
  .signature-box { flex: 0 0 165px; text-align: center; }
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
      <div>
        <div class="project-name">${esc(voucher.companies?.name) || '-'}</div>
        <div class="project-sub">${esc(voucher.companies?.address) || ''}</div>
      </div>
      <div>
        <div class="title">Payment Voucher</div>
        <div class="title-th">ใบสำคัญจ่าย</div>
        <div class="doc-info">
          <div class="doc-row"><span class="doc-label">เลขที่</span><span class="doc-value">${esc(voucher.pp_no)}</span></div>
          <div class="doc-row"><span class="doc-label">วันที่จ่าย</span><span class="doc-value">${thaiDate(voucher.payment_date)}</span></div>
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="card-row">
      <div class="card">
        <div class="card-label">จ่ายให้</div>
        ${kv('ผู้จำหน่าย', esc(voucher.suppliers?.name) || '-', { strong: true })}
        ${kv('เลขประจำตัวผู้เสียภาษี', esc(voucher.suppliers?.tax_id) || '')}
        ${kv('วิธีจ่าย', METHOD_LABEL[voucher.payment_method] || esc(voucher.payment_method))}
      </div>
    </div>

    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th class="idx">ลำดับ</th>
            <th>ใบรับสินค้า</th>
            <th>ใบสั่งซื้อ</th>
            <th class="right">ก่อน VAT</th>
            <th class="right">VAT</th>
            <th class="right">รวม</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="totals-row">
      <div class="totals-card">
        ${kv('รวมก่อน VAT', money(Number(voucher.subtotal) || 0))}
        ${kv('VAT', money(Number(voucher.vat_amount) || 0))}
        <div class="totals-final"><span>ยอดจ่ายสุทธิ</span><span>฿${money(Number(voucher.total_amount) || 0)}</span></div>
      </div>
    </div>

    ${voucher.note ? `<div class="card notes"><div class="card-label">หมายเหตุ</div><div class="notes-text">${esc(voucher.note)}</div></div>` : ''}

    <div class="signature-row">
      <div class="signature-box">
        <div class="signature-spacer"></div>
        <div class="signature-line"></div>
        <div class="signature-label">ผู้จ่ายเงิน</div>
        <div class="signature-name">&nbsp;</div>
        <div class="signature-date">วันที่ ${thaiDate(voucher.payment_date)}</div>
      </div>
      <div class="signature-box">
        <div class="signature-spacer"></div>
        <div class="signature-line"></div>
        <div class="signature-label">ผู้รับเงิน</div>
        <div class="signature-name">&nbsp;</div>
        <div class="signature-date">วันที่ ................................</div>
      </div>
    </div>
  </div>
</body>
</html>`
}
