// House type change wizard: pure helpers (name pairing, plan building).
// No I/O here so it can be unit-tested without a browser or database.

export type HtcOldJob = {
  id: string
  name: string
  unit: string | null
  qty: number
  /** effective price: the job's pinned price, else its old line's price */
  price: number
  paid: number
}

export type HtcCandidateLine = {
  /** real boq_master id, or `seed:<boq id>` for a line of the seed house type
   * that does not exist in the new (empty) house type yet */
  key: string
  name: string
  unit: string | null
  qty: number
  price: number
  virtual: boolean
}

export type PairKind = 'same' | 'near' | 'copy'
export type Pairing = { jobId: string; lineKey: string | null; kind: PairKind; score: number }

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙'

/** Lower-case, Thai digits to Arabic, drop spaces and punctuation. */
export function normalizeName(raw: string): string {
  let s = (raw || '').toLowerCase()
  s = s.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
  // drop spaces, brackets, dots, commas, dashes, plus signs and the like
  s = s.replace(/[\s()[\]{}<>.,;:'"`!?/\\|_+\-–—*&%#@^~=]/g, '')
  return s
}

function digitsOf(s: string): string[] {
  return s.match(/\d+/g) || []
}

/** True when both names carry numbers and one list is not a prefix of the
 * other (ชั้น 1 vs ชั้น 2 clash; รอบ2 vs รอบ2(...ชั้น1) do not). */
function numbersClash(a: string, b: string): boolean {
  const x = digitsOf(a)
  const y = digitsOf(b)
  if (!x.length || !y.length) return false
  const n = Math.min(x.length, y.length)
  return x.slice(0, n).join(',') !== y.slice(0, n).join(',')
}

// Pairs of words that mean opposite things: names that differ on one of
// these are different jobs even if the rest is nearly identical.
const CONTRADICTIONS: [string, string][] = [
  ['บน', 'ล่าง'],
  ['ภายนอก', 'ภายใน'],
  ['หน้าบ้าน', 'หลังบ้าน'],
  ['ชั้นบน', 'ชั้นล่าง'],
]

function contradicts(a: string, b: string): boolean {
  for (const [x, y] of CONTRADICTIONS) {
    if ((a.includes(x) && !a.includes(y) && b.includes(y) && !b.includes(x)) || (a.includes(y) && !a.includes(x) && b.includes(x) && !b.includes(y))) {
      return true
    }
  }
  return false
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  if (s.length < 2) {
    if (s) m.set(s, 1)
    return m
  }
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) || 0) + 1)
  }
  return m
}

/** 0..1 similarity of two job names. 1 = same after normalising. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a)
  const y = normalizeName(b)
  if (!x || !y) return 0
  if (x === y) return 1
  // Different numbers (ชั้น 1 vs ชั้น 2, รอบ 1 vs รอบ 2) are different jobs.
  if (numbersClash(x, y)) return 0
  if (contradicts(x, y)) return 0

  const gx = bigrams(x)
  const gy = bigrams(y)
  let overlap = 0
  for (const [g, n] of gx) overlap += Math.min(n, gy.get(g) || 0)
  const dice = (2 * overlap) / (Math.max(1, x.length - 1) + Math.max(1, y.length - 1))

  // One name fully inside the other (e.g. งานมุงหลังคา inside งานมุงหลังคาเมลทัลชีส).
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  const containment = short.length >= 5 && long.includes(short) ? 0.6 + 0.4 * (short.length / long.length) : 0
  return Math.max(dice, containment)
}

export const NEAR_THRESHOLD = 0.62
/** A new-type line this similar to an old job name is "probably the same work". */
export const DUPLICATE_THRESHOLD = 0.5

/**
 * Suggest which new-type line each old job moves onto. Exact (normalised)
 * names first, then the most similar names above NEAR_THRESHOLD, one line per
 * job. Jobs left over are marked 'copy': their old line is copied into the new
 * type. Money never depends on this: the admin can change every pair and the
 * database re-checks every baht.
 */
