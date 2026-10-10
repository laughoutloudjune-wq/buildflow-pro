import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, ClipboardCheck, ClipboardPlus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { getThemeByDepartmentId } from '@/lib/navigation'

const CHOICES = [
  {
    href: '/dashboard/foreman/request',
    title: 'เบิกงวดงานหลัก',
    description: 'ส่งความคืบหน้างานหลักตาม BOQ และรายการงานที่มอบหมาย',
    icon: ClipboardCheck,
  },
  {
    href: '/dashboard/foreman/create-dc',
    title: 'งานเพิ่ม (DC)',
    description: 'ส่งคำขอ DC อย่างเดียวได้ แม้ไม่มีงานหลักในรอบนั้น',
    icon: ClipboardPlus,
  },
]

export default async function CreateProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string }>
}) {
  const params = await searchParams
  const editId = params?.editId

  if (editId) {
    redirect(`/dashboard/foreman/request?editId=${editId}`)
  }

  const theme = getThemeByDepartmentId('construction')

  return (
    <div className="space-y-5">
      <PageHeader title="สร้างคำขอเบิก" subtitle="เลือกประเภทคำขอที่ต้องการสร้าง" />

      <div className="grid gap-4 md:grid-cols-2">
        {CHOICES.map((c) => (
          <Link key={c.href} href={c.href} className="group block">
            <Card interactive className="flex min-h-[7rem] items-center gap-4 p-5">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${theme.soft}`}>
                <c.icon className="h-6 w-6" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold text-slate-900">{c.title}</div>
                <p className="mt-1 text-sm text-slate-500">{c.description}</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-slate-400 transition-colors group-hover:text-slate-600" aria-hidden />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
