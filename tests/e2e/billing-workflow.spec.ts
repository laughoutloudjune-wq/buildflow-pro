import { expect, test } from '@playwright/test'
import { loginAsForeman, loginAsPm, requireE2ECredentials } from './helpers/auth'

test.describe('Billing workflow', () => {
  requireE2ECredentials()

  // L-12: the rest of the submit -> reject -> resubmit -> approve -> paid
  // out chain (W-03/H-04's area). Same reasoning as the tests below this
  // one - no staging database, so each stage is reached with a real record
  // already in that state (set via env var) rather than performed here.

  test('foreman can reach the main-request chooser and open the DC-only flow', async ({ page }) => {
    await loginAsForeman(page)

    await page.goto('/dashboard/foreman/create-progress')
    await expect(page).toHaveURL(/\/dashboard\/foreman\/create-progress/)
    await expect(page.getByRole('link', { name: 'เบิกงวดงานหลัก', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'งานเพิ่ม / DC', exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'งานเพิ่ม / DC', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/foreman\/create-dc/)
  })

  test('pm can open the review queue and reach a pending request', async ({ page }) => {
    test.skip(!process.env.E2E_PENDING_BILLING_ID, 'Set E2E_PENDING_BILLING_ID for review-flow coverage')

    await loginAsPm(page)
    await page.goto('/dashboard/billing')
    await expect(page.getByText('รายการเบิกจ่ายงวดงาน')).toBeVisible()

    await page.goto(`/dashboard/billing/${process.env.E2E_PENDING_BILLING_ID}/review`)
    await expect(page.getByText('ตรวจสอบใบขอเบิก')).toBeVisible()
  })

  test('pm can open an approved request and trigger undo approve confirmation', async ({ page }) => {
    test.skip(!process.env.E2E_APPROVED_BILLING_ID, 'Set E2E_APPROVED_BILLING_ID for undo-approve coverage')

    await loginAsPm(page)
    await page.goto(`/dashboard/billing/${process.env.E2E_APPROVED_BILLING_ID}/review`)
    await page.getByRole('button', { name: 'ย้อนสถานะอนุมัติ' }).click()
    await expect(page.getByRole('heading', { name: 'ย้อนสถานะอนุมัติ' })).toBeVisible()
  })

  test('foreman can reach a rejected bill and its resubmit button', async ({ page }) => {
    test.skip(!process.env.E2E_REJECTED_BILLING_ID, 'Set E2E_REJECTED_BILLING_ID (a bill this foreman login owns, status rejected) for resubmit coverage')

    await loginAsForeman(page)
    await page.goto('/dashboard/foreman/history')
    await page.getByRole('button', { name: /ปฏิเสธ/ }).click()
    await expect(page.getByRole('button', { name: 'แก้ไขแล้วส่งใหม่' })).toBeVisible()
  })

  test('pm sees no approve/reject/undo/delete actions on an already paid-out bill', async ({ page }) => {
    test.skip(!process.env.E2E_PAID_OUT_BILLING_ID, 'Set E2E_PAID_OUT_BILLING_ID (a bill already marked paid out) for paid-out coverage')

    await loginAsPm(page)
    await page.goto(`/dashboard/billing/${process.env.E2E_PAID_OUT_BILLING_ID}/review`)
    await expect(page.getByText('ตรวจสอบใบขอเบิก')).toBeVisible()
    await expect(page.getByRole('button', { name: 'ปฏิเสธ' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'อนุมัติและจบงาน' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'ย้อนสถานะอนุมัติ' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'ลบใบคำขอ' })).toHaveCount(0)
  })
})
