export type WeeklyPlanKind = 'main' | 'dc' | 'other' | 'inspect' | 'repair'
export type WeeklyPlanStatus = 'planned' | 'done'

export const WEEKLY_PLAN_KINDS: { value: WeeklyPlanKind; label: string }[] = [
  { value: 'main', label: 'งานหลัก' },
  { value: 'dc', label: 'DC' },
  { value: 'repair', label: 'งานซ่อม' },
  { value: 'other', label: 'งานอื่นๆ' },
  { value: 'inspect', label: 'ตรวจบ้าน' },
]

const DAY_MS = 24 * 60 * 60 * 1000

function parse(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getTime()
}

function fmt(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDaysStr(dateStr: string, days: number): string {
  return fmt(parse(dateStr) + days * DAY_MS)
}

/** Monday (YYYY-MM-DD) of the week containing the given date. */
export function mondayOf(dateStr: string): string {
  const ms = parse(dateStr)
  const dow = new Date(ms).getUTCDay() // 0 = Sunday
  const diff = dow === 0 ? -6 : 1 - dow
  return fmt(ms + diff * DAY_MS)
}

export function isMonday(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && new Date(`${dateStr}T00:00:00Z`).getUTCDay() === 1
}

/** Mondays of every week that overlaps the month of `dateStr`. */
export function weeksOfMonth(dateStr: string): string[] {
  const first = `${dateStr.slice(0, 7)}-01`
  const [y, m] = first.split('-').map(Number)
  const nextFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  const weeks: string[] = []
  let cur = mondayOf(first)
  while (cur < nextFirst) {
    weeks.push(cur)
    cur = addDaysStr(cur, 7)
  }
  return weeks
}

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

export function formatThaiDay(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number)
  return `${d} ${THAI_MONTHS[m - 1]}`
}

export function formatWeekRange(weekStart: string): string {
  return `${formatThaiDay(weekStart)} - ${formatThaiDay(addDaysStr(weekStart, 6))}`
}

export function formatThaiMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number)
  return `${THAI_MONTHS[m - 1]} ${y + 543}`
}

/** Mon..Sun, the columns of the Excel weekly report. */
export const WEEK_DAY_LABELS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']

/**
 * Plots matching a typed selection like "103-107, 120, 125-127" by name.
 * Only plots whose name is a plain number take part in ranges; anything else
 * (e.g. "R2", "ส่วนกลาง") matches by exact name. Returns matching plot ids.
 */
export function plotIdsFromRangeText(text: string, plots: { id: string; name: string }[]): string[] {
  const ids = new Set<string>()
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)-(\d+)$/)
    if (m) {
      const lo = Math.min(Number(m[1]), Number(m[2]))
      const hi = Math.max(Number(m[1]), Number(m[2]))
      for (const p of plots) {
        if (/^\d+$/.test(p.name.trim())) {
          const n = Number(p.name)
          if (n >= lo && n <= hi) ids.add(p.id)
        }
      }
    } else {
      for (const p of plots) if (p.name.trim() === part) ids.add(p.id)
    }
  }
  return [...ids]
}

/** Straight-line PLAN per day from last week's carried-over % to a target. */
export function linearPlan(carry: number, target: number): number[] {
  return Array.from({ length: 7 }, (_, i) => Math.round((carry + ((target - carry) * (i + 1)) / 7) * 10) / 10)
}

type DailyPct = { planPct: (number | null)[]; actualPct: (number | null)[] }

const round1 = (n: number) => Math.round(n * 10) / 10

/** Average PLAN and ACTUAL % for each day Mon..Sun over the items that have a value that day. */
export function dailyAverages(items: DailyPct[]): { plan: (number | null)[]; actual: (number | null)[] } {
  const avg = (pick: (i: DailyPct) => (number | null)[]) =>
    Array.from({ length: 7 }, (_, d) => {
      const vals = items.map((i) => pick(i)[d]).filter((v): v is number => v != null)
      return vals.length === 0 ? null : round1(vals.reduce((a, b) => a + b, 0) / vals.length)
    })
  return { plan: avg((i) => i.planPct), actual: avg((i) => i.actualPct) }
}

/** Latest filled-in value of a Mon..Sun % row, with the day index it came from. */
export function latestPct(values: (number | null)[]): { value: number; day: number } | null {
  for (let d = values.length - 1; d >= 0; d--) {
    const v = values[d]
    if (v != null) return { value: v, day: d }
  }
  return null
}

/** True when the latest ACTUAL is below the PLAN for the same day (or the latest plan before it). */
export function isBehindPlan(item: DailyPct): boolean {
  const actual = latestPct(item.actualPct)
  if (!actual) return false
  let plan: number | null = null
  for (let d = actual.day; d >= 0; d--) {
    if (item.planPct[d] != null) {
      plan = item.planPct[d]
      break
    }
  }
  return plan != null && actual.value + 0.5 < plan
}

type Groupable = {
  kind: string
  title: string
  contractorId: string | null
  ownerId: string | null
  weekStart: string
  jobAssignmentId: string | null
}

/**
 * Display grouping for batch-created plans: items with the same task type,
 * title, contractor, owner and week (BOQ and manual kept apart) become one
 * group, in first-seen order. The data itself stays one row per plot.
 */
export function groupPlanItems<T extends Groupable>(items: T[]): T[][] {
  const groups = new Map<string, T[]>()
  for (const i of items) {
    const key = [i.kind, i.jobAssignmentId ? 'boq' : 'manual', i.title, i.contractorId ?? '', i.ownerId ?? '', i.weekStart].join('|')
    const g = groups.get(key)
    if (g) g.push(i)
    else groups.set(key, [i])
  }
  return [...groups.values()]
}

/** "103, 104, 105, 107, R2" -> "103–105, 107, R2". Numeric names collapse into ranges. */
export function compressPlotNames(names: string[]): string {
  const nums = names.filter((n) => /^\d+$/.test(n.trim())).map(Number).sort((a, b) => a - b)
  const others = names.filter((n) => !/^\d+$/.test(n.trim())).sort((a, b) => a.localeCompare(b, 'th'))
  const parts: string[] = []
  for (let i = 0; i < nums.length; ) {
    let j = i
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++
    parts.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]))
    i = j + 1
  }
  return [...parts, ...others].join(', ')
}
