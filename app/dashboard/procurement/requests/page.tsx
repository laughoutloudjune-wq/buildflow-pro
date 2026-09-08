import { getPurchaseRequests } from '@/actions/procurement-actions'
import PurchaseRequestsPageClient from './PurchaseRequestsPageClient'

export default async function PurchaseRequestsPage() {
  let requests: Awaited<ReturnType<typeof getPurchaseRequests>> = []
  let initialError: string | null = null
  try {
    requests = await getPurchaseRequests()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลคำขอซื้อไม่สำเร็จ'
  }

  return <PurchaseRequestsPageClient requests={requests} initialError={initialError} />
}
