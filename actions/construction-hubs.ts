'use server'

import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { fetchAllRows } from '@/actions/_shared/fetch-all-rows'
import { getPlotNameMap } from '@/actions/_shared/plot-maps'
import { houseTypeLabel } from '@/lib/house-type'

/**
 * Read-only data for the construction hubs (project board, group hub,
 * contractor hub). Everything here comes from tables that already exist; no
 * writes happen in this file. Cost and labor money is construction-only
 * (M-03), so every action gates on the same modules as the billing reports.
 * Every list that can pass 1,000 rows goes through fetchAllRows (H-03).
 */

const MONEY_MODULES = ['billing', 'reports', 'foreman', 'projects', 'cost_control'] as const

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
const num = (v: number | string | null | undefined) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------------
// Bills (shared by the plot hub, group hub, contractor hub and the board)
// ---------------------------------------------------------------------------

export type ScopeBill = {
  id: string
  docNo: string
  /** DC = extra-work bill. Main-work and DC bills are always kept apart. */
  kind: 'main' | 'dc'
  status: string
  billingDate: string | null
  createdAt: string | null
  paidOutAt: string | null
  netAmount: number
  workAmount: number
  projectId: string | null
  projectName: string
  contractorId: string | null
  contractorName: string
  plotIds: string[]
  plotNames: string[]
  /** A short preview of what the bill is for (job names, adjustment text). */
  lines: string[]
}

type BillRow = {
  id: string
  type: string | null
  status: string | null
  doc_no: string | number | null
  billing_date: string | null
  created_at: string | null
  paid_out_at: string | null
  net_amount: number | string | null
  total_work_amount: number | string | null
  reason_for_dc: string | null
  project_id: string | null
  contractor_id: string | null
  plot_id: string | null
  projects: { name: string | null } | { name: string | null }[] | null
  contractors: { name: string | null } | { name: string | null }[] | null
  billing_jobs:
    | {
        id: string
        job_assignments:
          | {
              plot_id: string | null
              plots: { name: string | null } | { name: string | null }[] | null
              boq_master: { item_name: string | null } | { item_name: string | null }[] | null
            }
          | {
              plot_id: string | null
              plots: { name: string | null } | { name: string | null }[] | null
              boq_master: { item_name: string | null } | { item_name: string | null }[] | null
            }[]
          | null
      }[]
    | null
  billing_adjustments: { id: string; type: string | null; description: string | null }[] | null
}

async function loadBills(filter: { projectId?: string; contractorId?: string }): Promise<ScopeBill[]> {
  const supabase = await createClient()
  const rows = await fetchAllRows<BillRow>((from, to) => {
    let q = supabase
      .from('billings')
      .select(
        `id, type, status, doc_no, billing_date, created_at, paid_out_at, net_amount, total_work_amount, reason_for_dc, project_id, contractor_id, plot_id,
         projects (name), contractors (name),
         billing_jobs (id, job_assignments (plot_id, plots (name), boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name))),
         billing_adjustments (id, type, description)`
      )
      .order('created_at', { ascending: false })
      .order('id')
    if (filter.projectId) q = q.eq('project_id', filter.projectId)
    if (filter.contractorId) q = q.eq('contractor_id', filter.contractorId)
    return q.range(from, to) as unknown as PromiseLike<{ data: BillRow[] | null; error: { message: string } | null }>
  })
  const plotNames = await getPlotNameMap(
    supabase,
    rows.map((r) => r.plot_id)
  )

  return rows.map((b) => {
    const plotIds = new Set<string>()
    const names = new Set<string>()
    if (b.plot_id) {
      plotIds.add(b.plot_id)
      const n = plotNames.get(b.plot_id)
      if (n) names.add(n)
    }
    const lines: string[] = []
    for (const j of b.billing_jobs || []) {
      const ja = one(j.job_assignments)
      if (ja?.plot_id) plotIds.add(ja.plot_id)
      const pn = one(ja?.plots)?.name
      if (pn) names.add(pn)
      const item = one(ja?.boq_master)?.item_name
      if (item) lines.push(item)
    }
    for (const a of b.billing_adjustments || []) {
      if (a.description) lines.push(`${a.type === 'deduction' ? 'หัก' : 'เพิ่ม'}: ${a.description}`)
    }
    if (b.reason_for_dc && lines.length === 0) lines.push(b.reason_for_dc)
    return {
      id: b.id,
      docNo: b.doc_no == null ? '' : String(b.doc_no).padStart(4, '0'),
      kind: b.type === 'extra_work' ? 'dc' : 'main',
      status: b.status || '',
      billingDate: b.billing_date,
      createdAt: b.created_at,
      paidOutAt: b.paid_out_at,
      netAmount: num(b.net_amount),
      workAmount: num(b.total_work_amount),
      projectId: b.project_id,
      projectName: one(b.projects)?.name || '',
      contractorId: b.contractor_id,
      contractorName: one(b.contractors)?.name || '',
      plotIds: [...plotIds],
      plotNames: [...names].sort((a, c) => a.localeCompare(c, 'th', { numeric: true })),
      lines: lines.slice(0, 4),
    }
  })
}

