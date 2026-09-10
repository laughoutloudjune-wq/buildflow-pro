import { getPurchaseRequestById } from '@/actions/procurement-actions'
import PurchaseRequestDetailPageClient from './PurchaseRequestDetailPageClient'

/** Direct/deep-link entry point (e.g. from a notification) - fetches its own
 * data server-side. Coming from the requests list instead skips this page
 * entirely: see PurchaseRequestsPageClient, which opens the same
 * PurchaseRequestDetail body in a modal using data it already has, with no
 * fetch or navigation. */
export default async function PurchaseRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let request: Awaited<ReturnType<typeof getPurchaseRequestById>> = null
  let initialError: string | null = null
  try {
    request = await getPurchaseRequestById(id)
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดคำขอซื้อไม่สำเร็จ'
  }

  return <PurchaseRequestDetailPageClient request={request} initialError={initialError} />
}
