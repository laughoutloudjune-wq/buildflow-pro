import { expect, test } from '@playwright/test'
import { loginAsAdmin, loginAsForeman, loginAsPm, requireE2ECredentials } from './helpers/auth'

test.describe('Deployment smoke (role routes)', () => {
  requireE2ECredentials()

  test('admin can open projects, contractors, settings, billing', async ({ page }) => {
    await loginAsAdmin(page)

    await page.goto('/dashboard/projects')
    await expect(page).toHaveURL(/\/dashboard\/projects/)

    await page.goto('/dashboard/contractors')
    await expect(page).toHaveURL(/\/dashboard\/contractors/)

    await page.goto('/dashboard/settings')
    await expect(page).toHaveURL(/\/dashboard\/settings/)

    await page.goto('/dashboard/billing')
    await expect(page).toHaveURL(/\/dashboard\/billing/)
  })

  test('pm can open projects/contractors/billing but is redirected away from settings', async ({ page }) => {
    await loginAsPm(page)

    await page.goto('/dashboard/projects')
    await expect(page).toHaveURL(/\/dashboard\/projects/)

    await page.goto('/dashboard/contractors')
    await expect(page).toHaveURL(/\/dashboard\/contractors/)

    await page.goto('/dashboard/billing')
    await expect(page).toHaveURL(/\/dashboard\/billing/)

    await page.goto('/dashboard/settings')
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('foreman core routes load (permissions may vary), settings should be protected', async ({ page }) => {
    await loginAsForeman(page)

    await page.goto('/dashboard/foreman/create-progress')
    await expect(page).toHaveURL(/\/dashboard\/foreman\/create-progress/)

    await page.goto('/dashboard/projects')
    await expect(page).toHaveURL(/\/dashboard\/projects/)

    await page.goto('/dashboard/contractors')
    await expect(page).toHaveURL(/\/dashboard(\/contractors)?$/)

    await page.goto('/dashboard/billing')
    await expect(page).toHaveURL(/\/dashboard(\/billing)?$/)

    await page.goto('/dashboard/settings')
    await expect(page).toHaveURL(/\/dashboard$/)
  })
})

