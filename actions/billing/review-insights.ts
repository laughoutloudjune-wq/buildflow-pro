'use server'

import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { decodeAdjustmentDescription } from '@/actions/_shared/billing-adjustments'
import { latestPct } from '@/lib/weekly-plan'

// Same gate as the other billing lookups: construction money, never sales.
const MONEY_MODULES = ['billing', 'reports', 'foreman', 'projects', 'cost_control'] as const

export type ReviewWeeklyCheck = {
  weekStart: string
  /** y = ticked done, n = missed (note starts with the cross), '' = not checked */
  mark: 'y' | 'n' | ''
  pct: number | null
  reason: string | null
  target: number
}

export type ReviewMaterialRow = { name: string; unit: string; plan: number; jobPlan: number; used: number; ordered: number; state: 'over' | 'ordered_over' | 'ok' }

export type ReviewJobInsight = {
  weekly: ReviewWeeklyCheck[]
  materials: ReviewMaterialRow[]
  /** Other bills still waiting for review that contain this same job */
  otherPending: { docNo: string; type: string }[]
}

export type ReviewDcInsight = {
  /** Sales requests already linked to this bill */
  linkedRequests: { id: string; requestNo: string | null; title: string; plotName: string }[]
  /** Open sales requests on the bill's plots that are not linked to any bill */
  openRequests: { id: string; requestNo: string | null; title: string; plotName: string }[]
  /** Earlier approved lines with the same description: price range and the most recent one */
  priceRefs: Record<string, { count: number; min: number; max: number; lastPrice: number; lastPlot: string }>
  /** Extra work already approved per plot name, and that plot's job value */
  plotTotals: Record<string, { approved: number; jobValue: number | null }>
  /** Same description on the same plot in another pending or approved DC bill: [description|plot] -> doc numbers */
  duplicates: Record<string, string[]>
}

export type BillingReviewInsights = {
  jobs: Record<string, ReviewJobInsight>
  /** Other pending extra-work bills from the same contractor */
  contractorDcPending: { docNo: string; total: number }[]
  dc: ReviewDcInsight | null
}

type One<T> = T | T[] | null
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const keyOf = (description: string) => description.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Everything the review page looks up to judge a bill beyond its own lines:
 * the weekly site checks, material use against BOQ, other waiting bills for the
 * same job, and for extra work the sales requests, earlier prices and the
 * plot's extra-work total so far. Read-only; anything that fails to load is
 * simply left out so the review page still opens.
 */