export function suggestPairs(jobs: HtcOldJob[], lines: HtcCandidateLine[]): Pairing[] {
  const result = new Map<string, Pairing>()
  const usedLines = new Set<string>()

  // 1) exact names
  for (const job of jobs) {
    const nj = normalizeName(job.name)
    const line = lines.find((l) => !usedLines.has(l.key) && normalizeName(l.name) === nj)
    if (line) {
      usedLines.add(line.key)
      result.set(job.id, { jobId: job.id, lineKey: line.key, kind: 'same', score: 1 })
    }
  }

  // 2) near names, best score first
  const cands: { jobId: string; lineKey: string; score: number }[] = []
  for (const job of jobs) {
    if (result.has(job.id)) continue
    for (const line of lines) {
      if (usedLines.has(line.key)) continue
      const score = nameSimilarity(job.name, line.name)
      if (score >= NEAR_THRESHOLD) cands.push({ jobId: job.id, lineKey: line.key, score })
    }
  }
  cands.sort((a, b) => b.score - a.score)
  for (const c of cands) {
    if (result.has(c.jobId) || usedLines.has(c.lineKey)) continue
    usedLines.add(c.lineKey)
    result.set(c.jobId, { jobId: c.jobId, lineKey: c.lineKey, kind: 'near', score: c.score })
  }

  return jobs.map((j) => result.get(j.id) ?? { jobId: j.id, lineKey: null, kind: 'copy' as const, score: 0 })
}

/** For a line no job is paired to: the old job name it most resembles (or null). */
export function similarOldJob(line: HtcCandidateLine, jobs: HtcOldJob[]): { name: string; score: number } | null {
  let best: { name: string; score: number } | null = null
  for (const job of jobs) {
    const score = nameSimilarity(job.name, line.name)
    if (score >= DUPLICATE_THRESHOLD && (!best || score > best.score)) best = { name: job.name, score }
  }
  return best
}

// ---------------------------------------------------------------------------
// Plan sent to the database (house_type_change_apply)
// ---------------------------------------------------------------------------

export type HtcMove = { jobId: string; targetBoqId?: string; copyFromBoqId?: string; acceptNewQty?: boolean }
export type HtcNewJob = { boqId?: string; copyFromBoqId?: string }
export type HtcPlan = { plotId: string; newHouseModelId: string; moves: HtcMove[]; newJobs: HtcNewJob[] }

/** `seed:<id>` keys point at a line to COPY; plain keys are real lines. */
export function lineRef(key: string): { boqId?: string; copyFromBoqId?: string } {
  return key.startsWith('seed:') ? { copyFromBoqId: key.slice(5) } : { boqId: key }
}

export type HtcJobChoice =
  | { mode: 'copy' } // copy the job's own old line into the new type
  | { mode: 'line'; lineKey: string; useNewQty: boolean }

/**
 * Build the plan for one plot from the admin's choices.
 * - 'copy'                         -> copy_from_boq_id = the job's own old line
 * - 'line' with matching qty       -> move onto that line
 * - 'line' with differing qty      -> only when useNewQty; otherwise the old
 *                                     line is copied so the contract stays equal
 */
export function buildPlan(args: {
  plotId: string
  newHouseModelId: string
  jobs: (HtcOldJob & { oldLineId: string })[]
  lines: HtcCandidateLine[]
  choices: Record<string, HtcJobChoice>
  /** keys of new-type lines that should get a job with no contractor */
  newJobKeys: string[]
}): HtcPlan {
  const lineByKey = new Map(args.lines.map((l) => [l.key, l]))
  const moves: HtcMove[] = args.jobs.map((job) => {
    const choice = args.choices[job.id] ?? { mode: 'copy' as const }
    if (choice.mode === 'copy') return { jobId: job.id, copyFromBoqId: job.oldLineId }
    const line = lineByKey.get(choice.lineKey)
    if (!line) return { jobId: job.id, copyFromBoqId: job.oldLineId }
    const sameQty = Math.abs(line.qty - job.qty) < 0.0001
    if (!sameQty && !choice.useNewQty) return { jobId: job.id, copyFromBoqId: job.oldLineId }
    const ref = lineRef(line.key)
    return {
      jobId: job.id,
      ...(ref.boqId ? { targetBoqId: ref.boqId } : { copyFromBoqId: ref.copyFromBoqId }),
      acceptNewQty: !sameQty,
    }
  })
  const pairedKeys = new Set(
    args.jobs.flatMap((j) => {
      const c = args.choices[j.id]
      if (!c || c.mode !== 'line') return []
      const line = lineByKey.get(c.lineKey)
      if (!line) return []
      const sameQty = Math.abs(line.qty - j.qty) < 0.0001
      return sameQty || c.useNewQty ? [c.lineKey] : []
    })
  )
  const newJobs: HtcNewJob[] = args.newJobKeys.filter((k) => lineByKey.has(k) && !pairedKeys.has(k)).map((k) => lineRef(k))
  return { plotId: args.plotId, newHouseModelId: args.newHouseModelId, moves, newJobs }
}
