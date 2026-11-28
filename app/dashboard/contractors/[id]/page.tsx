import { notFound } from 'next/navigation'
import { getContractorHub } from '@/actions/construction-hubs'
import { getDashboardSession, permissionsForRole } from '@/lib/auth/route-access'
import ContractorHubClient from './ContractorHubClient'

/** Contractor hub: one crew's jobs, bills, extra work, payouts and retention on one page. */
export default async function ContractorHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { role, permissions } = await getDashboardSession()
  const perms = permissionsForRole(role, permissions)
  const hub = await getContractorHub(id)
  if (!hub) notFound()
  return <ContractorHubClient hub={hub} canPay={perms.billing} />
}
