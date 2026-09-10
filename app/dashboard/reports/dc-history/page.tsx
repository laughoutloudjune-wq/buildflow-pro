import { getExtraWorkReport, getBillingOptions } from '@/actions/billing-actions'
import DCHistoryReportPageClient from './DCHistoryReportPageClient'

export default async function DCHistoryReportPage() {
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
