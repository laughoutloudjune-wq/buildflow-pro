import { getBillingsByCreator } from '@/actions/billing-actions'
import ForemanHistoryPageClient from './ForemanHistoryPageClient'

export default async function ForemanHistoryPage() {
  let billings: Awaited<ReturnType<typeof getBillingsByCreator>> = []
  let initialError: string | null = null
  try {
    billings = await getBillingsByCreator()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดรายการไม่สำเร็จ'
  }

  return <ForemanHistoryPageClient initialBillings={billings} initialError={initialError} />
}
