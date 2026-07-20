import * as React from "react"
import { cn } from "@/lib/utils"

type Tone = "success" | "warning" | "danger" | "info" | "neutral"

const toneClasses: Record<Tone, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone = "neutral", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        toneClasses[tone],
        className
      )}
      {...props}
    />
  )
)
Badge.displayName = "Badge"

export function statusTone(status: string): Tone {
  const s = status?.toLowerCase?.() || ""
  if (["approved", "paid", "success", "completed", "active"].includes(s)) return "success"
  if (["rejected", "cancelled", "canceled", "overdue", "failed", "high"].includes(s)) return "danger"
  if (["pending", "pending_review", "warning", "medium", "in_progress"].includes(s)) return "warning"
  if (["low", "info"].includes(s)) return "info"
  return "neutral"
}
