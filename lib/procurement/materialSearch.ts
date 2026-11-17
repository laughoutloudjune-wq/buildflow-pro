/**
 * Forgiving material search for the purchase request "shop" picker.
 *
 * Material names are long and inconsistent ("แป๊ปเหลี่ยม 2"*2" หนา 1.60mm",
 * "แผ่นยิปซั่ม TOA 9mm ..."), and foremen type on phones, so a plain
 * substring match misses most of what they mean. This module makes a query
 * match when:
 * - its words come in any order ("1/2 pvc")
 * - Thai tone marks are missing or wrong ("ยิปซัม")
 * - a word has a small typo ("ปุนกาว")
 * - Thai and English spellings differ ("ทีโอเอ" = TOA, "มิล" = mm, "นิ้ว" = ")
 * - the keyboard was left on English ("mikp" = ทราย)
 *
 * Everything here works from the existing material names and categories;
 * nothing needs to be set up or maintained by hand. Pure functions only, so
 * the same code runs in the browser and in tests.
 */

export type SearchableMaterial = {
  id: number
  name: string
  unit: string
  category: string | null
}

export type IndexedMaterial<T extends SearchableMaterial = SearchableMaterial> = {
  item: T
  /** Canonical form with spaces kept (for word-start ranking). */
  canon: string
  /** Canonical form with spaces and punctuation removed (for matching). */
  key: string
  /** The material's own category, or one guessed from similar names. */
  category: string
  /** True when `category` was guessed (the material has none set). */
  categoryGuessed: boolean
  /** How often it was requested/ordered before - ranks ขอบ่อย. */
  popularity: number
}

export const OTHER_CATEGORY = 'อื่นๆ'

// Thai spelling or common site word -> one canonical form. Applied to both
// names and queries, so either spelling finds the other.
const SYNONYMS: [string, string][] = [
  ['พีวีซี', 'pvc'],
  ['ทีพีไอ', 'tpi'],
  ['ทีโอเอ', 'toa'],
  ['เอสซีจี', 'scg'],
  ['นิปปอน', 'nippon'],
  ['ฮาเฟเล่', 'hafele'],
  ['มิลลิเมตร', 'mm'],
  ['มม.', 'mm'],
  ['มม', 'mm'],
  ['มิล', 'mm'],
  ['เซนติเมตร', 'cm'],
  ['ซม.', 'cm'],
  ['ซม', 'cm'],
  ['นิ้ว', '"'],
  ['แป๊บ', 'แป๊ป'],
  ['แปป', 'แป๊ป'],
  ['ท่อเหลี่ยม', 'แป๊ปเหลี่ยม'],
  ['เหล็กกล่อง', 'แป๊ปเหลี่ยม'],
  ['ยิปซัม', 'ยิปซั่ม'],
  ['ซีลีโคน', 'ซิลิโคน'],
  ['สกรูว์', 'สกรู'],
  ['น๊อต', 'น็อต'],
  ['พุ๊ก', 'พุก'],
  ['ปูนซีเมนต์', 'ปูน'],
]

// Tone marks and other above-line signs (็ ่ ้ ๊ ๋ ์ ํ ๎) - ignored when matching.
const MARKS = /[็-๎]/g
const THAI = /[฀-๿]/
const LATIN = /[a-z]/i

const SYNONYMS_STRIPPED = SYNONYMS.map(([a, b]) => [a.replace(MARKS, ''), b.replace(MARKS, '')] as const)

