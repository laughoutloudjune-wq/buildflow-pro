'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/PageHeader'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { PageContainer } from '@/components/ui/PageContainer'
import { useToast } from '@/components/ui/Toast'
import PurchaseRequestDetail from '@/components/procurement/PurchaseRequestDetail'
import type { PurchaseRequest } from '@/lib/types/procurement'

export default function PurchaseRequestDetailPageClient({
  request,
  initialError,
}: {
  request: PurchaseRequest | null
  initialError?: string | null
}) {
  const router = useRouter()
  const toast = useToast()

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  if (!request) {
    return <div className="py-16 text-center text-slate-500">ไม่พบคำขอซื้อนี้</div>
  }

  return (
    <PageContainer width="form">
      <div>
        <Breadcrumb
          items={[
            { label: 'คำขอซื้อ (PR)', href: '/dashboard/procurement/requests' },
            { label: `#${String(request.pr_no).padStart(4, '0')}` },
          ]}
        />
        <PageHeader title={`คำขอซื้อ #${String(request.pr_no).padStart(4, '0')}`} />
      </div>

      <PurchaseRequestDetail request={request} onChanged={() => router.refresh()} />
    </PageContainer>
  )
}
