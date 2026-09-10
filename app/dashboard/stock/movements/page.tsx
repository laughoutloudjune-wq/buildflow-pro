import { getStockMovements } from '@/actions/stock-actions'
import StockMovementsPageClient from './StockMovementsPageClient'

export default async function StockMovementsPage() {
  let movements: Awaited<ReturnType<typeof getStockMovements>> = []
  let initialError: string | null = null
  try {
    movements = await getStockMovements()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดประวัติการเคลื่อนไหวไม่สำเร็จ'
  }

  return <StockMovementsPageClient movements={movements} initialError={initialError} />
}
