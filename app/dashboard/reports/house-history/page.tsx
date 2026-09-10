import { getBillingOptions, getPlotHistoryReport } from '@/actions/billing-actions'
import HouseHistoryReportPageClient from './HouseHistoryReportPageClient'

export default async function HouseHistoryReportPage() {
  let projects: Awaited<ReturnType<typeof getBillingOptions>>['projects'] = []
  let rows: Awaited<ReturnType<typeof getPlotHistoryReport>> = []

  try {
    const [options, result] = await Promise.all([getBillingOptions(), getPlotHistoryReport({})])
    const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })
    projects = (options.projects || []).slice().sort((a, b) => collator.compare(a?.name || '', b?.name || ''))
    rows = result || []
  } catch (error) {
    console.error(error)
  }

  return <HouseHistoryReportPageClient initialProjects={projects} initialRows={rows} />
}
