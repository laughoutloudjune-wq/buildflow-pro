/**
 * Unit conversion for BOQ comparison (pure helpers; the database applies the
 * same rule in unit_factor() - keep the two in step).
 *
 * Everything compared to the BOQ is counted in the material's master unit
 * (material_types.unit). A request or order line written in another unit
 * converts with material_unit_conversions.factor = how many of that unit make
 * 1 master unit, so base quantity = quantity / factor. A unit with no stored
 * conversion is unknown: the line is left out of BOQ sums rather than added in
 * as if it were the same unit.
 */

/** material id -> unit -> factor */
export type UnitConversions = Record<number, Record<string, number>>

/** The request form's unit box shows this word as a placeholder; a line that
 * still carries it means "no unit was chosen". */
const PLACEHOLDER_UNIT = 'unit'

const clean = (unit: string | null | undefined) => (unit ?? '').trim()

/** True when `unit` is the master unit itself (or empty, or the placeholder). */
export function isMasterUnit(masterUnit: string, unit: string | null | undefined): boolean {
  const u = clean(unit)
  return u === '' || u === PLACEHOLDER_UNIT || u === clean(masterUnit)
}

/** How many of `unit` make 1 master unit; null when that is not known. */
export function unitFactor(
  conversions: UnitConversions,
  materialTypeId: number,
  masterUnit: string,
  unit: string | null | undefined
): number | null {
  if (isMasterUnit(masterUnit, unit)) return 1
  return conversions[materialTypeId]?.[clean(unit)] ?? null
}

/** Quantity in the master unit; null when the conversion is unknown. */
export function toBaseQty(
  conversions: UnitConversions,
  materialTypeId: number,
  masterUnit: string,
  unit: string | null | undefined,
  quantity: number
): number | null {
  const f = unitFactor(conversions, materialTypeId, masterUnit, unit)
  return f == null ? null : quantity / f
}

/** "1 มัด = 10 เส้น" */
export function conversionText(masterUnit: string, unit: string, factor: number): string {
  return `1 ${masterUnit} = ${factor.toLocaleString('th-TH', { maximumFractionDigits: 4 })} ${unit}`
}

export const UNKNOWN_CONVERSION_LABEL = 'เทียบ BOQ ไม่ได้ จนกว่าจะรู้หน่วย'
