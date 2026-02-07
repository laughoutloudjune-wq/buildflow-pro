import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { ClipboardCheck, ClipboardPlus, History } from 'lucide-react'

export default function ForemanHomePage() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card className="p-6 hover:shadow-md transition">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold">เบิกงวดงานหลัก</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">เบิกตามความคืบหน้าของงานหลัก พร้อมตรวจยอดคงเหลือ</p>
        <Link href="/dashboard/foreman/create-progress" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
          สร้างใบขอเบิกงวด
        </Link>
      </Card>

      <Card className="p-6 border-amber-200 bg-amber-50/40 hover:shadow-md transition">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
            <ClipboardPlus className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold">งานเพิ่ม / DC</h2>
        </div>
        <p className="text-sm text-amber-700/80 mb-4">บันทึกงานเพิ่มพร้อมเหตุผล รูปหน้างาน และรายการค่าใช้จ่าย</p>
        <Link href="/dashboard/foreman/create-dc" className="text-sm font-semibold text-amber-700 hover:text-amber-800">
          สร้างคำของานเพิ่ม
        </Link>
      </Card>

      <Card className="p-6 hover:shadow-md transition">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
            <History className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold">ประวัติคำขอ</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">ติดตามสถานะคำขอทั้งหมดที่คุณส่ง</p>
        <Link href="/dashboard/foreman/history" className="text-sm font-semibold text-slate-700 hover:text-slate-900">
          เปิดรายการคำขอ
        </Link>
      </Card>
    </div>
  )
}
