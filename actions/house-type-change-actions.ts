'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAuthRole } from '@/actions/_shared/user-role'
import { fetchAllRows } from '@/actions/_shared/fetch-all-rows'
import { similarOldJob, suggestPairs, type HtcCandidateLine, type HtcOldJob, type HtcPlan, type Pairing } from '@/lib/house-type-change'

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
const num = (v: unknown) => Number(v ?? 0) || 0

export type HtcModel = { id: string; name: string; code: string | null; lines: number }

export type HtcPlotSummary = {
  id: string
  name: string
  houseModelId: string | null
  jobs: number
  contractors: number
  paid: number
  billLines: number
  payments: number
  weeklyLines: number
}

export type HtcOverview = { plots: HtcPlotSummary[]; models: HtcModel[] }

/** Everything step 1 needs: plots that have jobs, and the project's house types. */
export async function getHouseTypeChangeOverview(projectId: string): Promise<HtcOverview> {
  await requireAuthRole(['admin'], 'เฉพาะแอดมินเท่านั้น')
  const supabase = await createClient()

  type JobRow = {
    plot_id: string | null
    contractor_id: string | null
    payments: { amount: number | null }[] | null
    billing_jobs: { id: string }[] | null
    plots: { name: string; house_model_id: string | null } | { name: string; house_model_id: string | null }[] | null
  }

  const [jobs, weekly, modelsRes] = await Promise.all([
    fetchAllRows<JobRow>((from, to) =>
      supabase
        .from('job_assignments')
        .select('plot_id, contractor_id, payments(amount), billing_jobs(id), plots!inner(name, house_model_id, project_id)')
        .eq('plots.project_id', projectId)
        .order('id')
        .range(from, to) as unknown as PromiseLike<{ data: JobRow[] | null; error: { message: string } | null }>
    ),
    fetchAllRows<{ plot_id: string | null }>((from, to) =>
      supabase
        .from('weekly_plan_items')
        .select('plot_id')
        .eq('project_id', projectId)
        .not('job_assignment_id', 'is', null)
        .order('id')
        .range(from, to)
    ),
    supabase.from('house_models').select('id, name, code, project_id').or(`project_id.eq.${projectId},project_id.is.null`),
  ])
  if (modelsRes.error) throw new Error(modelsRes.error.message)

  const weeklyByPlot = new Map<string, number>()
  for (const w of weekly) if (w.plot_id) weeklyByPlot.set(w.plot_id, (weeklyByPlot.get(w.plot_id) ?? 0) + 1)

  const byPlot = new Map<string, HtcPlotSummary & { ctrs: Set<string> }>()
  for (const j of jobs) {
    if (!j.plot_id) continue
    const plot = one(j.plots)
    let s = byPlot.get(j.plot_id)
    if (!s) {
      s = {
        id: j.plot_id,
        name: plot?.name ?? '',
        houseModelId: plot?.house_model_id ?? null,
        jobs: 0,
        contractors: 0,
        paid: 0,
        billLines: 0,
        payments: 0,
        weeklyLines: weeklyByPlot.get(j.plot_id) ?? 0,
        ctrs: new Set<string>(),
      }
      byPlot.set(j.plot_id, s)
    }
    s.jobs += 1
    if (j.contractor_id) s.ctrs.add(j.contractor_id)
    for (const p of j.payments ?? []) {
      s.paid += num(p.amount)
      s.payments += 1
    }
    s.billLines += (j.billing_jobs ?? []).length
  }
  const plots = [...byPlot.values()].map(({ ctrs, ...rest }) => ({ ...rest, contractors: ctrs.size }))
  const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })
  plots.sort((a, b) => collator.compare(a.name, b.name))

  const modelIds = (modelsRes.data ?? []).map((m) => m.id as string)
  const lineCounts = new Map<string, number>()
  if (modelIds.length) {
    const lines = await fetchAllRows<{ house_model_id: string | null }>((from, to) =>
      supabase.from('boq_master').select('house_model_id').in('house_model_id', modelIds).order('id').range(from, to)
    )
    for (const l of lines) if (l.house_model_id) lineCounts.set(l.house_model_id, (lineCounts.get(l.house_model_id) ?? 0) + 1)
  }
  const models: HtcModel[] = (modelsRes.data ?? [])
    .map((m) => ({ id: m.id as string, name: (m.name as string) ?? '', code: (m.code as string | null) ?? null, lines: lineCounts.get(m.id as string) ?? 0 }))
    .sort((a, b) => collator.compare(`${a.name} ${a.code ?? ''}`, `${b.name} ${b.code ?? ''}`))

  return { plots, models }
}

