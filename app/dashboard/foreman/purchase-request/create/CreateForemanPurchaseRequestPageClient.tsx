'use client'

import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { useToast } from '@/components/ui/Toast'
import PurchaseRequestForm from '@/components/procurement/PurchaseRequestForm'
import { createForemanPurchaseRequest } from '@/actions/foreman-purchase-requests'

const LIST = '/dashboard/foreman/purchase-request'

export default function CreateForemanPurchaseRequestPageClient() {
  const router = useRouter()
  const toast = useToast()

  return (
    <PageContainer width="form">
      <Breadcrumb items={[{ label: 'คำขอซื้อวัสดุ', href: LIST }, { label: 'สร้างคำขอซื้อวัสดุ' }]} />
      <PageHeader title="สร้างคำขอซื้อวัสดุ" subtitle="เลือกโครงการ ระบุแปลงที่ใช้ และรายการวัสดุที่ต้องการ" />
      <Card className="p-5">
        <PurchaseRequestForm
          mode="create"
          createAction={createForemanPurchaseRequest}
          onCancel={() => router.push(LIST)}
          onSaved={() => {
            toast.success('ส่งคำขอซื้อวัสดุเรียบร้อยแล้ว')
            router.push(LIST)
            router.refresh()
          }}
        />
      </Card>
    </PageContainer>
  )
}
