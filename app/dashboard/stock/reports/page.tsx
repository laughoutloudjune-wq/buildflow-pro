import { getLowStockMaterials, getConsumptionReport } from '@/actions/stock-actions'
import StockReportsPageClient from './StockReportsPageClient'

export default async function StockReportsPage() {
  let lowStock: Awaited<ReturnType<typeof getLowStockMaterials>> = []
  let consumption: Awaited<ReturnType<typeof getConsumptionReport>> | null = null
  let initialError: string | null = null
  try {
    const [lowStockRows, consumptionReport] = await Promise.all([getLowStockMaterials(), getConsumptionReport()])
    lowStock = lowStockRows
    consumption = consumptionReport
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดรายงานไม่สำเร็จ'
  }

  return <StockReportsPageClient lowStock={lowStock} consumption={consumption} initialError={initialError} />
}
