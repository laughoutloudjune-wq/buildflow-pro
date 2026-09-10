import CreateBillingRequestPage from '@/app/dashboard/billing/request/page'

export default async function ForemanProgressRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string }>
}) {
  return <CreateBillingRequestPage searchParams={searchParams} />
}
