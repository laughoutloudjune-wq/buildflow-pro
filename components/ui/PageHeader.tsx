'use client'

import * as React from "react"
import { cn } from "@/lib/utils"
import { useDepartment } from "@/components/layout/DepartmentContext"

export interface PageHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

/**
 * Page title block. Above the title it shows the owning department as a small
 * eyebrow with a slim accent rule, so every page of a department carries the
 * same cue. The accent is identity only; the actions stay indigo.
 */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  const { label, theme } = useDepartment()
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <div aria-hidden className={cn("mb-2 h-[3px] w-10 rounded-full", theme.solid)} />
        {label && <p className={cn("mb-0.5 text-xs font-semibold", theme.text)}>{label}</p>}
        <h1 className="break-words text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[26px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 sm:text-[15px]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
