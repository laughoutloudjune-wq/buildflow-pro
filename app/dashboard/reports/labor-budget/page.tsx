import { getLaborLedger, getLaborLedgerOptions } from '@/actions/labor-budget-actions'
import LaborBudgetLedgerPageClient from './LaborBudgetLedgerPageClient'

export default async function LaborBudgetLedgerPage() {
  let projects: Awaited<ReturnType<typeof getLaborLedgerOptions>>['projects'] = []
  let contractors: Awaited<ReturnType<typeof getLaborLedgerOptions>>['contractors'] = []
  let plotGroups: Awaited<ReturnType<typeof getLaborLedgerOptions>>['plotGroups'] = []
  let entries: Awaited<ReturnType<typeof getLaborLedger>>['entries'] = []
  let initialError: string | null = null

  try {
    const [options, result] = await Promise.all([getLaborLedgerOptions(), getLaborLedger({})])
    projects = options.projects
    contractors = options.contractors
    plotGroups = options.plotGroups
    entries = result.entries
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ'
  }

  return (
    <LaborBudgetLedgerPageClient
      initialProjects={projects}
      initialContractors={contractors}
      initialPlotGroups={plotGroups}
      initialEntries={entries}
      initialError={initialError}
    />
  )
}
