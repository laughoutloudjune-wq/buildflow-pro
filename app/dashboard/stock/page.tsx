import { getStockOverview } from '@/actions/stock-actions'
import StockOverviewPageClient from './StockOverviewPageClient'

export default async function StockOverviewPage() {
  let rows: Awaited<ReturnType<typeof getStockOverview>> = []
  let initialError: string | null = null
  try {
    rows = await getStockOverview()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลสต็อกไม่สำเร็จ'
  }

  return <StockOverviewPageClient rows={rows} initialError={initialError} />
}
