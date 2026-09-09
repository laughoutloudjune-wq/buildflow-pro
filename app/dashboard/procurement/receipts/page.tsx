import { getGoodsReceipts } from '@/actions/procurement-actions'
import ReceiptsPageClient from './ReceiptsPageClient'

export default async function ReceiptsPage() {
  let receipts: Awaited<ReturnType<typeof getGoodsReceipts>> = []
  let initialError: string | null = null
  try {
    receipts = await getGoodsReceipts()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดใบรับสินค้าไม่สำเร็จ'
  }

  return <ReceiptsPageClient receipts={receipts} initialError={initialError} />
}
