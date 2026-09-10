import { getPurchaseOrderById } from '@/actions/procurement-actions'
import PurchaseOrderDetailPageClient from './PurchaseOrderDetailPageClient'

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let order: Awaited<ReturnType<typeof getPurchaseOrderById>> = null
  let initialError: string | null = null
  try {
    order = await getPurchaseOrderById(id)
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดใบสั่งซื้อไม่สำเร็จ'
  }

  return <PurchaseOrderDetailPageClient id={id} order={order} initialError={initialError} />
}
