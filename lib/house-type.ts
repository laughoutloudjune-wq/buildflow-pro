/**
 * "Prime A · แฝด": a house type is told apart by name AND code. Two types can
 * share a name (Prime A has อิสระ and แฝด, each with its own BOQ), so a name
 * alone makes the same job look duplicated. A code that is only digits or empty
 * adds nothing and is left out.
 */
export function houseTypeLabel(name: string | null | undefined, code: string | null | undefined): string {
  const n = (name ?? '').trim()
  const c = (code ?? '').trim()
  if (!n) return c
  if (!c || /^\d+$/.test(c) || c === n) return n
  return `${n} · ${c}`
}
