import {
  getPurchaseRequests,
  getPurchaseOrders,
  getGoodsReceipts,
  getPaymentVouchers,
  getSuppliersWithBranches,
  getCompanies,
} from '@/actions/procurement-actions'
import { getProjects } from '@/actions/project-actions'
import type { PurchaseOrderFormOptions } from '@/components/procurement/PurchaseOrderForm'
import WorkPageClient from './WorkPageClient'

// One page for the whole purchase chain: request, order, receipt, payment.
export default async function PurchaseRequestsPage({ searchParams }: { searchParams: Promise<{ open?: string; stage?: string }> }) {
  const { open, stage } = await searchParams
  const settled = await Promise.allSettled([
    getPurchaseRequests(),
    getPurchaseOrders(),
    getGoodsReceipts(),
    getPaymentVouchers(),
    getProjects({ includeOverhead: true }),
    getSuppliersWithBranches(),
    getCompanies(),
  ])
  const pick = <T,>(r: PromiseSettledResult<T>, fallback: T): T => (r.status === 'fulfilled' ? r.value : fallback)
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  const initialError = failed ? (failed.reason instanceof Error ? failed.reason.message : 'โหลดข้อมูลงานจัดซื้อไม่สำเร็จ') : null
  const requests = pick(settled[0], [])
  const orders = pick(settled[1], [])
  const receipts = pick(settled[2], [])
  const vouchers = pick(settled[3], [])
  const projects = pick(settled[4], [])
  const suppliers = pick(settled[5], [])
  const companies = pick(settled[6], [])

  const options: PurchaseOrderFormOptions = {
    projects: projects as PurchaseOrderFormOptions['projects'],
    suppliers,
    companies,
  }

  return (
    <WorkPageClient
      requests={requests}
      orders={orders}
      receipts={receipts}
      vouchers={vouchers}
      options={options}
      initialError={initialError}
      initialOpen={open ?? null}
      initialStage={stage ?? null}
    />
  )
}
