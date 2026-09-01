'use client'

import Link from 'next/link'
import {
  Building2,
  Banknote,
  Users,
  Hammer,
  ShieldCheck,
  ChevronRight,
  Boxes,
  Truck,
  Landmark,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'

type SettingsLink = {
  href: string
  label: string
  description: string
  icon: LucideIcon
  tone: 'amber' | 'indigo' | 'emerald' | 'sky' | 'violet' | 'rose'
}

type SettingsGroup = {
  title: string
  description: string
  links: SettingsLink[]
}

const TONE_CLASSES: Record<SettingsLink['tone'], { chip: string; hover: string; hoverIcon: string }> = {
  amber: { chip: 'bg-amber-100 text-amber-700', hover: 'hover:border-amber-200 hover:bg-amber-50/50', hoverIcon: 'group-hover:text-amber-600' },
  indigo: { chip: 'bg-indigo-100 text-indigo-700', hover: 'hover:border-indigo-200 hover:bg-indigo-50/50', hoverIcon: 'group-hover:text-indigo-600' },
  emerald: { chip: 'bg-emerald-100 text-emerald-700', hover: 'hover:border-emerald-200 hover:bg-emerald-50/50', hoverIcon: 'group-hover:text-emerald-600' },
  sky: { chip: 'bg-sky-100 text-sky-700', hover: 'hover:border-sky-200 hover:bg-sky-50/50', hoverIcon: 'group-hover:text-sky-600' },
  violet: { chip: 'bg-violet-100 text-violet-700', hover: 'hover:border-violet-200 hover:bg-violet-50/50', hoverIcon: 'group-hover:text-violet-600' },
  rose: { chip: 'bg-rose-100 text-rose-700', hover: 'hover:border-rose-200 hover:bg-rose-50/50', hoverIcon: 'group-hover:text-rose-600' },
}

// Every setting is grouped by which module it actually serves, and every
// setting is its own page - this used to be a flat card grid plus a
// separate tab bar with two forms bolted directly onto this index page,
// which meant half the settings followed a different navigation pattern
// than the other half. One consistent pattern now: this page only links out.
const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: 'จัดซื้อ',
    description: 'ข้อมูลที่ใช้ในใบขอซื้อและใบสั่งซื้อ',
    links: [
      { href: '/dashboard/settings/suppliers', label: 'ผู้จำหน่าย', description: 'จัดการรายชื่อผู้จำหน่ายวัสดุ', icon: Truck, tone: 'sky' },
      { href: '/dashboard/settings/companies', label: 'บริษัทในเครือ', description: 'รายชื่อนิติบุคคล โลโก้ และลายเซ็นที่ใช้ซื้อวัสดุ', icon: Landmark, tone: 'violet' },
      { href: '/dashboard/settings/materials', label: 'รายการวัสดุ', description: 'จัดการชื่อ หน่วย และราคาวัสดุที่ใช้อ้างอิง', icon: Boxes, tone: 'emerald' },
    ],
  },
  {
    title: 'ผู้รับเหมาและงานเบิกจ่าย',
    description: 'ข้อมูลที่ใช้ในใบเบิกและงานผู้รับเหมา',
    links: [
      { href: '/dashboard/settings/contractor-types', label: 'ประเภทผู้รับเหมา', description: 'จัดการประเภทช่างที่ใช้ในระบบ', icon: Hammer, tone: 'amber' },
      { href: '/dashboard/settings/billing-info', label: 'ข้อมูลใบเบิก', description: 'ชื่อบริษัทและเลขผู้เสียภาษีบนหัวกระดาษใบเบิก', icon: Building2, tone: 'rose' },
      { href: '/dashboard/settings/financial-defaults', label: 'ค่าเริ่มต้นทางการเงิน', description: 'VAT, หัก ณ ที่จ่าย, เงินประกันผลงานเริ่มต้น', icon: Banknote, tone: 'emerald' },
    ],
  },
  {
    title: 'ระบบ',
    description: 'ผู้ใช้งานและสิทธิ์การเข้าถึง',
    links: [
      { href: '/dashboard/settings/users', label: 'ผู้ใช้และบทบาท', description: 'กำหนดบทบาท Admin / PM / Foreman ของแต่ละคน', icon: Users, tone: 'indigo' },
      { href: '/dashboard/settings/permissions', label: 'สิทธิ์ตามบทบาท', description: 'กำหนดว่าแต่ละตำแหน่งเข้าโมดูลไหนได้', icon: ShieldCheck, tone: 'indigo' },
    ],
  },
]

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="ตั้งค่าระบบ" subtitle="ข้อมูลบริษัท ค่าเริ่มต้นทางบัญชี การจัดการผู้ใช้ และการตั้งค่าทั้งหมดของระบบ" />

      <div className="space-y-5">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-slate-700">{group.title}</h2>
              <span className="text-xs text-slate-400">{group.description}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {group.links.map((link) => {
                const Icon = link.icon
                const tone = TONE_CLASSES[link.tone]
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`group flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition ${tone.hover}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone.chip}`}>
                        <Icon className="h-5 w-5" aria-hidden />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{link.label}</div>
                        <div className="text-xs text-slate-500">{link.description}</div>
                      </div>
                    </div>
                    <ChevronRight className={`h-5 w-5 text-slate-400 transition ${tone.hoverIcon}`} aria-hidden />
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
