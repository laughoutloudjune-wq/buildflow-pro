import { expect, test } from '@playwright/test'
import {
  ceilingQty,
  consumedQty,
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
    issuedValue: 0,
    orderedValue: 0,
    receivedValue: 0,
    isEstimated: false,
    pendingQty: 0,
    unconvertedLines: 0,
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

  // totalUsedQty is the one "how much is committed" basis: the PO / request /
  // receipt checks and the cost-control rollup (percentUsed, rowStatus,
  // excessValue) all read it, so every screen agrees on what is over BOQ.
  test('totalUsedQty is the larger of ordered and issued, never their sum or received', () => {
    expect(totalUsedQty(row({ orderedQty: 100, issuedQty: 20, receivedQty: 999 }))).toBe(100)
    // Straight-to-plot delivery: the same 1,890 is both ordered and issued.
    expect(totalUsedQty(row({ orderedQty: 1890, issuedQty: 1890 }))).toBe(1890)
    expect(totalUsedQty(row({ orderedQty: 100, issuedQty: 150 }))).toBe(150)
  })

  test('consumedQty is issuedQty alone, never ordered or received', () => {
    expect(consumedQty(row({ orderedQty: 999, issuedQty: 20, receivedQty: 999 }))).toBe(20)
  })

  test('percentUsed is null when there is no budget to measure against', () => {
    expect(percentUsed(row({ plannedQty: 0, allowanceQty: 0, issuedQty: 50 }))).toBeNull()
  })

  test('percentUsed is a plain percentage of the ceiling', () => {
    expect(percentUsed(row({ plannedQty: 200, issuedQty: 100 }))).toBe(50)
  })

  test('percentUsed counts the larger of ordered and issued, never their sum', () => {
    expect(percentUsed(row({ plannedQty: 200, orderedQty: 100, issuedQty: 0 }))).toBe(50)
    expect(percentUsed(row({ plannedQty: 200, orderedQty: 100, issuedQty: 100 }))).toBe(50)
  })

  test('rowStatus: not_in_boq when nothing was planned but something was consumed', () => {
    expect(rowStatus(row({ plannedQty: 0, allowanceQty: 0, issuedQty: 10 }))).toBe('not_in_boq')
  })

  test('rowStatus: bought but never planned is not_in_boq', () => {
    expect(rowStatus(row({ plannedQty: 0, allowanceQty: 0, orderedQty: 10, issuedQty: 0 }))).toBe('not_in_boq')
  })

  test('rowStatus: ordering past the ceiling is over before anything ships', () => {
    expect(rowStatus(row({ plannedQty: 100, orderedQty: 101, issuedQty: 0 }))).toBe('over')
    expect(rowStatus(row({ plannedQty: 100, orderedQty: 90, issuedQty: 0 }))).toBe('watch')
    expect(rowStatus(row({ plannedQty: 100, orderedQty: 100, issuedQty: 100 }))).toBe('watch')
  })

  test('rowStatus: no_budget when nothing was planned and nothing was bought either', () => {
    expect(rowStatus(row({ plannedQty: 0, allowanceQty: 0, orderedQty: 0, issuedQty: 0 }))).toBe('no_budget')
  })

  test('rowStatus: over when consumption exceeds the ceiling', () => {
    expect(rowStatus(row({ plannedQty: 100, issuedQty: 101 }))).toBe('over')
  })

  test('rowStatus: watch at the 90% threshold', () => {
    expect(rowStatus(row({ plannedQty: 100, issuedQty: 90 }))).toBe('watch')
    expect(rowStatus(row({ plannedQty: 100, issuedQty: 89 }))).toBe('ok')
  })

  test('rowStatus: exactly at the ceiling is watch (>= 90%), not over (> 100%)', () => {
    expect(rowStatus(row({ plannedQty: 100, issuedQty: 100 }))).toBe('watch')
  })

  test('excessValue is 0 for a row that is not over', () => {
    expect(excessValue(row({ plannedQty: 100, orderedQty: 90, orderedValue: 900, issuedQty: 90 }))).toBe(0)
  })

  test('excessValue prices the overage at the row\'s own average ordered unit price', () => {
    // 120 consumed against a ceiling of 100 = 20 over, priced at the row's
    // average ordered price of 900/90 = 10 baht/unit (stock_movements
    // carries no price of its own).
    expect(excessValue(row({ plannedQty: 100, orderedQty: 90, orderedValue: 900, issuedQty: 120 }))).toBe(200)
  })

  test('excessValue counts an over-order that has not shipped yet', () => {
    // 90 ordered at 900 baht against a ceiling of 80: 10 over x 10 baht.
    expect(excessValue(row({ plannedQty: 80, orderedQty: 90, orderedValue: 900, issuedQty: 0 }))).toBe(100)
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
