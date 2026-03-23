import { expect, test } from '@playwright/test'
import { loginAsForeman, loginAsPm, requireE2ECredentials } from './helpers/auth'

test.describe('Role-based route access', () => {
  requireE2ECredentials()

  test('foreman is redirected away from PM/admin project screens', async ({ page }) => {
    await loginAsForeman(page)
    await page.goto('/dashboard/projects')
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('pm can access reports directly', async ({ page }) => {
    await loginAsPm(page)
    await page.goto('/dashboard/reports/dc-history')
    await expect(page).toHaveURL(/\/dashboard\/reports\/dc-history/)
  })
})
