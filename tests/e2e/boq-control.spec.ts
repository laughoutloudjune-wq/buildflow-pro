import { expect, test } from '@playwright/test'
import { loginAsPm, requireE2ECredentials } from './helpers/auth'

// These tests read fixtures that must already exist in the target
// environment (same convention as billing-workflow.spec.ts's
// E2E_PENDING_BILLING_ID/E2E_APPROVED_BILLING_ID) - each one no-ops with a
// clear message when its id isn't configured, rather than trying to create
// a house model + BOQ material + plot + PO from scratch on every run.
//
// To exercise these, seed (BOQ_CONTROL_PLAN.md 11):
//   E2E_OVER_BOQ_PO_ID       - a non-cancelled, non-outside-BOQ PO whose
//                              plot/group scope has at least one material
//                              ordered past its BOQ + allowance ceiling.
//   E2E_OUTSIDE_BOQ_PO_ID    - a PO created with "ซื้อนอก BOQ" checked.
//   E2E_COST_CONTROL_PROJECT - the project id that E2E_OUTSIDE_BOQ_PO_ID
//                              belongs to, for the cost-control page check.

test.describe('BOQ control - purchase order check panel', () => {
  requireE2ECredentials()

  test('an over-budget PO shows the red banner, requires a reason, and keeps the override visible after reload', async ({ page }) => {
    test.skip(!process.env.E2E_OVER_BOQ_PO_ID, 'Set E2E_OVER_BOQ_PO_ID for over-BOQ check-panel coverage')

    await loginAsPm(page)
    await page.goto(`/dashboard/procurement/orders/${process.env.E2E_OVER_BOQ_PO_ID}`)

    const banner = page.getByText(/เกิน BOQ \d+ รายการ/)
    await expect(banner).toBeVisible()
    await banner.click() // expand if collapsed

    const alreadyApproved = page.getByText('อนุมัติแล้ว:').first()
    if (await alreadyApproved.isVisible().catch(() => false)) {
      // A previous run of this test already acknowledged the line(s) on
      // this fixture - the override is an upsert, so just confirm it
      // persisted rather than re-typing a reason into a line that no
      // longer renders a textarea.
      await expect(alreadyApproved).toBeVisible()
      return
    }

    const acknowledgeButton = page.getByRole('button', { name: 'รับทราบ - อนุมัติเกิน BOQ' })
    await expect(acknowledgeButton).toBeDisabled()

    const reason = `E2E test override ${new Date().toISOString()}`
    await page.getByPlaceholder('เหตุผลที่ซื้อเกิน BOQ (จำเป็นต้องระบุ)').first().fill(reason)
    await expect(acknowledgeButton).toBeEnabled()

    await acknowledgeButton.click()
    await expect(page.getByText('บันทึกการอนุมัติเกิน BOQ แล้ว')).toBeVisible()
    await expect(page.getByText(reason)).toBeVisible()

    await page.reload()
    await expect(page.getByText('อนุมัติแล้ว:').first()).toBeVisible()
    await expect(page.getByText(reason)).toBeVisible()
  })

  test('a PO marked outside BOQ shows the neutral notice instead of a comparison', async ({ page }) => {
    test.skip(!process.env.E2E_OUTSIDE_BOQ_PO_ID, 'Set E2E_OUTSIDE_BOQ_PO_ID for outside-BOQ coverage')

    await loginAsPm(page)
    await page.goto(`/dashboard/procurement/orders/${process.env.E2E_OUTSIDE_BOQ_PO_ID}`)
    await expect(page.getByText('ซื้อนอก BOQ')).toBeVisible()
    await expect(page.getByText(/ไม่นำมาเทียบกับ BOQ/)).toBeVisible()
  })

  test("an outside-BOQ PO's spend is excluded from the cost-control quantity rollup", async ({ page }) => {
    test.skip(
      !process.env.E2E_OUTSIDE_BOQ_PO_ID || !process.env.E2E_COST_CONTROL_PROJECT,
      'Set E2E_OUTSIDE_BOQ_PO_ID and E2E_COST_CONTROL_PROJECT for cost-control exclusion coverage'
    )

    await loginAsPm(page)
    await page.goto(`/dashboard/cost-control?project=${process.env.E2E_COST_CONTROL_PROJECT}`)
    await expect(page.getByRole('heading', { name: 'ควบคุมต้นทุน' })).toBeVisible()

    const outsideSection = page.getByRole('button', { name: /ซื้อนอก BOQ \(\d+\)/ })
    await expect(outsideSection).toBeVisible()
    await outsideSection.click()

    // Look up the PO's own number from its detail page rather than
    // hardcoding it, so this test only depends on the two env ids above.
    await page.goto(`/dashboard/procurement/orders/${process.env.E2E_OUTSIDE_BOQ_PO_ID}`)
    const poNo = await page.locator('h1').first().innerText()

    await page.goto(`/dashboard/cost-control?project=${process.env.E2E_COST_CONTROL_PROJECT}`)
    await outsideSection.click()
    await expect(page.getByText(poNo.replace('ใบสั่งซื้อ ', ''))).toBeVisible()
  })
})
