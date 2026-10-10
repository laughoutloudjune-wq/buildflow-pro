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
  PenTool,
  Tag,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { getThemeByDepartmentId, type DepartmentId } from '@/lib/navigation'

type SettingsLink = {
  href: string
  label: string
  description: string
  icon: LucideIcon
}

type SettingsGroup = {
  title: string
  department: DepartmentId
  description: string
  links: SettingsLink[]
}

// Every setting is grouped by which module it actually serves, and every
// setting is its own page - this used to be a flat card grid plus a
// separate tab bar with two forms bolted directly onto this index page,
// which meant half the settings followed a different navigation pattern
// than the other half. One consistent pattern now: this page only links out.
const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: 'จัดซื้อ',
    department: 'procurement',
    description: 'ข้อมูลที่ใช้ในคำขอซื้อและใบสั่งซื้อ',
    links: [
      { href: '/dashboard/settings/suppliers', label: 'ผู้จำหน่าย', description: 'จัดการรายชื่อผู้จำหน่ายวัสดุ', icon: Truck },
      { href: '/dashboard/settings/companies', label: 'บริษัทในเครือ', description: 'รายชื่อนิติบุคคล โลโก้ และลายเซ็นที่ใช้ซื้อวัสดุ', icon: Landmark },
      { href: '/dashboard/settings/materials', label: 'รายการวัสดุ', description: 'จัดการชื่อ หน่วย และราคาวัสดุที่ใช้อ้างอิง', icon: Boxes },
    ],
  },
  {
    title: 'ผู้รับเหมาและงานเบิกจ่าย',
    department: 'construction',
    description: 'ข้อมูลที่ใช้ในใบเบิกและงานผู้รับเหมา',
    links: [
      { href: '/dashboard/settings/contractor-types', label: 'ประเภทผู้รับเหมา', description: 'จัดการประเภทช่างที่ใช้ในระบบ', icon: Hammer },
      { href: '/dashboard/settings/billing-info', label: 'ข้อมูลใบเบิก', description: 'ชื่อบริษัทและเลขผู้เสียภาษีบนหัวกระดาษใบเบิก', icon: Building2 },
      { href: '/dashboard/settings/financial-defaults', label: 'ค่าเริ่มต้นทางการเงิน', description: 'VAT, หัก ณ ที่จ่าย, เงินประกันผลงานเริ่มต้น', icon: Banknote },
    ],
  },
  {
    title: 'ระบบ',
    department: 'admin',
    description: 'ผู้ใช้งานและสิทธิ์การเข้าถึง',
    links: [
      { href: '/dashboard/settings/users', label: 'ผู้ใช้และบทบาท', description: 'กำหนดบทบาท Admin / PM / Foreman ของแต่ละคน', icon: Users },
      { href: '/dashboard/settings/permissions', label: 'สิทธิ์ตามบทบาท', description: 'กำหนดว่าแต่ละตำแหน่งเข้าโมดูลไหนได้', icon: ShieldCheck },
    ],
  },
  {
    title: 'ฝ่ายขาย',
    department: 'sales',
    description: 'ตั้งค่าที่ใช้ในผังการขาย',
    links: [
      { href: '/dashboard/settings/sale-statuses', label: 'สถานะการขาย', description: 'เพิ่ม เปลี่ยนชื่อ และสีของสถานะบนผังการขาย', icon: Tag },
    ],
  },
  {
    title: 'เอกสารพิมพ์',
    department: 'admin',
    description: 'รูปแบบช่องเซ็นชื่อบนเอกสารที่พิมพ์ได้',
    links: [
      { href: '/dashboard/settings/signatures', label: 'ลายเซ็นในเอกสาร', description: 'จำนวน ป้ายชื่อ และรูปลายเซ็นของ PR, PO และใบเบิกงวดงาน', icon: PenTool },
    ],
  },
]

export default function SettingsPage() {
  return (
    <PageContainer width="standard">
      <PageHeader title="ตั้งค่าระบบ" subtitle="ข้อมูลบริษัท ค่าเริ่มต้นทางบัญชี การจัดการผู้ใช้ และการตั้งค่าทั้งหมดของระบบ" />

      <div className="space-y-5">
        {SETTINGS_GROUPS.map((group) => {
          const theme = getThemeByDepartmentId(group.department)
          return (
          <section key={group.title} aria-label={group.title}>
            <div className="mb-2 flex items-baseline gap-2">
              <span aria-hidden className={`h-2 w-2 shrink-0 self-center rounded-full ${theme.solid}`} />
              <h2 className="text-sm font-semibold text-slate-800">{group.title}</h2>
              <span className="text-xs text-slate-500">{group.description}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {group.links.map((link) => {
                const Icon = link.icon
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50/60"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${theme.soft}`}>
                        <Icon className="h-5 w-5" aria-hidden />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{link.label}</div>
                        <div className="text-xs text-slate-500">{link.description}</div>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-slate-400 transition-colors group-hover:text-slate-600" aria-hidden />
                  </Link>
                )
              })}
            </div>
          </section>
          )
        })}
      </div>
    </PageContainer>
  )
}
