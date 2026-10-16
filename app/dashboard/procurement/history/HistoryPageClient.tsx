'use client'

import Link from 'next/link'
import { PageContainer } from '@/components/ui/PageContainer'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import DocumentHistoryList from '@/components/procurement/DocumentHistoryList'
import type { HistoryEntry } from '@/lib/procurement/documentHistory'
import { cn } from '@/lib/utils'

export default function HistoryPageClient({
  entries,
  initialError,
  onlyDestructive,
}: {
  entries: HistoryEntry[]
  initialError: string | null
  onlyDestructive: boolean
}) {
  const tabs = [
    { href: '/dashboard/procurement/history', label: 'ทั้งหมด', active: !onlyDestructive },
    { href: '/dashboard/procurement/history?only=destructive', label: 'ลบ / ยกเลิก / ย้อนกลับ', active: onlyDestructive },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="ประวัติเอกสาร"
        subtitle="ทุกการสร้าง แก้ไข ลบ และยกเลิกของคำขอซื้อ ใบสั่งซื้อ ใบรับสินค้า และใบสำคัญจ่าย - 100 รายการล่าสุด"
      />

      <div className="flex gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              tab.active ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <Card className="p-4">
        {initialError ? (
          <p className="text-sm text-rose-600">{initialError}</p>
        ) : (
          <DocumentHistoryList entries={entries} emptyText="ยังไม่มีประวัติ (ระบบเริ่มเก็บประวัติตั้งแต่ 16 ต.ค. 2569)" />
        )}
      </Card>
    </PageContainer>
  )
}
