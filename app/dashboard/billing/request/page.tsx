import { getBillingOptions, getBillingById } from '@/actions/billing-actions'
import { getPlotById } from '@/actions/job-actions'
import type { BillingAdjustmentForm, BillingAdjustmentRecord } from '@/lib/types/billing'
import CreateBillingRequestPageClient from './CreateBillingRequestPageClient'

type Adjustment = BillingAdjustmentForm
type BillingDetail = Awaited<ReturnType<typeof getBillingById>>

export default async function CreateBillingRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string; projectId?: string; plotId?: string; contractorId?: string }>
}) {
  const { editId, projectId, plotId, contractorId } = await searchParams

  let projects: Awaited<ReturnType<typeof getBillingOptions>>['projects'] = []
  let contractors: Awaited<ReturnType<typeof getBillingOptions>>['contractors'] = []
  let editingBilling: BillingDetail = null
  let initialSelectedProject = ''
  let initialSelectedContractor = ''
  let initialNote = ''
  let initialAdjustments: Adjustment[] = []
  let initialError: string | null = null
  // "Start from here" links (plot page, contractor balances) pass what is
  // already known; editing a bill always wins over them.
  let initialPlotName = ''

  try {
    const options = await getBillingOptions()
    projects = options.projects
    contractors = options.contractors
  } catch {
    // getBillingOptions never throws today, but fall back quietly rather
    // than break the page if that changes - the original client fetch had
    // no error handling here either.
  }

  if (!editId) {
    initialSelectedProject = projectId || ''
    initialSelectedContractor = contractorId || ''
    if (plotId) {
      const plot = await getPlotById(plotId)
      initialPlotName = plot?.name || ''
      if (!initialSelectedProject) initialSelectedProject = plot?.project_id || ''
    }
  }

  if (editId) {
    try {
      const billing = await getBillingById(editId)
      if (billing) {
        editingBilling = billing
        initialSelectedProject = billing.project_id || ''
        initialSelectedContractor = billing.contractor_id || ''
        initialNote = billing.note || ''
        initialAdjustments = (billing.billing_adjustments || []).map((adj: BillingAdjustmentRecord) => ({
          type: adj.type,
          description: adj.description || '',
          plot_name: adj.plot_name || '',
          unit: adj.unit || '',
          quantity: Number(adj.quantity || 0),
          unit_price: Number(adj.unit_price || 0),
        }))
      }
    } catch (error) {
      initialError = error instanceof Error ? error.message : 'โหลดข้อมูลใบขอเบิกไม่สำเร็จ'
    }
  }

  return (
    <CreateBillingRequestPageClient
      editId={editId ?? null}
      initialProjects={projects}
      initialContractors={contractors}
      initialEditingBilling={editingBilling}
      initialSelectedProject={initialSelectedProject}
      initialSelectedContractor={initialSelectedContractor}
      initialPlotName={initialPlotName}
      initialNote={initialNote}
      initialAdjustments={initialAdjustments}
      initialError={initialError}
    />
  )
}
