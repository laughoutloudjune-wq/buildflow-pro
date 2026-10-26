/** What a request line and an order line look like to the "link request to
 * order" screens, and how lines are paired up for the person who confirms. */

export type LinkLine = {
  id: string
  requestId: string
  prNo: string | null
  name: string
  materialTypeId: number
  genericId: number | null
  quantity: number
  unit: string
  /** The PO number typed when the line was closed the old way, if any. */
  typedPoRef: string | null
}

export type LinkPoItem = {
  id: string
  name: string
  materialTypeId: number
  genericId: number | null
  quantity: number
  unit: string
}

export type LinkOrder = {
  id: string
  poNo: string
  supplier: string | null
  orderDate: string | null
  status: string
  items: LinkPoItem[]
}

/** How a pair relates: 'same' = the same material, 'brand' = a different
 * brand or name of the same kind of thing (shown as a tag, never a block). */
export type PairTag = 'same' | 'brand'

type Thing = { id: string; name: string; materialTypeId: number; genericId: number | null }

function normalise(name: string): string {
  return name.toLowerCase().replace(/[\s"'“”″°.,()\-_/]+/g, '')
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

/** Sørensen–Dice similarity of two names (0..1). Works for Thai, which has no
 * word breaks, because it looks at letter pairs. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalise(a)
  const y = normalise(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const bx = bigrams(x)
  const by = bigrams(y)
  let overlap = 0
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) ?? 0)
  const total = Math.max(x.length - 1, 0) + Math.max(y.length - 1, 0)
  return total === 0 ? 0 : (2 * overlap) / total
}

const NAME_THRESHOLD = 0.55

/** 0 = not a candidate; higher = better. Same material beats the same generic
 * item (brand roll-up), which beats a similar name. */
export function matchScore(a: Thing, b: Thing): { score: number; tag: PairTag } | null {
  if (a.materialTypeId === b.materialTypeId) return { score: 3, tag: 'same' }
  if (
    (a.genericId != null && (a.genericId === b.materialTypeId || a.genericId === b.genericId)) ||
    (b.genericId != null && b.genericId === a.materialTypeId)
  ) {
    return { score: 2 + nameSimilarity(a.name, b.name) * 0.5, tag: 'brand' }
  }
  const sim = nameSimilarity(a.name, b.name)
  if (sim >= NAME_THRESHOLD) return { score: 1 + sim * 0.5, tag: 'brand' }
  return null
}

/** For each source, the best target nobody better has claimed. Greedy by
 * score, so the strongest pairs are settled first. */
export function suggestPairs<S extends Thing, T extends Thing>(
  sources: S[],
  targets: T[]
): Record<string, { targetId: string; tag: PairTag }> {
  const candidates: { s: string; t: string; score: number; tag: PairTag }[] = []
  for (const s of sources) {
    for (const t of targets) {
      const m = matchScore(s, t)
      if (m) candidates.push({ s: s.id, t: t.id, score: m.score, tag: m.tag })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const usedS = new Set<string>()
  const usedT = new Set<string>()
  const out: Record<string, { targetId: string; tag: PairTag }> = {}
  for (const c of candidates) {
    if (usedS.has(c.s) || usedT.has(c.t)) continue
    usedS.add(c.s)
    usedT.add(c.t)
    out[c.s] = { targetId: c.t, tag: c.tag }
  }
  return out
}

/** How many of the given lines an order could answer (for sorting the list
 * of orders best match first). */
export function orderMatchCount(lines: LinkLine[], order: LinkOrder): number {
  return Object.keys(suggestPairs(lines, order.items)).length
}