export type HtcReviewJob = HtcOldJob & {
  oldLineId: string
  contractor: string | null
  billed: number
  pinned: boolean
  /** contract total today (qty x price) */
  contract: number
}

export type HtcReview = {
  plotId: string
  plotName: string
  jobs: HtcReviewJob[]
  lines: HtcCandidateLine[]
  pairs: Pairing[]
  /** lines with no paired job: default for "create a job with no contractor" */
  unpaired: { key: string; defaultOn: boolean; similarTo: string | null }[]
  /** the new type has no BOQ lines of its own and `lines` are copies of the seed type */
  seeded: boolean
  totals: { jobs: number; contractors: number; paid: number; billed: number; contract: number; weeklyLines: number }
}

/**
 * One plot's review data: its jobs with money, the lines of the new house type
 * (or of the seed type when the new one is empty), and suggested pairs.
 */
export async function getHouseTypeChangeReview(plotId: string, newModelId: string, seedModelId: string | null): Promise<HtcReview> {
  await requireAuthRole(['admin'], 'เฉพาะแอดมินเท่านั้น')
  const supabase = await createClient()

  type Line = { id: string; item_name: string; unit: string | null; quantity: number | null; price_per_unit: number | null }
  type JobRow = {
    id: string
    contractor_id: string | null
    agreed_price_per_unit: number | null
    contractors: { name: string } | { name: string }[] | null
    boq_master: Line | Line[] | null
    payments: { amount: number | null }[] | null
    billing_jobs: { amount: number | null }[] | null
  }

  const [plotRes, jobsRes, newLinesRes, weeklyRes] = await Promise.all([
    supabase.from('plots').select('id, name').eq('id', plotId).maybeSingle(),
    supabase
      .from('job_assignments')
      .select(
        'id, contractor_id, agreed_price_per_unit, contractors(name), boq_master:boq_master!job_assignments_boq_item_id_fkey(id, item_name, unit, quantity, price_per_unit), payments(amount), billing_jobs(amount)'
      )
      .eq('plot_id', plotId),
    supabase.from('boq_master').select('id, item_name, unit, quantity, price_per_unit').eq('house_model_id', newModelId).order('created_at').order('id'),
    supabase.from('weekly_plan_items').select('id', { count: 'exact', head: true }).eq('plot_id', plotId).not('job_assignment_id', 'is', null),
  ])
  if (plotRes.error) throw new Error(plotRes.error.message)
  if (!plotRes.data) throw new Error('ไม่พบแปลง')
  if (jobsRes.error) throw new Error(jobsRes.error.message)
  if (newLinesRes.error) throw new Error(newLinesRes.error.message)

  const jobs: HtcReviewJob[] = ((jobsRes.data ?? []) as unknown as JobRow[]).flatMap((j) => {
    const line = one(j.boq_master)
    if (!line) return []
    const price = j.agreed_price_per_unit ?? line.price_per_unit ?? 0
    const qty = num(line.quantity)
    const paid = (j.payments ?? []).reduce((s, p) => s + num(p.amount), 0)
    return [
      {
        id: j.id,
        oldLineId: line.id,
        name: line.item_name,
        unit: line.unit,
        qty,
        price: num(price),
        paid,
        contractor: one(j.contractors)?.name ?? null,
        billed: (j.billing_jobs ?? []).reduce((s, b) => s + num(b.amount), 0),
        pinned: j.agreed_price_per_unit != null,
        contract: qty * num(price),
      },
    ]
  })
  const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })
  jobs.sort((a, b) => b.paid - a.paid || collator.compare(a.name, b.name))

  const toLine = (l: Line, virtual: boolean): HtcCandidateLine => ({
    key: virtual ? `seed:${l.id}` : l.id,
    name: l.item_name,
    unit: l.unit,
    qty: num(l.quantity),
    price: num(l.price_per_unit),
    virtual,
  })
  let lines: HtcCandidateLine[] = (newLinesRes.data ?? []).map((l) => toLine(l as Line, false))
  let seeded = false
  if (lines.length === 0 && seedModelId && seedModelId !== newModelId) {
    const seedRes = await supabase
      .from('boq_master')
      .select('id, item_name, unit, quantity, price_per_unit')
      .eq('house_model_id', seedModelId)
      .order('created_at')
      .order('id')
    if (seedRes.error) throw new Error(seedRes.error.message)
    lines = (seedRes.data ?? []).map((l) => toLine(l as Line, true))
    seeded = true
  }

  const pairs = suggestPairs(jobs, lines)
  const pairedKeys = new Set(pairs.map((p) => p.lineKey).filter((k): k is string => !!k))
  const unpaired = lines
    .filter((l) => !pairedKeys.has(l.key))
    .map((l) => {
      const sim = similarOldJob(l, jobs)
      return { key: l.key, defaultOn: !sim, similarTo: sim?.name ?? null }
    })

  const contractors = new Set(jobs.map((j) => j.contractor).filter(Boolean)).size
  return {
    plotId,
    plotName: plotRes.data.name as string,
    jobs,
    lines,
    pairs,
    unpaired,
    seeded,
    totals: {
      jobs: jobs.length,
      contractors,
      paid: jobs.reduce((s, j) => s + j.paid, 0),
      billed: jobs.reduce((s, j) => s + j.billed, 0),
      contract: jobs.reduce((s, j) => s + j.contract, 0),
      weeklyLines: weeklyRes.count ?? 0,
    },
  }
}

