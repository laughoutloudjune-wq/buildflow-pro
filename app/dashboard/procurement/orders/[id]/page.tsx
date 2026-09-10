import { getPurchaseOrderById, getSuppliers, getCompanies } from '@/actions/procurement-actions'
import { getProjects } from '@/actions/project-actions'
import type { PurchaseOrderFormOptions } from '@/components/procurement/PurchaseOrderForm'
import PurchaseOrderDetailPageClient from './PurchaseOrderDetailPageClient'

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let order: Awaited<ReturnType<typeof getPurchaseOrderById>> = null
  let initialError: string | null = null

  // This page renders PurchaseOrderForm in edit mode, and that form blocks its
  // whole render on these three lookups - so they are fetched here, in the
  // same parallel round trip as the order itself, rather than after hydration.
  let formOptions: PurchaseOrderFormOptions | undefined
  try {
    const [loadedOrder, projects, suppliers, companies] = await Promise.all([
      getPurchaseOrderById(id),
      getProjects({ includeCentralStock: true }),
      getSuppliers(),
      getCompanies(),
    ])
    order = loadedOrder
    formOptions = {
      projects: projects as PurchaseOrderFormOptions['projects'],
      suppliers,
      companies,
    }
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดใบสั่งซื้อไม่สำเร็จ'
  }

  return (
    <PurchaseOrderDetailPageClient
      id={id}
      order={order}
      formOptions={formOptions}
      initialError={initialError}
    />
  )
}
