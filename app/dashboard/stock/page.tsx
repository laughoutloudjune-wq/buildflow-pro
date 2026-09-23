import { getStockOverview } from '@/actions/stock-actions'
import StockOverviewPageClient from './StockOverviewPageClient'

export default async function StockOverviewPage() {
  let rows: Awaited<ReturnType<typeof getStockOverview>>['rows'] = []
  let canAdjust = false
  let initialError: string | null = null
  try {
    const result = await getStockOverview()
    rows = result.rows
    canAdjust = result.canAdjust
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลสต็อกไม่สำเร็จ'
  }

  return <StockOverviewPageClient rows={rows} canAdjust={canAdjust} initialError={initialError} />
}