/**
 * Bills for a project, narrowed to some plots and/or one contractor. A bill
 * belongs to a plot when it names the plot itself (DC bills) or when any of
 * its job lines is on that plot (progress bills, which can span plots).
 */
export async function getScopeBills(filter: { projectId?: string; plotIds?: string[]; contractorId?: string }): Promise<ScopeBill[]> {
  await requireModuleAccess([...MONEY_MODULES])
  const all = await loadBills({ projectId: filter.projectId, contractorId: filter.contractorId })
  const plotIds = filter.plotIds && filter.plotIds.length > 0 ? new Set(filter.plotIds) : null
  return plotIds ? all.filter((b) => b.plotIds.some((id) => plotIds.has(id))) : all
}

// ---------------------------------------------------------------------------
// Board extras: what the cost board does not already carry
// ---------------------------------------------------------------------------

export type BoardPlotExtras = {
  pendingBills: number
  pendingAmount: number
  /** Jobs with no crew yet. */
  noCrewJobs: number
  /** Jobs paid in full (or more) that are still not marked completed. */
  paidNotDone: { jobId: string; name: string; paid: number; value: number }[]
}

export type BoardExtras = {
  byPlot: Record<string, BoardPlotExtras>
  /** Contractor name -> plots they hold jobs on, for the board search box. */
  contractors: { id: string; name: string; plotIds: string[] }[]
  pendingCount: number
  pendingAmount: number
}

type ExtraJobRow = {
  id: string
  plot_id: string
  status: string | null
  contractor_id: string | null
  agreed_price_per_unit: number | string | null
  boq_master: { item_name: string | null; quantity: number | string | null; price_per_unit: number | string | null } | { item_name: string | null; quantity: number | string | null; price_per_unit: number | string | null }[] | null
  contractors: { name: string | null } | { name: string | null }[] | null
  payments: { amount: number | string | null }[] | null
}

