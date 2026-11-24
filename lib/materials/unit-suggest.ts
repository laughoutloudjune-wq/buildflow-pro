/**
 * Suggesting a unit for a material that has none yet (pure helpers).
 *
 * A material with no unit carries the word "unit" (the database default). The
 * system learns the real unit when the material is first ordered, and a
 * suggestion is shown while adding one by hand. Suggestions only ever come
 * from data that already exists - never a fixed word list that someone would
 * have to maintain.
 */

export const PLACEHOLDER_UNIT = 'unit'

/** True when the unit is empty or the placeholder: "no unit chosen yet". */
export function isPlaceholderUnit(unit: string | null | undefined): boolean {
  const u = (unit ?? '').trim().toLowerCase()
  return u === '' || u === PLACEHOLDER_UNIT
}

export type UnitSuggestion = { unit: string; why: string }

/** "(20 ชิ้น/ถุง)" in a name means the item is counted per ถุง. */
const PACK_IN_NAME = /\(\s*\d+(?:\.\d+)?\s*[^\s/()]*\s*\/\s*([^\s()]+)\s*\)/
/** "(แพ๊ค 10)" means counted per แพ๊ค. */
const PACK_WORD_IN_NAME = /\(\s*(แพ๊ค|แพ็ค|แพค)\s*\d+\s*\)/

type Counts = Map<string, number>

/** First word / first two words of a name -> how often each real unit is used. */
export function buildUnitIndex(materials: { name: string; unit: string | null }[]): Map<string, Counts> {
  const index = new Map<string, Counts>()
  for (const m of materials) {
    if (isPlaceholderUnit(m.unit)) continue
    const unit = (m.unit as string).trim()
    for (const key of nameKeys(m.name)) {
      const counts = index.get(key) ?? new Map<string, number>()
      counts.set(unit, (counts.get(unit) ?? 0) + 1)
      index.set(key, counts)
    }
  }
  return index
}

function nameKeys(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const keys = [words[0]]
  if (words.length > 1) keys.unshift(`${words[0]} ${words[1]}`)
  return keys
}

/** Needs at least 3 look-alikes, and 80% of them agreeing, before it speaks up. */
const MIN_SAMPLES = 3
const MIN_AGREEMENT = 0.8

export function suggestUnit(name: string, index: Map<string, Counts>): UnitSuggestion | null {
  const pack = PACK_IN_NAME.exec(name)
  if (pack) return { unit: pack[1], why: 'ชื่อบอกว่านับเป็น ' + pack[1] }
  if (PACK_WORD_IN_NAME.test(name)) return { unit: 'แพ๊ค', why: 'ชื่อบอกว่านับเป็นแพ๊ค' }

  for (const key of nameKeys(name)) {
    const counts = index.get(key)
    if (!counts) continue
    let total = 0
    let top = ''
    let topN = 0
    for (const [unit, n] of counts) {
      total += n
      if (n > topN) {
        top = unit
        topN = n
      }
    }
    if (total >= MIN_SAMPLES && topN / total >= MIN_AGREEMENT) {
      return { unit: top, why: `วัสดุ "${key}" อื่น ๆ ใช้หน่วยนี้ (${topN}/${total})` }
    }
  }
  return null
}
