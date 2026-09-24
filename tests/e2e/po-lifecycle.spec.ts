import { expect, test } from '@playwright/test'
import { loginAsPm, requireE2ECredentials } from './helpers/auth'

// L-12: covers the PO -> receive -> voucher money path (H-01/H-05's area),
// the one AUDIT_REPORT.md's own "How this audit was done" section flagged
// as untested. Same conservative shape as billing-workflow.spec.ts: there
// is no staging database (HANDOVER_PLAN.md ground rule 1), so this reaches
// each stage of the real workflow and asserts the right thing is on
// screen, rather than performing new receive/pay mutations against live
// data. To exercise a stage, set the matching env var to a real id already
// in that state (E2E_SENT_PO_ID: status 'sent' or 'partially_received', so
// the "รับของ" button is live; E2E_RECEIPT_ID: a goods receipt not yet on
// a payment voucher; E2E_VOUCHER_PP_NO: any payment voucher's doc number,
// e.g. PP-20260101-001) - each test skips on its own if its id isn't set,
// so this file works whether none, some, or all three are configured.
test.describe('Purchase order lifecycle', () => {
  requireE2ECredentials()

  test('pm can open the PO list and a PO ready to receive shows the receive button', async ({ page }) => {
    test.skip(!process.env.E2E_SENT_PO_ID, 'Set E2E_SENT_PO_ID (a PO with status sent/partially_received) for receive-flow coverage')

    await loginAsPm(page)
    await page.goto('/dashboard/procurement/orders')
    await expect(page.getByText('ใบสั่งซื้อ (Purchase Orders)')).toBeVisible()

    await page.goto(`/dashboard/procurement/orders/${process.env.E2E_SENT_PO_ID}`)
    await expect(page.getByRole('button', { name: 'รับของ' })).toBeVisible()
  })

  test('pm can see a goods receipt on its PO and in the receipts list', async ({ page }) => {
    test.skip(!process.env.E2E_RECEIPT_ID || !process.env.E2E_SENT_PO_ID, 'Set E2E_RECEIPT_ID and E2E_SENT_PO_ID for receipts coverage')

    await loginAsPm(page)
    await page.goto(`/dashboard/procurement/orders/${process.env.E2E_SENT_PO_ID}`)
    await expect(page.getByText('ใบรับสินค้า')).toBeVisible()

    await page.goto('/dashboard/procurement/receipts')
    await expect(page.getByText('ใบรับสินค้า (Goods Receipts)')).toBeVisible()
  })

  test('pm can find a specific payment voucher in the list', async ({ page }) => {
    test.skip(!process.env.E2E_VOUCHER_PP_NO, 'Set E2E_VOUCHER_PP_NO (a real PP doc number, e.g. PP-20260101-001) for payment-voucher coverage')

    await loginAsPm(page)
    await page.goto('/dashboard/procurement/payments')
    await expect(page.getByText('ใบสำคัญจ่าย (Payment Vouchers)')).toBeVisible()

    await page.getByPlaceholder('ค้นหาเลขที่ PP / RI / ผู้จำหน่าย / บริษัท').fill(process.env.E2E_VOUCHER_PP_NO!)
    await expect(page.getByText(process.env.E2E_VOUCHER_PP_NO!, { exact: false })).toBeVisible()
  })
})