export async function getBoardExtras(projectId: string): Promise<BoardExtras> {
  await requireModuleAccess([...MONEY_MODULES])
  const supabase = await createClient()

  const [jobs, bills] = await Promise.all([
    fetchAllRows<ExtraJobRow>(
      (from, to) =>
        supabase
          .from('job_assignments')
          .select(
            'id, plot_id, status, contractor_id, agreed_price_per_unit, boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name, quantity, price_per_unit), contractors (name), payments (amount), plots!inner (project_id)'
          )
          .eq('plots.project_id', projectId)
          .order('id')
          .range(from, to) as unknown as PromiseLike<{ data: ExtraJobRow[] | null; error: { message: string } | null }>
    ),
    loadBills({ projectId }),
  ])

  const byPlot: Record<string, BoardPlotExtras> = {}
  const at = (plotId: string) => (byPlot[plotId] ||= { pendingBills: 0, pendingAmount: 0, noCrewJobs: 0, paidNotDone: [] })
  const contractors = new Map<string, { id: string; name: string; plotIds: Set<string> }>()

  for (const j of jobs) {
    const row = at(j.plot_id)
    if (!j.contractor_id) row.noCrewJobs += 1
    const boq = one(j.boq_master)
    const value = num(boq?.quantity) * num(j.agreed_price_per_unit ?? boq?.price_per_unit)
    const paid = (j.payments || []).reduce((s, p) => s + num(p.amount), 0)
    if (value > 0 && paid >= value - 0.005 && j.status !== 'completed') {
      row.paidNotDone.push({ jobId: j.id, name: boq?.item_name || '-', paid, value })
    }
    if (j.contractor_id) {
      const c = contractors.get(j.contractor_id) || { id: j.contractor_id, name: one(j.contractors)?.name || '', plotIds: new Set<string>() }
      c.plotIds.add(j.plot_id)
      contractors.set(j.contractor_id, c)
    }
  }

  let pendingCount = 0
  let pendingAmount = 0
  for (const b of bills) {
    if (b.status !== 'pending_review') continue
    pendingCount += 1
    pendingAmount += b.netAmount
    for (const plotId of b.plotIds) {
      const row = at(plotId)
      row.pendingBills += 1
      row.pendingAmount += b.netAmount
    }
  }

  return {
    byPlot,
    contractors: [...contractors.values()].map((c) => ({ id: c.id, name: c.name, plotIds: [...c.plotIds] })).sort((a, b) => a.name.localeCompare(b.name, 'th')),
    pendingCount,
    pendingAmount,
  }
}

// ---------------------------------------------------------------------------
// Group hub
// ---------------------------------------------------------------------------

export type GroupHubJob = {
  id: string
  plotId: string
  name: string
  trade: string
  status: string
  contractorId: string | null
  contractorName: string | null
  value: number
  paid: number
  progressPercent: number | null
}

export type GroupHubPlot = { id: string; name: string; houseModel: string; houseModelId: string | null }

export type GroupHubData = {
  group: { id: string; name: string; projectId: string; projectName: string }
  plots: GroupHubPlot[]
  jobs: GroupHubJob[]
  /** Other batches of the same project, for the prev/next arrows. */
  siblings: { id: string; name: string }[]
}

type GroupJobRow = {
  id: string
  plot_id: string
  status: string | null
  contractor_id: string | null
  agreed_price_per_unit: number | string | null
  boq_master:
    | { item_name: string | null; quantity: number | string | null; price_per_unit: number | string | null; contractor_types: { name: string | null } | { name: string | null }[] | null }
    | { item_name: string | null; quantity: number | string | null; price_per_unit: number | string | null; contractor_types: { name: string | null } | { name: string | null }[] | null }[]
    | null
  contractors: { name: string | null } | { name: string | null }[] | null
  payments: { amount: number | string | null }[] | null
}

