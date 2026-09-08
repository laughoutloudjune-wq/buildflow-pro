import { getBillings, getBillingOptions } from '@/actions/billing-actions'
import BillingPageClient from './BillingPageClient'

export default async function BillingListPage() {
  const [billingsResult, optionsResult] = await Promise.allSettled([
    getBillings(),
    getBillingOptions(),
  ])

  const billings = billingsResult.status === 'fulfilled' ? billingsResult.value : []
  const listError =
    billingsResult.status === 'rejected'
      ? billingsResult.reason instanceof Error
        ? billingsResult.reason.message
        : 'โหลดรายการไม่สำเร็จ'
      : null
  const options = optionsResult.status === 'fulfilled' ? optionsResult.value : { projects: [], contractors: [] }

  return (
    <BillingPageClient
      initialBillings={billings}
      initialError={listError}
      projects={options.projects || []}
      contractors={options.contractors || []}
    />
  )
}
