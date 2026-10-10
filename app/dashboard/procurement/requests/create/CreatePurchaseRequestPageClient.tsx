'use client'

import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { useToast } from '@/components/ui/Toast'
import PurchaseRequestForm from '@/components/procurement/PurchaseRequestForm'

const LIST = '/dashboard/procurement/requests'

export default function CreatePurchaseRequestPageClient() {
  const router = useRouter()
  const toast = useToast()

  return (
    <PageContainer width="form">
      <Breadcrumb items={[{ label: 'คำขอซื้อ (PR)', href: LIST }, { label: 'สร้างคำขอซื้อ' }]} />
      <PageHeader title="สร้างคำขอซื้อ" subtitle="เลือกโครงการ ระบุแปลงที่ใช้ และรายการวัสดุที่ต้องการ" />
      <Card className="p-5">
        <PurchaseRequestForm
          mode="create"
          onCancel={() => router.push(LIST)}
          onSaved={() => {
            toast.success('สร้างคำขอซื้อเรียบร้อยแล้ว')
            router.push(LIST)
            router.refresh()
          }}
        />
      </Card>
    </PageContainer>
  )
}