export async function getGroupHub(projectId: string, groupId: string): Promise<GroupHubData | null> {
  await requireModuleAccess('projects')
  const supabase = await createClient()

  const [groupRes, membersRes, siblingsRes] = await Promise.all([
    supabase.from('plot_groups').select('id, name, project_id, projects (name)').eq('id', groupId).maybeSingle(),
    supabase.from('plot_group_members').select('plot_id').eq('group_id', groupId),
    supabase.from('plot_groups').select('id, name').eq('project_id', projectId).order('name'),
  ])
  if (groupRes.error) throw new Error(groupRes.error.message)
  if (membersRes.error) throw new Error(membersRes.error.message)
  if (!groupRes.data || groupRes.data.project_id !== projectId) return null

  const plotIds = (membersRes.data || []).map((m) => m.plot_id as string)
  if (plotIds.length === 0) {
    return {
      group: { id: groupId, name: groupRes.data.name || '', projectId, projectName: one(groupRes.data.projects as { name: string | null } | { name: string | null }[] | null)?.name || '' },
      plots: [],
      jobs: [],
      siblings: (siblingsRes.data || []).map((g) => ({ id: g.id as string, name: (g.name as string) || '' })),
    }
  }

  const [plotsRes, jobs] = await Promise.all([
    supabase.from('plots').select('id, name, house_model_id, house_models (name, code)').in('id', plotIds),
    fetchAllRows<GroupJobRow>(
      (from, to) =>
        supabase
          .from('job_assignments')
          .select(
            'id, plot_id, status, contractor_id, agreed_price_per_unit, boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name, quantity, price_per_unit, contractor_types (name)), contractors (name), payments (amount)'
          )
          .in('plot_id', plotIds)
          .order('id')
          .range(from, to) as unknown as PromiseLike<{ data: GroupJobRow[] | null; error: { message: string } | null }>
    ),
  ])
  if (plotsRes.error) throw new Error(plotsRes.error.message)

  const plots: GroupHubPlot[] = (plotsRes.data || [])
    .map((p) => {
      const hm = one(p.house_models as { name: string | null; code: string | null } | { name: string | null; code: string | null }[] | null)
      return { id: p.id as string, name: (p.name as string) || '', houseModel: houseTypeLabel(hm?.name, hm?.code), houseModelId: (p.house_model_id as string | null) ?? null }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'th', { numeric: true }))

  return {
    group: { id: groupId, name: groupRes.data.name || '', projectId, projectName: one(groupRes.data.projects as { name: string | null } | { name: string | null }[] | null)?.name || '' },
    plots,
    jobs: jobs.map((j) => {
      const boq = one(j.boq_master)
      return {
        id: j.id,
        plotId: j.plot_id,
        name: boq?.item_name || '-',
        trade: one(boq?.contractor_types)?.name || 'งานอื่นๆ',
        status: j.status || 'pending',
        contractorId: j.contractor_id,
        contractorName: one(j.contractors)?.name || null,
        value: num(boq?.quantity) * num(j.agreed_price_per_unit ?? boq?.price_per_unit),
        paid: (j.payments || []).reduce((s, p) => s + num(p.amount), 0),
        progressPercent: null,
      }
    }),
    siblings: (siblingsRes.data || []).map((g) => ({ id: g.id as string, name: (g.name as string) || '' })),
  }
}

// ---------------------------------------------------------------------------
// Contractor hub
// ---------------------------------------------------------------------------

export type ContractorHeldJob = {
  id: string
  projectId: string
  projectName: string
  plotId: string
  plotName: string
  name: string
  status: string
  value: number
  paid: number
  /** On a bill still waiting for review. */
  pending: number
}

export type ContractorHubData = {
  contractor: { id: string; name: string; typeName: string | null; phone: string | null }
  jobs: ContractorHeldJob[]
  bills: ScopeBill[]
}

type HeldJobRow = {
  id: string
  plot_id: string
  status: string | null
  agreed_price_per_unit: number | string | null
  boq_master: { item_name: string | null; quantity: number | string | null; price_per_unit: number | string | null } | { item_name: string | null; quantity: number | string | null; price_per_unit: number | string | null }[] | null
  plots: { name: string | null; project_id: string; projects: { name: string | null } | { name: string | null }[] | null } | { name: string | null; project_id: string; projects: { name: string | null } | { name: string | null }[] | null }[] | null
  payments: { amount: number | string | null }[] | null
}

