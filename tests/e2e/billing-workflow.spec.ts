import { expect, test } from '@playwright/test'
import { loginAsForeman, loginAsPm, requireE2ECredentials } from './helpers/auth'

test.describe('Billing workflow', () => {
  requireE2ECredentials()

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
    await page.getByText('Undo Approve').click()
    await expect(page.getByRole('heading', { name: 'ย้อนสถานะอนุมัติ' })).toBeVisible()
  })
})
