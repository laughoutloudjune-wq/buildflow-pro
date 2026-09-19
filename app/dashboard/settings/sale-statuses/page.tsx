import { getAllSaleStatuses } from '@/actions/sales-actions'
import SaleStatusesPageClient from './SaleStatusesPageClient'

export default async function SaleStatusesPage() {
  let statuses: Awaited<ReturnType<typeof getAllSaleStatuses>> = []
  let initialError: string | null = null
  try {
    statuses = await getAllSaleStatuses()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ'
  }

  return <SaleStatusesPageClient initialStatuses={statuses} initialError={initialError} />
}