export async function getContractorHub(contractorId: string): Promise<ContractorHubData | null> {
  await requireModuleAccess(['contractors', ...MONEY_MODULES])
  const supabase = await createClient()

  const cRes = await supabase.from('contractors').select('id, name, phone, contractor_types (name)').eq('id', contractorId).maybeSingle()
  if (cRes.error) throw new Error(cRes.error.message)
  if (!cRes.data) return null

  const [jobs, bills, pendingRes] = await Promise.all([
    fetchAllRows<HeldJobRow>(
      (from, to) =>
        supabase
          .from('job_assignments')
          .select(
            'id, plot_id, status, agreed_price_per_unit, boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name, quantity, price_per_unit), plots (name, project_id, projects (name)), payments (amount)'
          )
          .eq('contractor_id', contractorId)
          .order('id')
          .range(from, to) as unknown as PromiseLike<{ data: HeldJobRow[] | null; error: { message: string } | null }>
    ),
    loadBills({ contractorId }),
    supabase.from('billing_jobs').select('job_assignment_id, amount, billings!inner (contractor_id, status)').eq('billings.contractor_id', contractorId).eq('billings.status', 'pending_review'),
  ])
  if (pendingRes.error) throw new Error(pendingRes.error.message)
  const pendingByJob = new Map<string, number>()
  for (const r of pendingRes.data || []) {
    const id = r.job_assignment_id as string | null
    if (id) pendingByJob.set(id, (pendingByJob.get(id) || 0) + num(r.amount as number | string | null))
  }

  const type = one(cRes.data.contractor_types as { name: string | null } | { name: string | null }[] | null)
  return {
    contractor: { id: cRes.data.id as string, name: (cRes.data.name as string) || '', typeName: type?.name || null, phone: (cRes.data.phone as string | null) ?? null },
    jobs: jobs.map((j) => {
      const boq = one(j.boq_master)
      const plot = one(j.plots)
      return {
        id: j.id,
        projectId: plot?.project_id || '',
        projectName: one(plot?.projects)?.name || '',
        plotId: j.plot_id,
        plotName: plot?.name || '',
        name: boq?.item_name || '-',
        status: j.status || 'pending',
        value: num(boq?.quantity) * num(j.agreed_price_per_unit ?? boq?.price_per_unit),
        paid: (j.payments || []).reduce((s, p) => s + num(p.amount), 0),
        pending: pendingByJob.get(j.id) || 0,
      }
    }),
    bills,
  }
}

// ---------------------------------------------------------------------------
// Plot hub: "apply this crew to the same job on the other plots of the batch"
// ---------------------------------------------------------------------------

export type SiblingJob = { jobId: string; plotId: string; plotName: string }

/**
 * The same job (matched by BOQ job name, so the two "Prime A" codes merge) on
 * the OTHER plots of this plot's batch that still have no crew. The caller
 * assigns them one by one with the existing assignContractor action, so the
 * status rule (a crew starts the job) stays in one place.
 */
export async function getSiblingJobsWithoutCrew(plotId: string, itemName: string): Promise<SiblingJob[]> {
  await requireModuleAccess('projects')
  const supabase = await createClient()
  const { data: mine, error: mineErr } = await supabase.from('plot_group_members').select('group_id').eq('plot_id', plotId).maybeSingle()
  if (mineErr) throw new Error(mineErr.message)
  if (!mine?.group_id) return []
  const { data: members, error: memErr } = await supabase.from('plot_group_members').select('plot_id').eq('group_id', mine.group_id)
  if (memErr) throw new Error(memErr.message)
  const others = (members || []).map((m) => m.plot_id as string).filter((id) => id !== plotId)
  if (others.length === 0) return []
  const { data, error } = await supabase
    .from('job_assignments')
    .select('id, plot_id, plots (name), boq_master:boq_master!job_assignments_boq_item_id_fkey!inner (item_name)')
    .in('plot_id', others)
    .is('contractor_id', null)
    .eq('boq_master.item_name', itemName)
  if (error) throw new Error(error.message)
  return ((data || []) as unknown as { id: string; plot_id: string; plots: { name: string | null } | { name: string | null }[] | null }[])
    .map((r) => ({ jobId: r.id, plotId: r.plot_id, plotName: one(r.plots)?.name || '' }))
    .sort((a, b) => a.plotName.localeCompare(b.plotName, 'th', { numeric: true }))
}
