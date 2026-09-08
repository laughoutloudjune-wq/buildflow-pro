import { getPurchaseOrders } from '@/actions/procurement-actions'
import PurchaseOrdersPageClient from './PurchaseOrdersPageClient'

export default async function PurchaseOrdersPage() {
  let orders: Awaited<ReturnType<typeof getPurchaseOrders>> = []
  let initialError: string | null = null
  try {
    orders = await getPurchaseOrders()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดใบสั่งซื้อไม่สำเร็จ'
  }

  return <PurchaseOrdersPageClient orders={orders} initialError={initialError} />
}
