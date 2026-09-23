'use server'

import { getPurchaseOrderById, getSuppliersWithBranches, getCompanies } from '@/actions/procurement-actions'
import { getProjects } from '@/actions/project-actions'
import type { PurchaseOrderFormOptions } from '@/components/procurement/PurchaseOrderForm'

/**
 * Everything PurchaseOrderDetailPageClient needs, gathered once. Shared by
 * the standalone page (app/dashboard/procurement/orders/[id]/page.tsx) and
 * the orders list's quick-view modal (PurchaseOrderModal.tsx), the same
 * split used for plot detail (actions/plot-detail-bundle.ts) - one place
 * doing the fetch instead of two copies that could drift.
 */
export async function getPurchaseOrderDetailBundle(id: string) {
  let order: Awaited<ReturnType<typeof getPurchaseOrderById>> = null
  let initialError: string | null = null
  let formOptions: PurchaseOrderFormOptions | undefined

  try {
    const [loadedOrder, projects, suppliers, companies] = await Promise.all([
      getPurchaseOrderById(id),
      getProjects({ includeOverhead: true }),
      getSuppliersWithBranches(),
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

  return {
    fetchedAt: Date.now(),
    id,
    order,
    formOptions,
    initialError,
  }
}

export type PurchaseOrderDetailBundle = Awaited<ReturnType<typeof getPurchaseOrderDetailBundle>>
