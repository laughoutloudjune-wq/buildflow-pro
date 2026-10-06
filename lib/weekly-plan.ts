export type WeeklyPlanKind = 'main' | 'dc' | 'other' | 'inspect'
export type WeeklyPlanStatus = 'planned' | 'done'

export const WEEKLY_PLAN_KINDS: { value: WeeklyPlanKind; label: string }[] = [
  { value: 'main', label: 'งานหลัก' },
  { value: 'dc', label: 'DC' },
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