export type HtcApplyResult =
  | { ok: true; plotId: string; runId: string; moved: number; copiedLines: number; newJobs: number }
  | { ok: false; plotId: string; error: string; diffs?: HtcDiff[] }

export type HtcDiff = { job_id: string | null; field: string; before: unknown; after: unknown }

function parseDiffs(details: string | null | undefined): HtcDiff[] | undefined {
  if (!details) return undefined
  try {
    const v = JSON.parse(details)
    return Array.isArray(v) ? (v as HtcDiff[]) : undefined
  } catch {
    return undefined
  }
}

function toDbPlan(plan: HtcPlan) {
  return {
    plot_id: plan.plotId,
    new_house_model_id: plan.newHouseModelId,
    moves: plan.moves.map((m) => ({
      job_id: m.jobId,
      target_boq_id: m.targetBoqId ?? null,
      copy_from_boq_id: m.copyFromBoqId ?? null,
      accept_new_qty: !!m.acceptNewQty,
    })),
    new_jobs: plan.newJobs.map((n) => ({ boq_id: n.boqId ?? null, copy_from_boq_id: n.copyFromBoqId ?? null })),
  }
}

/**
 * Run the plots one after another. Each plot is its own all-or-nothing
 * database call: a plot whose money check fails is rolled back and reported,
 * the others still run.
 */
