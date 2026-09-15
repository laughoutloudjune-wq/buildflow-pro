import { expect, test } from '@playwright/test'
import {
  ceilingQty,
  excessValue,
  isBoqCheckLineOver,
  percentUsed,
  rowStatus,
  totalUsedQty,
  type BoqCheckLine,
  type BoqControlRow,
} from '@/lib/procurement/boqControl'

// Pure-logic coverage for the one piece of the BOQ control feature worth
// unit-testing directly (BOQ_CONTROL_PLAN.md 11.4) - no page/browser needed,
// so this runs unconditionally (no requireE2ECredentials()).

function row(overrides: Partial<BoqControlRow> = {}): BoqControlRow {
  return {
    materialTypeId: 1,
    materialName: 'ปูนซีเมนต์',
    unit: 'ถุง',
    plannedQty: 0,
    allowanceQty: 0,
    orderedQty: 0,
    receivedQty: 0,
    issuedQty: 0,
    orderedValue: 0,
    receivedValue: 0,
    isEstimated: false,
    ...overrides,
  }
}

function checkLine(overrides: Partial<BoqCheckLine> = {}): BoqCheckLine {
  return {
    materialTypeId: 1,
    materialName: 'ปูนซีเมนต์',
    unit: 'ถุง',
    plannedQty: 0,
    alreadyQty: 0,
    thisDocQty: 0,
    totalAfter: 0,
    ...overrides,
  }
}

test.describe('boqControl helpers', () => {
  test('ceilingQty is planned + allowance', () => {
    expect(ceilingQty(row({ plannedQty: 200, allowanceQty: 10 }))).toBe(210)
  })

  test('totalUsedQty is ordered + issued, never received', () => {
    expect(totalUsedQty(row({ orderedQty: 100, issuedQty: 20, receivedQty: 999 }))).toBe(120)
  })

  test('percentUsed is null when there is no budget to measure against', () => {
    expect(percentUsed(row({ plannedQty: 0, allowanceQty: 0, orderedQty: 50 }))).toBeNull()
  })

  test('percentUsed is a plain percentage of the ceiling', () => {
    expect(percentUsed(row({ plannedQty: 200, orderedQty: 100 }))).toBe(50)
  })

  test('rowStatus: not_in_boq when nothing was planned but something was bought', () => {
    expect(rowStatus(row({ plannedQty: 0, allowanceQty: 0, orderedQty: 10 }))).toBe('not_in_boq')
  })

  test('rowStatus: no_budget when nothing was planned and nothing was bought either', () => {
    expect(rowStatus(row({ plannedQty: 0, allowanceQty: 0, orderedQty: 0, issuedQty: 0 }))).toBe('no_budget')
  })

  test('rowStatus: over when usage exceeds the ceiling', () => {
    expect(rowStatus(row({ plannedQty: 100, orderedQty: 101 }))).toBe('over')
  })

  test('rowStatus: watch at the 90% threshold', () => {
    expect(rowStatus(row({ plannedQty: 100, orderedQty: 90 }))).toBe('watch')
    expect(rowStatus(row({ plannedQty: 100, orderedQty: 89 }))).toBe('ok')
  })

  test('rowStatus: exactly at the ceiling is watch (>= 90%), not over (> 100%)', () => {
    expect(rowStatus(row({ plannedQty: 100, orderedQty: 100 }))).toBe('watch')
  })

  test('excessValue is 0 for a row that is not over', () => {
    expect(excessValue(row({ plannedQty: 100, orderedQty: 90, orderedValue: 900 }))).toBe(0)
  })

  test('excessValue prices the overage at the row\'s own average unit price', () => {
    // 120 used against a ceiling of 100 = 20 over, at 900/90 = 10 baht/unit.
    expect(excessValue(row({ plannedQty: 100, orderedQty: 90, orderedValue: 900, issuedQty: 30 }))).toBe(200)
  })

  test('excessValue is 0 when there is no ordered value to derive a price from (e.g. all-issued)', () => {
    expect(excessValue(row({ plannedQty: 10, orderedQty: 0, issuedQty: 20 }))).toBe(0)
  })

  // Regression coverage: before this fix, a material with no BOQ line at
  // all (plannedQty 0 - the default state before Phase 0 data entry is
  // done) read as "over" the instant any quantity was bought, since
  // totalAfter (anything > 0) > plannedQty (0). Every check panel (PO, PR,
  // receiving, payment, print) shares this one function specifically so
  // that can't happen again in only one of the five places.
  test('isBoqCheckLineOver: a material with no BOQ line at all is never "over", however much is bought', () => {
    expect(isBoqCheckLineOver(checkLine({ plannedQty: 0, totalAfter: 500 }))).toBe(false)
  })

  test('isBoqCheckLineOver: true once a real budget is actually exceeded', () => {
    expect(isBoqCheckLineOver(checkLine({ plannedQty: 100, totalAfter: 101 }))).toBe(true)
  })

  test('isBoqCheckLineOver: false at or under a real budget', () => {
    expect(isBoqCheckLineOver(checkLine({ plannedQty: 100, totalAfter: 100 }))).toBe(false)
    expect(isBoqCheckLineOver(checkLine({ plannedQty: 100, totalAfter: 50 }))).toBe(false)
  })
})
