'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { getPurchaseRequestById } from '@/actions/procurement-actions'
import PurchaseRequestDetail from '@/components/procurement/PurchaseRequestDetail'
import type { PurchaseRequest } from '@/lib/types/procurement'

/** Direct/deep-link entry point (e.g. from a notification) - has no
 * preloaded data, so it fetches for itself and shows a spinner while doing
 * so. Coming from the requests list instead skips this page entirely: see
 * PurchaseRequestsPageClient, which opens the same PurchaseRequestDetail
 * body in a modal using data it already has, with no fetch or navigation. */
export default function PurchaseRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [request, setRequest] = useState<PurchaseRequest | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const toast = useToast()

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function load() {
    setIsLoading(true)
    try {
      setRequest(await getPurchaseRequestById(id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดคำขอซื้อไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดคำขอซื้อ...</p>
      </div>
    )
  }

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

      <PurchaseRequestDetail request={request} onChanged={load} />
    </div>
  )
}
