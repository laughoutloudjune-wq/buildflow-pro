import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Card } from '@/components/ui/Card'

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

  return (
    <Card className="p-6">
      <h1 className="text-2xl font-bold text-slate-800">สร้างคำขอเบิก</h1>
      <p className="mt-2 text-sm text-slate-500">เลือกประเภทคำขอที่ต้องการสร้างได้เหมือนเดิม ระหว่างงวดงานหลักและงานเพิ่ม / DC</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Link
          href="/dashboard/foreman/request"
          className="rounded-xl border border-blue-200 bg-blue-50 p-5 transition hover:border-blue-300 hover:bg-blue-100/70"
        >
          <div className="text-lg font-bold text-blue-900">เบิกงวดงานหลัก</div>
          <p className="mt-2 text-sm text-blue-800">ใช้สำหรับส่งคำขอความคืบหน้างานหลักตาม BOQ และรายการงานที่มอบหมาย</p>
        </Link>

        <Link
          href="/dashboard/foreman/create-dc"
          className="rounded-xl border border-amber-200 bg-amber-50 p-5 transition hover:border-amber-300 hover:bg-amber-100/70"
        >
          <div className="text-lg font-bold text-amber-900">งานเพิ่ม / DC</div>
          <p className="mt-2 text-sm text-amber-800">ใช้สำหรับส่งคำขอ DC อย่างเดียวได้ แม้ไม่มีคำของานหลักในรอบนั้น</p>
        </Link>
      </div>
    </Card>
  )
}
