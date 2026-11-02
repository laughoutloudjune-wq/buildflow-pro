import { getBillingOptions, getBillingById } from '@/actions/billing-actions'
import { getPlotById } from '@/actions/job-actions'
import { getWorkRequestById } from '@/actions/sales-work-requests'
import type { BillingAdjustmentForm, BillingAdjustmentRecord } from '@/lib/types/billing'
import CreateExtraWorkPageClient from './CreateExtraWorkPageClient'

type Adjustment = BillingAdjustmentForm

// Kept in sync with CreateExtraWorkPageClient's copy - only used server-side
// here to seed the default reason before the client component mounts.
const DC_REASONS = ['Owner Request', 'Site Condition', 'Design Error', 'Scope Change', 'Other']

export default async function CreateExtraWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string; projectId?: string; plotId?: string; contractorId?: string; srId?: string }>
}) {
  const { editId, projectId, plotId, contractorId, srId } = await searchParams

  let projects: Awaited<ReturnType<typeof getBillingOptions>>['projects'] = []
  let contractors: Awaited<ReturnType<typeof getBillingOptions>>['contractors'] = []
  let initialSelectedProject = ''
  let initialSelectedContractor = ''
  let initialSelectedPlot = ''
  let initialReason = DC_REASONS[0]
  let initialNote = ''
  let initialBillingDate = new Date().toISOString()
  let initialExistingAttachmentUrls: string[] = []
  let initialAdjustments: Adjustment[] = []
  let initialError: string | null = null
  // Set when the DC starts from a sales work request; saving links the two.
  let workRequestId: string | null = null
  let workRequestNo: string | null = null

  try {
    const options = await getBillingOptions()
    projects = options.projects || []
    contractors = options.contractors || []
  } catch {
    // getBillingOptions never throws today, but fall back quietly rather
    // than break the page if that changes - the original client fetch had
    // no error handling here either.
  }

  // "Start from here": the plot page or a sales request passes what is already
  // known, so the foreman only types the work itself.
  if (!editId && srId) {
    const request = await getWorkRequestById(srId)
    if (request) {
      workRequestId = request.id
      workRequestNo = request.requestNo != null ? String(request.requestNo) : null
      initialSelectedProject = request.projectId
      initialSelectedPlot = request.plotId
      initialSelectedContractor = request.assignedContractorId || ''
      initialReason = 'Owner Request'
      initialNote = `จากคำขอฝ่ายขาย ${request.requestNo ?? ''}`.trim()
      initialAdjustments = [{
        type: 'addition',
        description: request.title,
        plot_name: request.plotName,
        unit: 'งาน',
        quantity: 1,
        unit_price: Number(request.quotedAmount) || 0,
      }]
    }
  } else if (!editId) {
    initialSelectedProject = projectId || ''
    initialSelectedContractor = contractorId || ''
    if (plotId) {
      const plot = await getPlotById(plotId)
      if (plot) {
        initialSelectedPlot = plot.id
        if (!initialSelectedProject) initialSelectedProject = plot.project_id || ''
      }
    }
  }

  if (editId) {
    try {
      const billing = await getBillingById(editId)
      if (billing) {
        initialSelectedProject = billing.project_id || ''
        initialSelectedContractor = billing.contractor_id || ''
        initialSelectedPlot = billing.plot_id || ''
        initialReason = billing.reason_for_dc || DC_REASONS[0]
        initialNote = billing.note || ''
        initialBillingDate = billing.billing_date || initialBillingDate
        initialExistingAttachmentUrls = Array.isArray(billing.attachment_urls) ? billing.attachment_urls : []
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
      initialError = error instanceof Error ? error.message : 'Failed to load DC request'
    }
  }

  return (
    <CreateExtraWorkPageClient
      editId={editId ?? null}
      initialProjects={projects}
      initialContractors={contractors}
      initialSelectedProject={initialSelectedProject}
      initialSelectedContractor={initialSelectedContractor}
      initialSelectedPlot={initialSelectedPlot}
      initialReason={initialReason}
      initialNote={initialNote}
      initialBillingDate={initialBillingDate}
      initialExistingAttachmentUrls={initialExistingAttachmentUrls}
      initialAdjustments={initialAdjustments}
      initialError={initialError}
      workRequestId={workRequestId}
      workRequestNo={workRequestNo}
    />
  )
}
