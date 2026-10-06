import { requireModuleAccess } from '@/lib/auth/route-access'
import { getTransferRequests, type TransferRequestRow } from '@/actions/transfer-requests'
import { getCommissionOverview, type ProjectCommission } from '@/actions/commission-actions'
import TransferRequestsPageClient from './TransferRequestsPageClient'

/** ใบขอโอน (TR) list. Sales/PM/admin/sales exec only (the 'sales' module);
 * approve/reject buttons are enforced again inside the RPC. */
export default async function TransferRequestsPage() {
  await requireModuleAccess('sales')

  const [trRes, commissionRes] = await Promise.all([getTransferRequests(), getCommissionOverview()])

  let rows: TransferRequestRow[] = []
  let canApprove = false
  let initialError: string | null = null
  if ('error' in trRes) initialError = trRes.error
  else {
    rows = trRes.rows
    canApprove = trRes.canApprove
  }

  let projects: ProjectCommission[] = []
  let canManageCommission = false
  if ('error' in commissionRes) initialError = initialError || commissionRes.error
  else {
    projects = commissionRes.projects
    canManageCommission = commissionRes.canManage
  }

  return (
    <TransferRequestsPageClient
      initialRows={rows}
      canApprove={canApprove}
      commissionProjects={projects}
      canManageCommission={canManageCommission}
      initialError={initialError}
    />
  )
}
