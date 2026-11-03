import { getPurchaseOrders, getSuppliersWithBranches, getCompanies } from '@/actions/procurement-actions'
import { getProjects } from '@/actions/project-actions'
import type { PurchaseOrderFormOptions } from '@/components/procurement/PurchaseOrderForm'
import PurchaseOrdersPageClient from './PurchaseOrdersPageClient'

export default async function PurchaseOrdersPage() {
  let orders: Awaited<ReturnType<typeof getPurchaseOrders>> = []
  let initialError: string | null = null
  let options: PurchaseOrderFormOptions = { projects: [], suppliers: [], companies: [] }
  try {
    const [o, projects, suppliers, companies] = await Promise.all([
      getPurchaseOrders(),
      getProjects({ includeOverhead: true }),
      getSuppliersWithBranches(),
      getCompanies(),
    ])
    orders = o
    options = { projects: projects as PurchaseOrderFormOptions['projects'], suppliers, companies }
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดใบสั่งซื้อไม่สำเร็จ'
  }

  return <PurchaseOrdersPageClient orders={orders} options={options} initialError={initialError} />
}
