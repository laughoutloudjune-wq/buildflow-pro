import { getExtraWorkReport, getBillingOptions } from '@/actions/billing-actions'
import { requireModuleAccess } from '@/lib/auth/route-access'
import DCHistoryReportPageClient from './DCHistoryReportPageClient'

export default async function DCHistoryReportPage() {
  // The layout also allows `billing`-only accountant through (for
  // contractor-cycle) - this report isn't part of that (W-02).
  await requireModuleAccess('reports')
  let projects: Awaited<ReturnType<typeof getBillingOptions>>['projects'] = []
  let data: Awaited<ReturnType<typeof getExtraWorkReport>> = []

  try {
    const [options, result] = await Promise.all([getBillingOptions(), getExtraWorkReport({})])
    projects = options.projects || []
    data = result || []
  } catch (error) {
    console.error(error)
  }

  return <DCHistoryReportPageClient initialProjects={projects} initialData={data} />
}
