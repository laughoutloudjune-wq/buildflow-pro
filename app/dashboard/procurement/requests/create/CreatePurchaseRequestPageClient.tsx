'use client'

import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import PurchaseRequestForm from '@/components/procurement/PurchaseRequestForm'
import type { PurchasePurpose } from '@/components/procurement/PurchasePurposePicker'

const LIST = '/dashboard/procurement/requests'

export default function CreatePurchaseRequestPageClient({
  initialPurpose,
  initialLines,
  initialScope,
}: {
  initialPurpose?: PurchasePurpose
  initialLines?: { material_type_id: number; quantity: number }[]
  initialScope?: { projectId: string; plotIds: string[] }
}) {
  const router = useRouter()

  return (
    <PageContainer width="form">
      <Breadcrumb items={[{ label: 'คำขอซื้อ (PR)', href: LIST }, { label: 'สร้างคำขอซื้อ' }]} />
      <PageHeader title="สร้างคำขอซื้อ" subtitle="เลือกว่าซื้อเพื่ออะไร ระบุโครงการ/แปลงถ้ามี และรายการวัสดุที่ต้องการ" />
      <Card className="p-5">
        <PurchaseRequestForm
          mode="create"
          initialPurpose={initialPurpose}
          initialLines={initialLines}
          initialScope={initialScope}
          onCancel={() => router.push(LIST)}
          onSaved={(result) => {
            // The form already showed the success toast; open the new request in the work window.
            router.push(`/dashboard/procurement/work?open=PR:${result.id}`)
          }}
        />
      </Card>
    </PageContainer>
  )
}