export function canonical(text: string): string {
  let s = text.toLowerCase().normalize('NFC').replace(/[”“″]/g, '"').replace(/[×*]/g, 'x').replace(MARKS, '')
  for (const [from, to] of SYNONYMS_STRIPPED) s = s.split(from).join(to)
  // "9 mm" and "9mm" are the same size
  return s.replace(/(\d)\s+(mm|cm|")/g, '$1$2')
}

export function squash(text: string): string {
  return text.replace(/[\s\-_,()[\]#]/g, '')
}

// Thai Kedmanee layout: what a key types when the keyboard is on Thai.
const KEDMANEE: Record<string, string> = {
  '1': 'ๅ', '2': '/', '3': '-', '4': 'ภ', '5': 'ถ', '6': 'ุ', '7': 'ึ', '8': 'ค', '9': 'ต', '0': 'จ', '-': 'ข', '=': 'ช',
  q: 'ๆ', w: 'ไ', e: 'ำ', r: 'พ', t: 'ะ', y: 'ั', u: 'ี', i: 'ร', o: 'น', p: 'ย', '[': 'บ', ']': 'ล', '\\': 'ฃ',
  a: 'ฟ', s: 'ห', d: 'ก', f: 'ด', g: 'เ', h: '้', j: '่', k: 'า', l: 'ส', ';': 'ว', "'": 'ง',
  z: 'ผ', x: 'ป', c: 'แ', v: 'อ', b: 'ิ', n: 'ื', m: 'ท', ',': 'ม', '.': 'ใ', '/': 'ฝ',
  '^': 'ู', '&': '฿', Q: '๐', E: 'ฎ', R: 'ฑ', T: 'ธ', Y: 'ํ', U: '๊', I: 'ณ', O: 'ฯ', P: 'ญ', '{': 'ฐ',
  A: 'ฤ', S: 'ฆ', D: 'ฏ', F: 'โ', G: 'ฌ', H: '็', J: '๋', K: 'ษ', L: 'ศ', ':': 'ซ', C: 'ฉ', V: 'ฮ', N: '์', '<': 'ฒ', '>': 'ฬ',
}

/** What the user meant if they typed Thai with the keyboard still on English. */
export function englishKeysToThai(text: string): string {
  return [...text].map((ch) => KEDMANEE[ch] ?? ch).join('')
}

function levenshtein(a: string, b: string, max: number): number {
  const n = a.length
  const m = b.length
  if (Math.abs(n - m) > max) return max + 1
  let prev = Array.from({ length: m + 1 }, (_, j) => j)
  for (let i = 1; i <= n; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= m; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[m]
}

/** Does `key` contain something within a small edit distance of `token`? */
function fuzzyContains(key: string, token: string): boolean {
  const max = token.length <= 3 ? 0 : token.length <= 6 ? 1 : 2
  if (max === 0) return false
  for (let len = token.length - 1; len <= token.length + 1; len++) {
    for (let i = 0; i + len <= key.length; i++) {
      if (levenshtein(token, key.substr(i, len), max) <= max) return true
    }
  }
  return false
}

export function queryTokens(query: string): string[] {
  return canonical(query).split(/\s+/).map(squash).filter(Boolean)
}

/** Letters-only form of a name, for comparing name starts. */
function stem(name: string): string {
  return name.toLowerCase().replace(/[^฀-๿a-z]/g, '')
}

/**
 * Category per material: its own when set, otherwise the most common category
 * among materials whose names start the same way (longest shared start of at
 * least 3 letters wins). Display only - nothing is saved.
 */
export function guessCategories(materials: SearchableMaterial[]): Map<number, { category: string; guessed: boolean }> {
  const known = materials.filter((m) => m.category?.trim()).map((m) => ({ stem: stem(m.name), category: m.category!.trim() }))
  const result = new Map<number, { category: string; guessed: boolean }>()
  for (const m of materials) {
    if (m.category?.trim()) {
      result.set(m.id, { category: m.category.trim(), guessed: false })
      continue
    }
    const s = stem(m.name)
    let guess: string | null = null
    for (let len = Math.min(s.length, 12); len >= 3 && !guess; len--) {
      const prefix = s.slice(0, len)
      const votes = new Map<string, number>()
      for (const k of known) if (k.stem.startsWith(prefix)) votes.set(k.category, (votes.get(k.category) || 0) + 1)
      if (votes.size) guess = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0]
    }
    result.set(m.id, { category: guess || OTHER_CATEGORY, guessed: true })
  }
  return result
}

export function indexMaterials<T extends SearchableMaterial>(
  materials: T[],
  popularity: Map<number, number> = new Map()
): IndexedMaterial<T>[] {
  const categories = guessCategories(materials)
  return materials.map((item) => {
    const canon = canonical(item.name)
    const cat = categories.get(item.id)!
    return {
      item,
      canon,
      key: squash(canon),
      category: cat.category,
      categoryGuessed: cat.guessed,
      popularity: popularity.get(item.id) || 0,
    }
  })
}

export type SearchResult<T extends SearchableMaterial> = {
  rows: (IndexedMaterial<T> & { approximate: boolean })[]
  tokens: string[]
  /** Set when the query was re-read as Thai typed on an English keyboard. */
  readAs: string | null
  /** True when some rows only matched with a small typo allowed. */
  approximate: boolean
}

/**
 * Search, then rank: materials the BOQ allows for these plots first, then
 * names that start with the first word, then whole-word matches, then the
 * most often requested.
 */
export function searchMaterials<T extends SearchableMaterial>(
  index: IndexedMaterial<T>[],
  query: string,
  options: { boqIds?: Set<number> } = {}
): SearchResult<T> {
  const boqIds = options.boqIds || new Set<number>()
  let tokens = queryTokens(query)
  let readAs: string | null = null
  if (tokens.length === 0) {
    return { rows: rank(index.map((r) => ({ ...r, approximate: false })), [], boqIds), tokens, readAs, approximate: false }
  }
  let rows = index.filter((r) => tokens.every((t) => r.key.includes(t)))

  if (rows.length < 3 && LATIN.test(query) && !THAI.test(query)) {
    const thai = englishKeysToThai(query.trim())
    const thaiTokens = queryTokens(thai)
    const thaiRows = index.filter((r) => thaiTokens.every((t) => r.key.includes(t)))
    if (thaiRows.length > rows.length) {
      rows = thaiRows
      tokens = thaiTokens
      readAs = thai
    }
  }

  const exact = rows.map((r) => ({ ...r, approximate: false }))
  let approximate = false
  if (rows.length < 3) {
    const seen = new Set(rows.map((r) => r.item.id))
    const extra = index.filter((r) => !seen.has(r.item.id) && tokens.every((t) => r.key.includes(t) || fuzzyContains(r.key, t)))
    if (extra.length) {
      approximate = true
      exact.push(...extra.map((r) => ({ ...r, approximate: true })))
    }
  }
  return { rows: rank(exact, tokens, boqIds), tokens, readAs, approximate }
}

function rank<R extends IndexedMaterial & { approximate: boolean }>(rows: R[], tokens: string[], boqIds: Set<number>): R[] {
  const score = (r: R) =>
    (boqIds.has(r.item.id) ? 1000 : 0) +
    (r.approximate ? -500 : 0) +
    (tokens.length && r.key.startsWith(tokens[0]) ? 40 : 0) +
    tokens.reduce((s, t) => s + ((' ' + r.canon).includes(' ' + t) ? 15 : 0), 0) +
    Math.min(r.popularity, 40) * 2 -
    r.item.name.length * 0.05
  return rows
    .map((r) => ({ r, s: score(r) }))
    .sort((a, b) => b.s - a.s || a.r.item.name.localeCompare(b.r.item.name, 'th'))
    .map((x) => x.r)
}

/**
 * "Narrow it down" words for the chips under the search box: the words that
 * appear in several (not all) of the results' names, most common first.
 */
export function refineWords(rows: IndexedMaterial[], tokens: string[], limit = 8): string[] {
  const counts = new Map<string, { word: string; n: number }>()
  for (const r of rows) {
    const seen = new Set<string>()
    for (const raw of r.item.name.split(/\s+/)) {
      const word = raw.replace(/^[("]+|[)",]+$/g, '')
      const k = squash(canonical(word))
      if (k.length < 2 || /^[\d./x"]+$/.test(k) || seen.has(k)) continue
      if (tokens.some((t) => k.includes(t) || t.includes(k))) continue
      seen.add(k)
      const entry = counts.get(k) || { word, n: 0 }
      entry.n++
      counts.set(k, entry)
    }
  }
  return [...counts.values()]
    .filter((e) => e.n >= 2 && e.n < rows.length)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((e) => e.word)
}

/** Which words of a name to highlight for these query tokens. */
export function highlightParts(name: string, tokens: string[]): { text: string; hit: boolean }[] {
  return name.split(/(\s+)/).map((text) => {
    const k = squash(canonical(text))
    const hit = !!k && tokens.some((t) => k.includes(t) || (t.length > 2 && k.length > 1 && t.includes(k)))
    return { text, hit }
  })
}
