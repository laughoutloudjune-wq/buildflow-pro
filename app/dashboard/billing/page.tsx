import { getBillingOptions } from '@/actions/billing-actions'
import { getDashboardSession, permissionsForRole } from '@/lib/auth/route-access'
import BillsInboxClient from './BillsInboxClient'

/**
 * Bills inbox: the one place for money going to contractors. It replaces the
 * bill list and the payout-cycle report: รอตรวจ → รอจ่าย → จ่ายแล้ว, main-work
 * and DC bills kept apart by a chip.
 */
export default async function BillingInboxPage() {
  const { role, permissions } = await getDashboardSession()
  const perms = permissionsForRole(role, permissions)
  let options: Awaited<ReturnType<typeof getBillingOptions>> = { projects: [], contractors: [] }
  try {
    options = await getBillingOptions()
  } catch (error) {
    console.error(error)
  }
  return (
    <BillsInboxClient
      projects={(options.projects || []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))}
      contractors={(options.contractors || []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))}
      canCreate={perms.foreman || perms.projects}
    />
  )
}
