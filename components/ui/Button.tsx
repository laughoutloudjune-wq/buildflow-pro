import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"

type Variant = "primary" | "secondary" | "ghost" | "danger"
type Size = "sm" | "md"

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-indigo-600 text-white shadow-[0_1px_1px_rgba(0,0,0,0.05),0_4px_10px_-4px_rgba(79,70,229,0.5)] hover:bg-indigo-700 disabled:bg-indigo-300 disabled:shadow-none",
  secondary:
    "border border-slate-200 bg-white text-slate-700 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-slate-50 disabled:text-slate-400 disabled:bg-slate-50",
  ghost:
    "text-slate-600 hover:bg-slate-900/5 disabled:text-slate-300",
  danger:
    "bg-red-600 text-white shadow-[0_1px_1px_rgba(0,0,0,0.05),0_4px_10px_-4px_rgba(220,38,38,0.5)] hover:bg-red-700 disabled:bg-red-300 disabled:shadow-none",
}

const sizeClasses: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
}

const baseClasses =
  "inline-flex items-center justify-center rounded-[10px] font-medium transition-all duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    />
  )
)
Button.displayName = "Button"

export interface ButtonLinkProps extends React.ComponentProps<typeof Link> {
  variant?: Variant
  size?: Size
}

export const ButtonLink = React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <Link
      ref={ref}
      className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    />
  )
)
ButtonLink.displayName = "ButtonLink"
