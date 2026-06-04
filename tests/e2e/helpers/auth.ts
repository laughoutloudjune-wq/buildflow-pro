import { Page, expect, test } from '@playwright/test'

const foremanEmail = process.env.E2E_FOREMAN_EMAIL
const foremanPassword = process.env.E2E_FOREMAN_PASSWORD
const pmEmail = process.env.E2E_PM_EMAIL
const pmPassword = process.env.E2E_PM_PASSWORD
const adminEmail = process.env.E2E_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD

export function requireE2ECredentials() {
  test.skip(
    !foremanEmail || !foremanPassword || !pmEmail || !pmPassword || !adminEmail || !adminPassword,
    'E2E credentials are not configured'
  )
}

export async function loginAsForeman(page: Page) {
  if (!foremanEmail || !foremanPassword) throw new Error('Missing foreman credentials')
  await login(page, foremanEmail, foremanPassword)
}

export async function loginAsPm(page: Page) {
  if (!pmEmail || !pmPassword) throw new Error('Missing PM credentials')
  await login(page, pmEmail, pmPassword)
}

export async function loginAsAdmin(page: Page) {
  if (!adminEmail || !adminPassword) throw new Error('Missing admin credentials')
  await login(page, adminEmail, adminPassword)
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button').click()
  await expect(page).toHaveURL(/\/dashboard/)
}
