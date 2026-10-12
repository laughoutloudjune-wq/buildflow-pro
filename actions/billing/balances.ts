'use server'

import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { latestRecordedByJob, type RecordedProgress } from '@/lib/billing'

export type ContractorJobBalance = {
  jobId: string
  title: string
  plotName: string
  value: number
  paid: number
  /** requested on a billing that is still waiting for PM review */
  pending: number
  recorded: RecordedProgress | null
}

export type ContractorBalance = {
  contractorId: string
  contractorName: string
  jobs: ContractorJobBalance[]
}

type Row = {
  id: string
  contractor_id: string | null
  agreed_price_per_unit: number | null
  contractors: { name: string } | { name: string }[] | null
  boq_master: { item_name: string; quantity: number | null; price_per_unit: number | null } | { item_name: string; quantity: number | null; price_per_unit: number | null }[] | null
  plots: { name: string } | { name: string }[] | null
  payments: { amount: number | null }[] | null
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

/**
 * Per contractor, per job in a project: contract value, paid, awaiting PM
 * review, and the site progress recorded on the weekly plan - the inputs for
 * "how much work is left and how much money is left". Jobs with no contractor
 * or no value are left out.
 */
export async function getContractorBalances(projectId: string): Promise<ContractorBalance[]> {
  await requireModuleAccess('billing')
  const supabase = await createClient()

  const jobs: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('job_assignments')
      .select(
        'id, contractor_id, agreed_price_per_unit, contractors(name), boq_master:boq_master!job_assignments_boq_item_id_fkey(item_name, quantity, price_per_unit), plots!inner(name, project_id), payments(amount)'
      )
      .eq('plots.project_id', projectId)
      .not('contractor_id', 'is', null)
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    jobs.push(...((data || []) as unknown as Row[]))
    if (!data || data.length < 1000) break
  }

  const [pendingRes, planRes] = await Promise.all([
    supabase
      .from('billing_jobs')
      .select('job_assignment_id, amount, billings!inner(project_id, status)')
      .eq('billings.project_id', projectId)
      .eq('billings.status', 'pending_review'),
    supabase.from('weekly_plan_items').select('job_assignment_id, week_start, actual_pct').eq('project_id', projectId).not('job_assignment_id', 'is', null).not('actual_pct', 'is', null),
  ])
  if (pendingRes.error) throw new Error(pendingRes.error.message)
  if (planRes.error) throw new Error(planRes.error.message)

  const pending = new Map<string, number>()
  for (const r of (pendingRes.data || []) as { job_assignment_id: string | null; amount: number | null }[]) {
    if (r.job_assignment_id) pending.set(r.job_assignment_id, (pending.get(r.job_assignment_id) ?? 0) + Number(r.amount || 0))
  }
  const recorded = latestRecordedByJob((planRes.data || []) as { job_assignment_id: string; week_start: string; actual_pct: (number | null)[] }[])

  const byContractor = new Map<string, ContractorBalance>()
  for (const j of jobs) {
    const boq = one(j.boq_master)
    const price = j.agreed_price_per_unit ?? boq?.price_per_unit ?? 0
    const value = (boq?.quantity || 0) * price
    if (!j.contractor_id || value <= 0) continue
    const entry = byContractor.get(j.contractor_id) ?? { contractorId: j.contractor_id, contractorName: one(j.contractors)?.name || '-', jobs: [] }
    entry.jobs.push({
      jobId: j.id,
      title: boq?.item_name || 'งานหลัก',
      plotName: one(j.plots)?.name || '-',
      value,
      paid: (j.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0),
      pending: pending.get(j.id) ?? 0,
      recorded: recorded[j.id] ?? null,
    })
    byContractor.set(j.contractor_id, entry)
  }
  return [...byContractor.values()].sort((a, b) => a.contractorName.localeCompare(b.contractorName, 'th'))
}