export async function getBillingReviewInsights(billingId: string): Promise<BillingReviewInsights> {
  await requireModuleAccess([...MONEY_MODULES])
  const supabase = await createClient()
  const empty: BillingReviewInsights = { jobs: {}, contractorDcPending: [], dc: null }

  const { data: bill } = await supabase
    .from('billings')
    .select(
      'id, doc_no, type, project_id, contractor_id, billing_jobs(job_assignments(id, plot_id, boq_item_id, plots(name))), billing_adjustments(description, quantity, unit_price)'
    )
    .eq('id', billingId)
    .single()
  if (!bill) return empty

  type BJ = { job_assignments: One<{ id: string; plot_id: string | null; boq_item_id: string | null; plots: One<{ name: string }> }> }
  const jobs = ((bill.billing_jobs || []) as unknown as BJ[])
    .map((bj) => one(bj.job_assignments))
    .filter((j): j is NonNullable<typeof j> => !!j)
  const jobIds = [...new Set(jobs.map((j) => j.id))]
  const result: BillingReviewInsights = { jobs: {}, contractorDcPending: [], dc: null }
  for (const id of jobIds) result.jobs[id] = { weekly: [], materials: [], otherPending: [] }

  // ---- weekly site checks, last four weeks per job ------------------------
  if (jobIds.length > 0) {
    try {
      const { data } = await supabase
        .from('weekly_plan_items')
        .select('job_assignment_id, week_start, status, note, carry_pct, plan_pct, actual_pct')
        .in('job_assignment_id', jobIds)
        .order('week_start', { ascending: false })
      for (const r of (data || []) as { job_assignment_id: string; week_start: string; status: string; note: string | null; carry_pct: number | null; plan_pct: (number | null)[] | null; actual_pct: (number | null)[] | null }[]) {
        const list = result.jobs[r.job_assignment_id]?.weekly
        if (!list || list.length >= 4) continue
        const plan = (r.plan_pct || []).filter((v) => v != null)
        const mark = r.status === 'done' ? 'y' : r.note?.startsWith('✗') ? 'n' : ''
        list.push({
          weekStart: r.week_start,
          mark,
          pct: latestPct((r.actual_pct || []).map((v) => (v == null ? null : Number(v))))?.value ?? (r.carry_pct == null ? null : Number(r.carry_pct)),
          reason: r.note?.startsWith('✗') ? r.note.slice(1).trim() || null : null,
          target: plan.length > 0 ? Math.round(Number(plan[plan.length - 1])) : 100,
        })
      }
    } catch {
      // left empty
    }
  }

  // ---- materials of each job on its plot, against BOQ ----------------------
  try {
    const boqIds = [...new Set(jobs.map((j) => j.boq_item_id).filter((v): v is string => !!v))]
    const plotIds = [...new Set(jobs.map((j) => j.plot_id).filter((v): v is string => !!v))]
    if (boqIds.length > 0 && plotIds.length > 0) {
      const { data: mats } = await supabase.from('boq_material_items').select('boq_id, material_type_id, planned_quantity, waste_percent').in('boq_id', boqIds)
      const matsOfBoq = new Map<string, number[]>()
      const jobQty = new Map<string, number>()
      for (const m of (mats || []) as { boq_id: string; material_type_id: number; planned_quantity: number | string | null; waste_percent: number | string | null }[]) {
        matsOfBoq.set(m.boq_id, [...(matsOfBoq.get(m.boq_id) || []), m.material_type_id])
        jobQty.set(`${m.boq_id}:${m.material_type_id}`, num(m.planned_quantity))
      }
      type Roll = { material_type_id: number; material_name: string; unit: string; planned_qty: number | string; allowance_qty: number | string; ordered_qty: number | string; issued_qty: number | string }
      const rollByPlot = new Map<string, Map<number, Roll>>()
      await Promise.all(
        plotIds.map(async (plotId) => {
          const { data } = await supabase.rpc('boq_control_rollup', { p_project_id: bill.project_id, p_scope: { plot_group_id: null, plot_ids: [plotId] } })
          rollByPlot.set(plotId, new Map(((data || []) as Roll[]).map((r) => [r.material_type_id, r])))
        })
      )
      for (const j of jobs) {
        const roll = rollByPlot.get(j.plot_id || '')
        const rows: ReviewMaterialRow[] = []
        for (const typeId of matsOfBoq.get(j.boq_item_id || '') || []) {
          const r = roll?.get(typeId)
          if (!r) continue
          const cap = num(r.planned_qty) + num(r.allowance_qty)
          const used = num(r.issued_qty)
          const ordered = num(r.ordered_qty)
          rows.push({ name: r.material_name, unit: r.unit, plan: cap, jobPlan: jobQty.get(`${j.boq_item_id}:${typeId}`) ?? 0, used, ordered, state: cap > 0 && used > cap ? 'over' : cap > 0 && ordered > cap ? 'ordered_over' : 'ok' })
        }
        if (result.jobs[j.id]) result.jobs[j.id].materials = rows
      }
    }
  } catch {
    // left empty
  }

  // ---- other bills waiting for review that contain the same jobs ----------
  try {
    if (jobIds.length > 0) {
      const { data } = await supabase
        .from('billing_jobs')
        .select('job_assignment_id, billings!inner(id, doc_no, type, status)')
        .in('job_assignment_id', jobIds)
        .eq('billings.status', 'pending_review')
        .neq('billings.id', billingId)
      for (const r of (data || []) as unknown as { job_assignment_id: string; billings: One<{ doc_no: string | number | null; type: string }> }[]) {
        const b = one(r.billings)
        if (b) result.jobs[r.job_assignment_id]?.otherPending.push({ docNo: String(b.doc_no ?? ''), type: b.type })
      }
    }
  } catch {
    // left empty
  }

  // ---- the same contractor's other waiting extra-work bills ---------------
  if (bill.contractor_id) {
    try {
      const { data } = await supabase
        .from('billings')
        .select('doc_no, net_amount, total_work_amount')
        .eq('contractor_id', bill.contractor_id)
        .eq('type', 'extra_work')
        .eq('status', 'pending_review')
        .neq('id', billingId)
      result.contractorDcPending = (data || []).map((b) => ({ docNo: String(b.doc_no ?? ''), total: num(b.net_amount ?? b.total_work_amount) }))
    } catch {
      // left empty
    }
  }

  // ---- extra-work (DC) bills: requests, earlier prices, plot totals --------
  if (bill.type === 'extra_work') {
    const dc: ReviewDcInsight = { linkedRequests: [], openRequests: [], priceRefs: {}, plotTotals: {}, duplicates: {} }
    result.dc = dc
    const lines = ((bill.billing_adjustments || []) as { description: string | null }[]).map((a) => decodeAdjustmentDescription(a.description))
    const plotNames = [...new Set(lines.map((l) => l.plot_name).filter(Boolean))]
    const keys = new Set(lines.map((l) => keyOf(l.description)))

    try {
      const { data: plotRows } = await supabase.from('plots').select('id, name').eq('project_id', bill.project_id)
      const plotIdByName = new Map(((plotRows || []) as { id: string; name: string }[]).map((p) => [p.name, p.id]))
      const billPlotIds = plotNames.map((n) => plotIdByName.get(n)).filter((v): v is string => !!v)

      const [linked, open] = await Promise.all([
        supabase.from('sales_work_requests').select('id, request_no, title, plots(name)').eq('billing_id', billingId),
        billPlotIds.length > 0
          ? supabase
              .from('sales_work_requests')
              .select('id, request_no, title, plots(name)')
              .in('plot_id', billPlotIds)
              .is('billing_id', null)
              .not('status', 'in', '(done,rejected)')
          : Promise.resolve({ data: [] as unknown[] }),
      ])
      const toReq = (r: unknown) => {
        const x = r as { id: string; request_no: string | null; title: string; plots: One<{ name: string }> }
        return { id: x.id, requestNo: x.request_no, title: x.title, plotName: one(x.plots)?.name ?? '' }
      }
      dc.linkedRequests = ((linked.data || []) as unknown[]).map(toReq)
      dc.openRequests = ((open.data || []) as unknown[]).map(toReq)

      // Other DC bills of the project: approved ones give prices and totals, pending/approved ones give duplicates.
      const { data: others } = await supabase
        .from('billings')
        .select('id, doc_no, status, billing_date, created_at, billing_adjustments(type, description, quantity, unit_price)')
        .eq('project_id', bill.project_id)
        .eq('type', 'extra_work')
        .in('status', ['approved', 'paid_out', 'pending_review'])
        .neq('id', billingId)
        .order('created_at', { ascending: true })
      type Other = { doc_no: string | number | null; status: string; billing_adjustments: { type: string; description: string | null; quantity: number | string; unit_price: number | string }[] | null }
      const prices = new Map<string, number[]>()
      const lastOf = new Map<string, { price: number; plot: string }>()
      const approvedByPlot = new Map<string, number>()
      for (const o of (others || []) as unknown as Other[]) {
        const approved = o.status !== 'pending_review'
        for (const a of o.billing_adjustments || []) {
          if (a.type !== 'addition') continue
          const d = decodeAdjustmentDescription(a.description)
          const k = keyOf(d.description)
          if (keys.has(k) && d.plot_name && plotNames.includes(d.plot_name)) {
            const dupKey = `${k}|${d.plot_name}`
            dc.duplicates[dupKey] = [...(dc.duplicates[dupKey] || []), String(o.doc_no ?? '')]
          }
          if (!approved) continue
          const price = num(a.unit_price)
          if (keys.has(k)) {
            prices.set(k, [...(prices.get(k) || []), price])
            lastOf.set(k, { price, plot: d.plot_name })
          }
          if (d.plot_name && plotNames.includes(d.plot_name)) {
            approvedByPlot.set(d.plot_name, (approvedByPlot.get(d.plot_name) || 0) + num(a.quantity) * price)
          }
        }
      }
      for (const [k, list] of prices) {
        const last = lastOf.get(k)!
        dc.priceRefs[k] = { count: list.length, min: Math.min(...list), max: Math.max(...list), lastPrice: last.price, lastPlot: last.plot }
      }

      // Job value of each plot named on the bill, to put the extra work in proportion.
      const valueByPlot = new Map<string, number>()
      if (billPlotIds.length > 0) {
        const { data: jv } = await supabase
          .from('job_assignments')
          .select('plot_id, agreed_price_per_unit, boq_master:boq_master!job_assignments_boq_item_id_fkey(quantity, price_per_unit)')
          .in('plot_id', billPlotIds)
        for (const j of (jv || []) as unknown as { plot_id: string; agreed_price_per_unit: number | null; boq_master: One<{ quantity: number | null; price_per_unit: number | null }> }[]) {
          const b = one(j.boq_master)
          valueByPlot.set(j.plot_id, (valueByPlot.get(j.plot_id) || 0) + num(b?.quantity) * num(j.agreed_price_per_unit ?? b?.price_per_unit))
        }
      }
      for (const name of plotNames) {
        const pid = plotIdByName.get(name)
        dc.plotTotals[name] = { approved: approvedByPlot.get(name) || 0, jobValue: pid ? (valueByPlot.get(pid) ?? null) : null }
      }
    } catch {
      // keep whatever loaded
    }
  }

  return result
}
