import * as React from "react"
import { cn } from "@/lib/utils"

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Clickable card: one shared hover border/shadow and a keyboard focus ring. */
  interactive?: boolean
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, interactive, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-2xl border border-slate-200/70 bg-white text-slate-950 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.9)]",
      interactive &&
        "cursor-pointer transition-[border-color,box-shadow] duration-[120ms] hover:border-slate-300 hover:shadow-[0_2px_4px_rgba(0,0,0,0.05),0_12px_28px_-12px_rgba(0,0,0,0.16),inset_0_1px_0_rgba(255,255,255,0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50",
      className
    )}
    {...props}
  />
))
Card.displayName = "Card"

export { Card }