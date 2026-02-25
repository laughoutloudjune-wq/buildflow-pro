'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/Card'

export default function CreateProgressPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get('editId')

  useEffect(() => {
    if (editId) {
      router.replace(`/dashboard/billing/request?editId=${editId}`)
    }
  }, [editId, router])

  return (
    <Card className="p-6">
      <h1 className="text-2xl font-bold text-slate-800">สร้างใบขอเบิกงวดงานหลัก</h1>
      <p className="text-sm text-slate-500 mt-2">หน้านี้ใช้สำหรับเบิกตามความคืบหน้างานก่อสร้างหลัก</p>
      <div className="mt-4 flex items-center gap-3">
        <Link href="/dashboard/billing/request" className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
          ไปหน้าแบบฟอร์มเบิกงวด
        </Link>
        <Link href="/dashboard/foreman/create-dc" className="px-4 py-2 rounded-md bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700">
          ไปหน้าสร้างงานเพิ่ม (DC)
        </Link>
      </div>
    </Card>
  )
}
