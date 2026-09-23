import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// `new Date().toISOString().slice(0, 10)` gives the UTC date, which is
// yesterday's date in Thailand until 07:00 local time - Vercel runs in UTC,
// and even client-side this keeps every "today" consistent regardless of the
// visitor's own machine clock/timezone. Use this (and monthRangeInBangkok
// below) anywhere "today" means the business day in Thailand: PO/RI/receipt
// numbering, due-date defaults, overdue checks, dashboard month ranges.
const BANGKOK_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Today's date in Asia/Bangkok, as YYYY-MM-DD. */
export function todayInBangkok(): string {
  return BANGKOK_DATE_FORMATTER.format(new Date())
}

/** [start, end) of the given month (or the current Bangkok month, if
 * omitted) as YYYY-MM-DD dates - end is exclusive (the 1st of the next
 * month), so callers filter with `>= start and < end` rather than juggling
 * each month's actual last day. */
export function monthRangeInBangkok(monthStart?: string): { start: string; end: string } {
  const base = monthStart ? `${monthStart.slice(0, 7)}-01` : todayInBangkok()
  const [year, month] = base.split('-').map(Number)
  const start = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const end = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`
  return { start, end }
}