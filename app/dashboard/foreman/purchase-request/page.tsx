import { getMyPurchaseRequests } from '@/actions/foreman-purchase-requests'
import ForemanPurchaseRequestPageClient from './ForemanPurchaseRequestPageClient'

export default async function ForemanPurchaseRequestPage() {
  let requests: Awaited<ReturnType<typeof getMyPurchaseRequests>> = []
  let initialError: string | null = null
  try {
    requests = await getMyPurchaseRequests()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดรายการไม่สำเร็จ'
  }

  return <ForemanPurchaseRequestPageClient initialRequests={requests} initialError={initialError} />
}
