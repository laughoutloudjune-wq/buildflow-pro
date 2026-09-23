import { requireModuleAccess } from '@/lib/auth/route-access'

// Widened to let `billing`-only roles (accountant, W-02) through too - they
// only get the contractor-cycle report (that page relies on the same
// `billing` reach via getApprovedContractorCycleReport's module gate), so
// each of the other three report pages gates itself back down to 'reports'.
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess(['reports', 'billing'])
  return children
}
