'use server'

import { createClient } from '@/lib/supabase/server'
import type { ProgressHistoryItem } from '@/lib/types/billing'

type BillingHistoryRow = {
  id: string
  job_assignment_id: string | null
  amount: number | null
  progress_percent: number | null
  billings:
    | {
        id: string
        doc_no: string | number | null
        billing_date: string | null
        status: string | null
        created_at: string | null
      }
    | Array<{
        id: string
        doc_no: string | number | null
        billing_date: string | null
        status: string | null
        created_at: string | null
      }>
    | null
}

type BillableJobRow = {
  id: string
  status: string
  agreed_price_per_unit: number | null
  boq_master:
    | {
        item_name: string
        unit: string
        quantity: number
        price_per_unit: number | null
      }
    | Array<{
        item_name: string
        unit: string
        quantity: number
        price_per_unit: number | null
      }>
    | null
  plots:
    | {
        id: string
        name: string
        project_id: string
      }
    | Array<{
        id: string
        name: string
        project_id: string
      }>
    | null
  payments: Array<{ amount: number | null }> | null
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

type ResolvedBillableJobRow = {
  id: string
  status: string
  agreed_price_per_unit: number | null
  boq_master: {
    item_name: string
    unit: string
    quantity: number
    price_per_unit: number | null
  } | null
  plots: {
    id: string
    name: string
    project_id: string
  } | null
  payments: Array<{ amount: number | null }> | null
}

export async function getJobProgressHistory(jobAssignmentIds: string[]) {
  const supabase = await createClient()
  const ids = Array.from(new Set((jobAssignmentIds || []).filter(Boolean)))
  if (ids.length === 0) return {}

  const { data, error } = await supabase
    .from('billing_jobs')
    .select(`
      id,
      job_assignment_id,
      amount,
      progress_percent,
      billings!inner (
        id,
        doc_no,
        billing_date,
        status,
        created_at
      )
    `)
    .in('job_assignment_id', ids)

  if (error) throw new Error(error.message)

  const out: Record<string, ProgressHistoryItem[]> = {}
  for (const row of (data || []) as BillingHistoryRow[]) {
    const key = String(row.job_assignment_id)
    if (!out[key]) out[key] = []
    const bill = Array.isArray(row.billings) ? row.billings[0] : row.billings
    out[key].push({
      id: row.id,
      amount: Number(row.amount || 0),
      progress_percent: row.progress_percent == null ? null : Number(row.progress_percent),
      created_at: bill?.created_at || undefined,
      doc_no: bill?.doc_no ?? undefined,
      billing_date: bill?.billing_date || undefined,
      status: bill?.status || undefined,
    })
  }

  for (const key of Object.keys(out)) {
    out[key].sort((a, b) => {
      const ta = new Date(a.billing_date || a.created_at || 0).getTime()
      const tb = new Date(b.billing_date || b.created_at || 0).getTime()
      return tb - ta
    })
  }
  return out
}

export async function getBillingOptions() {
  const supabase = await createClient()

  const [projects, contractors] = await Promise.all([
    supabase.from('projects').select('id, name').order('name'),
    supabase.from('contractors').select('id, name, contractor_types(name)').order('name'),
  ])

  return {
    projects: projects.data || [],
    contractors: contractors.data || [],
  }
}

export async function getBillableJobs(projectId: string, contractorId: string, plotId?: string) {
  const supabase = await createClient()

  let query = supabase
    .from('job_assignments')
    .select(`
      id,
      status,
      agreed_price_per_unit,
      boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name, unit, quantity, price_per_unit),
      plots!inner (id, name, project_id),
      payments (amount)
    `)
    .eq('contractor_id', contractorId)
    .eq('plots.project_id', projectId)
    .neq('status', 'pending')

  if (plotId) query = query.eq('plots.id', plotId)

  const { data, error } = await query

  if (error) {
    console.error('Error fetching billable jobs:', error)
    return []
  }

  return data
    .map((job) => {
      const typedJob = job as unknown as BillableJobRow
      const resolvedJob: ResolvedBillableJobRow = {
        ...typedJob,
        boq_master: asSingle(typedJob.boq_master),
        plots: asSingle(typedJob.plots),
      }
      const pricePerUnit = resolvedJob.agreed_price_per_unit ?? resolvedJob.boq_master?.price_per_unit ?? 0
      const totalBoq = (resolvedJob.boq_master?.quantity || 0) * pricePerUnit
      const payments = Array.isArray(resolvedJob.payments) ? resolvedJob.payments : []
      const paid = payments.reduce((sum: number, p) => sum + (p.amount || 0), 0)
      const remaining = totalBoq - paid

      return {
        ...resolvedJob,
        effective_price_per_unit: pricePerUnit,
        pricing_source: resolvedJob.agreed_price_per_unit != null ? 'assignment' : 'boq_master',
        totalBoq,
        paid,
        remaining,
      }
    })
    .filter((job) => job.remaining > 0)
}
