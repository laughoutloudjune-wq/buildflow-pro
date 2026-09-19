// Status colours come from the database (sale_statuses.color), but Tailwind
// generates class names by scanning source at build time - `bg-${color}-100`
// produces no CSS. Every class string a status can resolve to is therefore
// written out in full here, and `color` only ever stores one of these keys
// (SALES_MODULE_PLAN.md §8.1). If an admin needs a colour outside this list,
// add a key here first - never let the DB hold an arbitrary hex/Tailwind name.
export const STATUS_COLOR_KEYS = [
  'slate', 'zinc', 'amber', 'blue', 'indigo', 'sky', 'orange', 'rose', 'violet', 'emerald', 'red',
] as const

export type StatusColorKey = (typeof STATUS_COLOR_KEYS)[number]

export const STATUS_COLORS: Record<StatusColorKey, { chip: string; dot: string; ring: string }> = {
  slate:   { chip: 'bg-slate-100 text-slate-700 ring-slate-200',     dot: 'bg-slate-400',   ring: 'ring-slate-300' },
  zinc:    { chip: 'bg-zinc-100 text-zinc-700 ring-zinc-200',        dot: 'bg-zinc-400',    ring: 'ring-zinc-300' },
  amber:   { chip: 'bg-amber-100 text-amber-800 ring-amber-200',     dot: 'bg-amber-500',   ring: 'ring-amber-300' },
  blue:    { chip: 'bg-blue-100 text-blue-800 ring-blue-200',        dot: 'bg-blue-500',    ring: 'ring-blue-300' },
  indigo:  { chip: 'bg-indigo-100 text-indigo-800 ring-indigo-200',  dot: 'bg-indigo-500',  ring: 'ring-indigo-300' },
  sky:     { chip: 'bg-sky-100 text-sky-800 ring-sky-200',           dot: 'bg-sky-500',     ring: 'ring-sky-300' },
  orange:  { chip: 'bg-orange-100 text-orange-800 ring-orange-200',  dot: 'bg-orange-500',  ring: 'ring-orange-300' },
  rose:    { chip: 'bg-rose-100 text-rose-800 ring-rose-200',        dot: 'bg-rose-500',    ring: 'ring-rose-300' },
  violet:  { chip: 'bg-violet-100 text-violet-800 ring-violet-200',  dot: 'bg-violet-500',  ring: 'ring-violet-300' },
  emerald: { chip: 'bg-emerald-100 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-500', ring: 'ring-emerald-300' },
  red:     { chip: 'bg-red-100 text-red-800 ring-red-200',           dot: 'bg-red-500',     ring: 'ring-red-300' },
}

export function statusColorClasses(color: string | null | undefined) {
  const key = (color && color in STATUS_COLORS ? color : 'slate') as StatusColorKey
  return STATUS_COLORS[key]
}
