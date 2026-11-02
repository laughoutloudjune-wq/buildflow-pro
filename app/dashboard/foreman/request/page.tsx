import CreateBillingRequestPage from '@/app/dashboard/billing/request/page'

export default async function ForemanProgressRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string; projectId?: string; plotId?: string; contractorId?: string }>
}) {
  return <CreateBillingRequestPage searchParams={searchParams} />
}