export async function applyHouseTypeChanges(projectId: string, plans: HtcPlan[]): Promise<HtcApplyResult[]> {
  await requireAuthRole(['admin'], 'เฉพาะแอดมินเท่านั้น')
  const supabase = await createClient()
  const results: HtcApplyResult[] = []
  for (const plan of plans) {
    const { data, error } = await supabase.rpc('house_type_change_apply', { p_plan: toDbPlan(plan) })
    if (error) {
      const isMoney = error.message === 'MONEY_CHECK_FAILED'
      results.push({
        ok: false,
        plotId: plan.plotId,
        error: isMoney ? 'ยอดเงินไม่ตรงกับก่อนเปลี่ยน แปลงนี้ถูกย้อนกลับ ไม่มีอะไรเปลี่ยน' : error.message,
        diffs: isMoney ? parseDiffs((error as { details?: string }).details) : undefined,
      })
      continue
    }
    const r = data as { run_id: string; moved: number; copied_lines: number; new_jobs: number }
    results.push({ ok: true, plotId: plan.plotId, runId: r.run_id, moved: r.moved, copiedLines: r.copied_lines, newJobs: r.new_jobs })
  }
  revalidatePath(`/dashboard/projects/${projectId}`)
  return results
}

export type HtcRevertResult =
  | { ok: true; removedJobs: number; removedLines: number; keptJobs: number; keptLines: number }
  | { ok: false; error: string; diffs?: HtcDiff[] }

export async function revertHouseTypeChange(projectId: string, runId: string): Promise<HtcRevertResult> {
  await requireAuthRole(['admin'], 'เฉพาะแอดมินเท่านั้น')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('house_type_change_revert', { p_run_id: runId })
  if (error) {
    const isMoney = error.message === 'MONEY_CHECK_FAILED'
    return {
      ok: false,
      error: isMoney ? 'ยอดเงินหลังคืนค่าไม่ตรงกับก่อนเปลี่ยน ระบบจึงไม่คืนค่า ไม่มีอะไรเปลี่ยน' : error.message,
      diffs: isMoney ? parseDiffs((error as { details?: string }).details) : undefined,
    }
  }
  const r = data as { removed_jobs: number; removed_lines: number; kept_jobs: string[]; kept_lines: string[] }
  revalidatePath(`/dashboard/projects/${projectId}`)
  return { ok: true, removedJobs: r.removed_jobs, removedLines: r.removed_lines, keptJobs: r.kept_jobs.length, keptLines: r.kept_lines.length }
}

export type HtcRun = {
  id: string
  createdAt: string
  plotName: string
  oldModel: string
  newModel: string
  status: 'applied' | 'reverted'
  moved: number
  copiedLines: number
  newJobs: number
  paidTotal: number
}

export async function listHouseTypeChangeRuns(projectId: string): Promise<HtcRun[]> {
  await requireAuthRole(['admin'], 'เฉพาะแอดมินเท่านั้น')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('house_type_change_runs')
    .select('id, created_at, status, summary, money_after, old_house_model_id, new_house_model_id, plots(name)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  type Row = {
    id: string
    created_at: string
    status: 'applied' | 'reverted'
    summary: { moved?: number; copied_lines?: number; new_jobs?: number } | null
    money_after: { paid_total?: number } | null
    old_house_model_id: string | null
    new_house_model_id: string | null
    plots: { name: string } | { name: string }[] | null
  }
  const rows = (data ?? []) as unknown as Row[]
  const modelIds = [...new Set(rows.flatMap((r) => [r.old_house_model_id, r.new_house_model_id]).filter((x): x is string => !!x))]
  const names = new Map<string, string>()
  if (modelIds.length) {
    const { data: models, error: mErr } = await supabase.from('house_models').select('id, name, code').in('id', modelIds)
    if (mErr) throw new Error(mErr.message)
    for (const m of models ?? []) names.set(m.id as string, `${m.name}${m.code ? ` · ${m.code}` : ''}`)
  }
  const label = (id: string | null) => (id ? (names.get(id) ?? '—') : '—')
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    plotName: one(r.plots)?.name ?? '',
    oldModel: label(r.old_house_model_id),
    newModel: label(r.new_house_model_id),
    status: r.status,
    moved: r.summary?.moved ?? 0,
    copiedLines: r.summary?.copied_lines ?? 0,
    newJobs: r.summary?.new_jobs ?? 0,
    paidTotal: num(r.money_after?.paid_total),
  }))
}
