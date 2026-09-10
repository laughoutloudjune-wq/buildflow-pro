'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
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
    return <div className="py-16 text-center text-slate-400">ไม่พบคำขอซื้อนี้</div>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/dashboard/procurement/requests"
          className="mb-2 flex w-fit items-center gap-1 text-sm text-slate-500 transition hover:text-indigo-600"
        >
          <ArrowLeft className="h-4 w-4" /> กลับไปรายการคำขอซื้อ
        </Link>
        <PageHeader title={`คำขอซื้อ #${String(request.pr_no).padStart(4, '0')}`} />
      </div>

      <PurchaseRequestDetail request={request} onChanged={() => router.refresh()} />
    </div>
  )
}
