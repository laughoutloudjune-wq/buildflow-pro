'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getDashboardSession } from '@/lib/auth/route-access'
import { houseTypeLabel } from '@/lib/house-type'
import { fetchAllRows } from '@/actions/_shared/fetch-all-rows'
import { fetchLatestJobProgress } from '@/actions/_shared/job-progress'
import { addDaysStr, currentProgress, isMonday, jobMaterialUsage, mondayOf, rolloverPlan, weeksOfMonth, type WeeklyPlanKind, type WeeklyPlanStatus } from '@/lib/weekly-plan'

export type WeeklyPlanItem = {
  id: string
  projectId: string
  plotId: string | null
  plotName: string | null
  weekStart: string
  kind: WeeklyPlanKind
  title: string
  ownerId: string | null
  ownerName: string | null
  contractorId: string | null
  contractorName: string | null
  carryPct: number | null
  /** % of the work planned to be complete at the end of each day, Mon..Sun */
  planPct: (number | null)[]
  actualPct: (number | null)[]
  note: string | null
  status: WeeklyPlanStatus
  createdBy: string | null
  /** Set for BOQ work: the plot's job assignment this row schedules. Null = manual (non-BOQ) work. */
  jobAssignmentId: string | null
  jobQuantity: number | null
  jobUnit: string | null
  jobTrade: string | null
  jobBoqItemId: string | null
  /** BOQ work only: how many of the job's materials are ordered or issued beyond the plot's BOQ (+ allowed waste) */
  materialOverCount: number
  /** BOQ work only (null otherwise or when the job has no BOQ materials): the job's share of the house's BOQ material, % */
  materialBoqPct: number | null
  /** BOQ work only: % of that BOQ material already ordered for the plot (POs) */
  materialUsedPct: number | null
}

/** One BOQ job on a plot, offered in the plan editor. No prices are exposed. */
export type WeeklyPlanJob = {
  id: string
  plotId: string
  plotName: string
  /** The BOQ line; the same line has a different job row on each plot */
  boqItemId: string
  title: string
  trade: string | null
  quantity: number | null
  unit: string | null
  /** job_assignments.status: pending / in_progress / completed - context only, not physical progress */
  status: string
  contractorId: string | null
  contractorName: string | null
  /** weeks (Mondays) in which this job already has a plan row */
  plannedWeeks: string[]
}

export type WeeklyPlanMeeting = { projectId: string; weekStart: string; agreedAt: string; agreedByName: string | null }

export type WeeklyPlanSalesRequest = {
  id: string
  requestNo: string | null
  title: string
  plotId: string
  plotName: string
  projectId: string
  neededBy: string | null
  status: string
}

export type WeeklyPlanSalesPlot = {
  plotId: string
  plotName: string
  projectId: string
  statusCode: string
  statusLabel: string
}

/** A BOQ job left unfinished last week and not yet in this week's plan */
export type WeeklyPlanCarryOver = { projectId: string; plotId: string | null; plotName: string | null; title: string }

export type WeeklyPlanTargetHint = { plotId: string; plotName: string; projectId: string; text: string; date: string }

export type WeeklyPlanData = {
  role: string
  userId: string
  canManage: boolean
  weekStart: string
  weeks: string[]
  projects: { id: string; name: string }[]
  plots: { id: string; name: string; projectId: string; /** "Prime A · แฝด" */ houseType: string }[]
  /** The team's plot groups (batches built together), e.g. "แปลง 103-107", with their member plots */
  plotGroups: { id: string; name: string; projectId: string; plotIds: string[] }[]
  owners: { id: string; name: string }[]
  contractors: { id: string; name: string }[]
  items: WeeklyPlanItem[]
  meetings: WeeklyPlanMeeting[]
  salesRequests: WeeklyPlanSalesRequest[]
  salesPlots: WeeklyPlanSalesPlot[]
  targetHints: WeeklyPlanTargetHint[]
  carryOver: WeeklyPlanCarryOver[]
}

export type WeeklyPlanResult = { ok: true } | { error: string }

const ALLOWED_ROLES = ['admin', 'pm', 'foreman']
const KINDS = ['main', 'dc', 'other', 'inspect', 'repair']

async function getCaller(): Promise<{ error: string } | { userId: string; role: string }> {
  const { user, role } = await getDashboardSession()
  if (!user) return { error: 'กรุณาเข้าสู่ระบบ' }
  if (!ALLOWED_ROLES.includes(role)) return { error: 'ไม่มีสิทธิ์ใช้งานแผนงานประจำสัปดาห์' }
  return { userId: user.id, role: role as string }
}

function padDays(v: (number | null)[] | null): (number | null)[] {
  const out: (number | null)[] = Array(7).fill(null)
  ;(v || []).slice(0, 7).forEach((x, i) => {
    out[i] = x == null ? null : Number(x)
  })
  return out
}

type RawItem = {
  id: string
  project_id: string
  plot_id: string | null
  week_start: string
  kind: WeeklyPlanKind
  title: string
  owner_id: string | null
  contractor_id: string | null
  carry_pct: number | null
  plan_pct: (number | null)[] | null
  actual_pct: (number | null)[] | null
  note: string | null
  status: WeeklyPlanStatus
  created_by: string | null
  job_assignment_id: string | null
  plots: { name: string } | null
  owner: { full_name: string | null } | null
  contractor: { name: string } | null
  job_assignments: {
    boq_item_id: string | null
    boq_master: { quantity: number | null; unit: string | null; contractor_types: { name: string } | null } | null
  } | null
}

type Supa = Awaited<ReturnType<typeof createClient>>

/**
 * Fills materialBoqPct / materialUsedPct on the BOQ items: the job's BOQ
 * materials (the house type's BOQ) against what has been ordered for the plot.
 * Reuses boq_control_rollup so "ordered for this plot" is computed exactly as
 * on the cost-control page (batch POs split across plots included). Best-effort -
 * the plan page must still load if this fails, so errors leave the fields null.
 * Only percentages leave here, never prices.
 */
async function attachMaterialUsage(supabase: Supa, items: WeeklyPlanItem[], boqItemIds: (string | null)[]) {
  const targets = items.map((it, i) => ({ it, boqId: boqItemIds[i] })).filter((t) => t.it.jobAssignmentId && t.it.plotId && t.boqId)
  if (targets.length === 0) return
  try {
    const boqIds = [...new Set(targets.map((t) => t.boqId as string))]
    const plots = new Map<string, string>() // plotId -> projectId
    for (const t of targets) plots.set(t.it.plotId as string, t.it.projectId)

    const jobMats: { boq_id: string; material_type_id: number; planned_quantity: number | string }[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('boq_material_items')
        .select('boq_id, material_type_id, planned_quantity')
        .in('boq_id', boqIds)
        .order('id')
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      jobMats.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    const matsOfJob = new Map<string, { materialTypeId: number; plannedQty: number }[]>()
    for (const m of jobMats) {
      const list = matsOfJob.get(m.boq_id) ?? []
      list.push({ materialTypeId: m.material_type_id, plannedQty: Number(m.planned_quantity) })
      matsOfJob.set(m.boq_id, list)
    }

    const planned = new Map<string, Map<number, number>>()
    const ordered = new Map<string, Map<number, number>>()
    const ceiling = new Map<string, Map<number, number>>()
    const issued = new Map<string, Map<number, number>>()
    await Promise.all(
      [...plots].map(async ([plotId, projectId]) => {
        const { data, error } = await supabase.rpc('boq_control_rollup', { p_project_id: projectId, p_scope: { plot_group_id: null, plot_ids: [plotId] } })
        if (error) throw new Error(error.message)
        const p = new Map<number, number>()
        const o = new Map<number, number>()
        const c = new Map<number, number>()
        const i = new Map<number, number>()
        for (const r of (data || []) as { material_type_id: number; planned_qty: number | string; allowance_qty: number | string; ordered_qty: number | string; issued_qty: number | string }[]) {
          p.set(r.material_type_id, Number(r.planned_qty))
          o.set(r.material_type_id, Number(r.ordered_qty))
          c.set(r.material_type_id, Number(r.planned_qty) + Number(r.allowance_qty))
          i.set(r.material_type_id, Number(r.issued_qty))
        }
        planned.set(plotId, p)
        ordered.set(plotId, o)
        ceiling.set(plotId, c)
        issued.set(plotId, i)
      })
    )

    for (const { it, boqId } of targets) {
      const usage = jobMaterialUsage(matsOfJob.get(boqId as string) ?? [], planned.get(it.plotId as string) ?? new Map(), ordered.get(it.plotId as string) ?? new Map())
      it.materialBoqPct = usage?.boqSharePct ?? null
      it.materialUsedPct = usage?.usedPct ?? null
      const cap = ceiling.get(it.plotId as string)
      const ord = ordered.get(it.plotId as string)
      const iss = issued.get(it.plotId as string)
      it.materialOverCount = (matsOfJob.get(boqId as string) ?? []).filter((m) => {
        const limit = cap?.get(m.materialTypeId) ?? 0
        return limit > 0 && ((ord?.get(m.materialTypeId) ?? 0) > limit || (iss?.get(m.materialTypeId) ?? 0) > limit)
      }).length
    }
  } catch {
    // leave the material columns empty rather than break the plan page
  }
}

/** Loads everything the page needs: the whole month containing `weekStart`
 * (for the monthly view) plus the read-only sales/target hints for the week. */
export async function getWeeklyPlanData(weekStartInput: string): Promise<WeeklyPlanData | { error: string }> {
  const caller = await getCaller()
  if ('error' in caller) return caller

  const weekStart = isMonday(weekStartInput) ? weekStartInput : mondayOf(weekStartInput)
  const weeks = weeksOfMonth(weekStart)
  const rangeStart = weeks[0]
  const rangeEnd = addDaysStr(weeks[weeks.length - 1], 6)
  const weekEnd = addDaysStr(weekStart, 6)

  const supabase = await createClient()
  const [projectsRes, plotsRes, ownersRes, contractorsRes, itemsRes, meetingsRes, requestsRes, salesPlotsRes, scheduleRes, targetRes, groupsRes] =
    await Promise.all([
      supabase.from('projects').select('id, name').order('name'),
      supabase.from('plots').select('id, name, project_id, house_models(name, code)').order('name'),
      supabase.from('profiles').select('id, full_name, role').in('role', ['admin', 'pm', 'foreman']),
      supabase.from('contractors').select('id, name').order('name'),
      supabase
        .from('weekly_plan_items')
        .select(
          'id, project_id, plot_id, week_start, kind, title, owner_id, contractor_id, carry_pct, plan_pct, actual_pct, note, status, created_by, job_assignment_id, plots(name), owner:profiles!weekly_plan_items_owner_id_fkey(full_name), contractor:contractors(name), job_assignments(boq_item_id, boq_master(quantity, unit, contractor_types(name)))'
        )
        .gte('week_start', rangeStart)
        .lte('week_start', rangeEnd)
        .order('created_at', { ascending: true }),
      supabase
        .from('weekly_plan_meetings')
        .select('project_id, week_start, agreed_at, agreer:profiles!weekly_plan_meetings_agreed_by_fkey(full_name)')
        .gte('week_start', rangeStart)
        .lte('week_start', rangeEnd),
      supabase
        .from('sales_work_requests')
        .select('id, request_no, title, plot_id, needed_by, status, plots(name, project_id)')
        .not('status', 'in', '(done,rejected)')
        .order('needed_by', { ascending: true, nullsFirst: false }),
      supabase.rpc('weekly_plan_sales_plots'),
      supabase
        .from('plot_phase_schedule')
        .select('plot_id, planned_start_date, planned_end_date, contractor_types(name), plots(name, project_id)')
        .or(
          `and(planned_start_date.gte.${weekStart},planned_start_date.lte.${weekEnd}),and(planned_end_date.gte.${weekStart},planned_end_date.lte.${weekEnd})`
        ),
      supabase
        .from('plots')
        .select('id, name, project_id, target_completion_date')
        .gte('target_completion_date', weekStart)
        .lte('target_completion_date', weekEnd),
      supabase.from('plot_groups').select('id, name, project_id, plot_group_members(plot_id)').order('name'),
    ])

  const firstError = [projectsRes, plotsRes, itemsRes, meetingsRes].find((r) => r.error)?.error
  if (firstError) return { error: `โหลดแผนงานไม่สำเร็จ: ${firstError.message}` }

  const items: WeeklyPlanItem[] = ((itemsRes.data || []) as unknown as RawItem[]).map((r) => ({
    id: r.id,
    projectId: r.project_id,
    plotId: r.plot_id,
    plotName: r.plots?.name ?? null,
    weekStart: r.week_start,
    kind: r.kind,
    title: r.title,
    ownerId: r.owner_id,
    ownerName: r.owner?.full_name ?? null,
    contractorId: r.contractor_id,
    contractorName: r.contractor?.name ?? null,
    carryPct: r.carry_pct == null ? null : Number(r.carry_pct),
    planPct: padDays(r.plan_pct),
    actualPct: padDays(r.actual_pct),
    note: r.note,
    status: r.status,
    createdBy: r.created_by,
    jobAssignmentId: r.job_assignment_id,
    jobQuantity: r.job_assignments?.boq_master?.quantity == null ? null : Number(r.job_assignments.boq_master.quantity),
    jobUnit: r.job_assignments?.boq_master?.unit ?? null,
    jobTrade: r.job_assignments?.boq_master?.contractor_types?.name ?? null,
    jobBoqItemId: r.job_assignments?.boq_item_id ?? null,
    materialOverCount: 0,
    materialBoqPct: null,
    materialUsedPct: null,
  }))

  await attachMaterialUsage(
    supabase,
    items,
    ((itemsRes.data || []) as unknown as RawItem[]).map((r) => r.job_assignments?.boq_item_id ?? null)
  )

  type RawMeeting = { project_id: string; week_start: string; agreed_at: string; agreer: { full_name: string | null } | null }
  const meetings: WeeklyPlanMeeting[] = ((meetingsRes.data || []) as unknown as RawMeeting[]).map((m) => ({
    projectId: m.project_id,
    weekStart: m.week_start,
    agreedAt: m.agreed_at,
    agreedByName: m.agreer?.full_name ?? null,
  }))

  type RawReq = {
    id: string
    request_no: string | null
    title: string
    plot_id: string
    needed_by: string | null
    status: string
    plots: { name: string; project_id: string } | null
  }
  const salesRequests: WeeklyPlanSalesRequest[] = ((requestsRes.data || []) as unknown as RawReq[]).map((r) => ({
    id: r.id,
    requestNo: r.request_no,
    title: r.title,
    plotId: r.plot_id,
    plotName: r.plots?.name || '',
    projectId: r.plots?.project_id || '',
    neededBy: r.needed_by,
    status: r.status,
  }))

  type RawSalesPlot = { plot_id: string; plot_name: string; project_id: string; status_code: string; status_label: string }
  const salesPlots: WeeklyPlanSalesPlot[] = ((salesPlotsRes.data || []) as RawSalesPlot[]).map((p) => ({
    plotId: p.plot_id,
    plotName: p.plot_name,
    projectId: p.project_id,
    statusCode: p.status_code,
    statusLabel: p.status_label,
  }))

  const targetHints: WeeklyPlanTargetHint[] = []
  type RawSched = {
    plot_id: string
    planned_start_date: string
    planned_end_date: string
    contractor_types: { name: string } | null
    plots: { name: string; project_id: string } | null
  }
  for (const s of (scheduleRes.data || []) as unknown as RawSched[]) {
    if (!s.plots) continue
    const trade = s.contractor_types?.name || 'งานช่าง'
    if (s.planned_start_date >= weekStart && s.planned_start_date <= weekEnd) {
      targetHints.push({ plotId: s.plot_id, plotName: s.plots.name, projectId: s.plots.project_id, text: `เริ่ม${trade}`, date: s.planned_start_date })
    }
    if (s.planned_end_date >= weekStart && s.planned_end_date <= weekEnd) {
      targetHints.push({ plotId: s.plot_id, plotName: s.plots.name, projectId: s.plots.project_id, text: `${trade} เสร็จตามแผน`, date: s.planned_end_date })
    }
  }
  for (const p of (targetRes.data || []) as { id: string; name: string; project_id: string; target_completion_date: string }[]) {
    targetHints.push({ plotId: p.id, plotName: p.name, projectId: p.project_id, text: 'เป้าหมายส่งมอบบ้าน', date: p.target_completion_date })
  }
  targetHints.sort((a, b) => a.date.localeCompare(b.date))

  // Last week's BOQ jobs that are not finished and not yet in this week (the "ยกมา" banner).
  const prevWeek = addDaysStr(weekStart, -7)
  const inThisWeek = new Set(items.filter((i) => i.weekStart === weekStart && i.jobAssignmentId).map((i) => `${i.projectId}|${i.jobAssignmentId}`))
  const prevRes = await supabase
    .from('weekly_plan_items')
    .select('project_id, plot_id, title, job_assignment_id, carry_pct, actual_pct, status, plots(name)')
    .eq('week_start', prevWeek)
    .not('job_assignment_id', 'is', null)
  type RawPrev = {
    project_id: string
    plot_id: string | null
    title: string
    job_assignment_id: string
    carry_pct: number | null
    actual_pct: (number | null)[] | null
    status: WeeklyPlanStatus
    plots: { name: string } | null
  }
  const carryOver: WeeklyPlanCarryOver[] = ((prevRes.data || []) as unknown as RawPrev[])
    .filter(
      (r) =>
        r.status !== 'done' &&
        !inThisWeek.has(`${r.project_id}|${r.job_assignment_id}`) &&
        currentProgress({ carryPct: r.carry_pct == null ? null : Number(r.carry_pct), planPct: Array(7).fill(null), actualPct: padDays(r.actual_pct) }) < 100
    )
    .map((r) => ({ projectId: r.project_id, plotId: r.plot_id, plotName: r.plots?.name ?? null, title: r.title }))

  return {
    role: caller.role,
    userId: caller.userId,
    canManage: caller.role === 'admin' || caller.role === 'pm',
    weekStart,
    weeks,
    projects: (projectsRes.data || []) as { id: string; name: string }[],
    plots: ((plotsRes.data || []) as unknown as { id: string; name: string; project_id: string; house_models: { name: string | null; code: string | null } | { name: string | null; code: string | null }[] | null }[]).map((p) => {
      const hm = Array.isArray(p.house_models) ? p.house_models[0] : p.house_models
      return { id: p.id, name: p.name, projectId: p.project_id, houseType: houseTypeLabel(hm?.name, hm?.code) }
    }),
    plotGroups: ((groupsRes.data || []) as unknown as { id: string; name: string; project_id: string; plot_group_members: { plot_id: string }[] }[])
      .map((g) => ({ id: g.id, name: g.name, projectId: g.project_id, plotIds: g.plot_group_members.map((m) => m.plot_id) }))
      .filter((g) => g.plotIds.length > 0),
    owners: ((ownersRes.data || []) as { id: string; full_name: string | null }[]).map((o) => ({
      id: o.id,
      name: o.full_name || 'ไม่ระบุชื่อ',
    })),
    contractors: ((contractorsRes.data || []) as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name })),
    items,
    meetings,
    salesRequests,
    salesPlots,
    targetHints,
    carryOver,
  }
}

const MAX_PICKER_PLOTS = 100

/** BOQ jobs on the given plots, for the plan editor's picker. Never returns prices. */
export async function getPlotsJobsForPlan(plotIds: string[]): Promise<{ jobs: WeeklyPlanJob[] } | { error: string }> {
  const caller = await getCaller()
  if ('error' in caller) return caller
  const ids = [...new Set(plotIds.filter(Boolean))]
  if (ids.length === 0) return { jobs: [] }
  if (ids.length > MAX_PICKER_PLOTS) return { error: `เลือกแปลงได้ไม่เกิน ${MAX_PICKER_PLOTS} แปลงต่อครั้ง` }

  const supabase = await createClient()
  type RawJob = {
    id: string
    plot_id: string
    boq_item_id: string
    status: string | null
    contractor_id: string | null
    contractors: { name: string } | null
    plots: { name: string } | null
    boq_master: { item_name: string; quantity: number | null; unit: string | null; contractor_types: { name: string } | null } | null
  }
  // The API returns at most 1000 rows per request, and many plots can exceed that: page through.
  const all: RawJob[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('job_assignments')
      .select(
        'id, plot_id, boq_item_id, status, contractor_id, contractors(name), plots(name), boq_master(item_name, quantity, unit, contractor_types(name))'
      )
      .in('plot_id', ids)
      .order('id')
      .range(from, from + 999)
    if (error) return { error: `โหลดงาน BOQ ไม่สำเร็จ: ${error.message}` }
    const page = (data || []) as unknown as RawJob[]
    all.push(...page)
    if (page.length < 1000) break
  }
  const raw = all.filter((j) => j.boq_master)

  const planned = new Map<string, string[]>()
  if (raw.length > 0) {
    const { data: rows } = await supabase
      .from('weekly_plan_items')
      .select('job_assignment_id, week_start')
      .in('plot_id', ids)
      .not('job_assignment_id', 'is', null)
    for (const r of (rows || []) as { job_assignment_id: string; week_start: string }[]) {
      planned.set(r.job_assignment_id, [...(planned.get(r.job_assignment_id) || []), r.week_start])
    }
  }

  const jobs: WeeklyPlanJob[] = raw
    .map((j) => ({
      id: j.id,
      plotId: j.plot_id,
      plotName: j.plots?.name ?? '',
      boqItemId: j.boq_item_id,
      title: j.boq_master!.item_name,
      trade: j.boq_master!.contractor_types?.name ?? null,
      quantity: j.boq_master!.quantity == null ? null : Number(j.boq_master!.quantity),
      unit: j.boq_master!.unit,
      status: j.status || 'pending',
      contractorId: j.contractor_id,
      contractorName: j.contractors?.name ?? null,
      plannedWeeks: planned.get(j.id) || [],
    }))
    .sort((a, b) => (a.trade || '').localeCompare(b.trade || '', 'th') || a.title.localeCompare(b.title, 'th'))
  return { jobs }
}

/** One BOQ job on one plot, as the plot board needs it. No prices. */
export type PlotBoardJob = {
  id: string
  plotId: string
  title: string
  /** contractor_types id as text, or 'none' */
  tradeKey: string
  contractorId: string | null
  contractorName: string | null
  /** job_assignments.status - context only */
  status: string
  /** 0-100: latest billing or weekly-plan reading; 100 when the job row is marked completed */
  percent: number
  /** Position of the BOQ line inside its trade (entry order) */
  order: number
  plannedThisWeek: boolean
  /** Planned last week, not ticked done and still under 100% */
  missedLastWeek: boolean
}

export type PlotBoardData = {
  trades: { key: string; name: string }[]
  plots: { id: string; name: string; houseType: string; groupName: string }[]
  jobs: PlotBoardJob[]
}

/** Plots x trade stages for one project and week: the board the planner taps to put work into the week. */
export async function getPlotBoard(projectId: string, weekStart: string): Promise<PlotBoardData | { error: string }> {
  const caller = await getCaller()
  if ('error' in caller) return caller
  if (!projectId) return { error: 'กรุณาเลือกโครงการ' }
  if (!isMonday(weekStart)) return { error: 'สัปดาห์ไม่ถูกต้อง' }

  const supabase = await createClient()
  const prevWeek = addDaysStr(weekStart, -7)
  type RawJob = {
    id: string
    plot_id: string
    status: string | null
    contractor_id: string | null
    contractors: { name: string } | { name: string }[] | null
    boq_master: { item_name: string; contractor_type_id: number | null; created_at: string } | { item_name: string; contractor_type_id: number | null; created_at: string }[] | null
  }
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

  let jobRows: RawJob[]
  try {
    jobRows = await fetchAllRows<RawJob>(
      (from, to) =>
        supabase
          .from('job_assignments')
          .select('id, plot_id, status, contractor_id, contractors(name), boq_master(item_name, contractor_type_id, created_at), plots!inner(project_id)')
          .eq('plots.project_id', projectId)
          .order('id')
          .range(from, to) as unknown as PromiseLike<{ data: RawJob[] | null; error: { message: string } | null }>
    )
  } catch (e) {
    return { error: `โหลดงานของแปลงไม่สำเร็จ: ${e instanceof Error ? e.message : ''}` }
  }

  const [plotsRes, groupsRes, typesRes, templateRes, planRes] = await Promise.all([
    supabase.from('plots').select('id, name, house_models(name, code)').eq('project_id', projectId),
    supabase.from('plot_groups').select('id, name, plot_group_members(plot_id)').eq('project_id', projectId).order('name'),
    supabase.from('contractor_types').select('id, name').order('id'),
    supabase.from('house_model_phase_template').select('contractor_type_id, sequence_order'),
    supabase
      .from('weekly_plan_items')
      .select('job_assignment_id, week_start, status')
      .eq('project_id', projectId)
      .in('week_start', [weekStart, prevWeek])
      .not('job_assignment_id', 'is', null),
  ])
  const failed = [plotsRes, groupsRes, typesRes, planRes].find((r) => r.error)?.error
  if (failed) return { error: `โหลดบอร์ดไม่สำเร็จ: ${failed.message}` }

  let progress = new Map<string, { percent: number }>()
  try {
    progress = await fetchLatestJobProgress(supabase, { projectId })
  } catch {
    // Progress is a nice-to-have on the board; without it every job reads 0.
  }

  const thisWeek = new Set<string>()
  const missed = new Set<string>()
  for (const r of (planRes.data || []) as { job_assignment_id: string; week_start: string; status: string }[]) {
    if (r.week_start === weekStart) thisWeek.add(r.job_assignment_id)
    else if (r.status !== 'done') missed.add(r.job_assignment_id)
  }

  // Trades in build order: the average sequence number from the house-model templates, else by id.
  const seq = new Map<number, number[]>()
  for (const t of (templateRes.data || []) as { contractor_type_id: number; sequence_order: number }[]) {
    seq.set(t.contractor_type_id, [...(seq.get(t.contractor_type_id) || []), t.sequence_order])
  }
  // Without templates, a typical build order by trade name; unknown trades go last, by id.
  const TYPICAL_ORDER = ['โครงสร้าง', 'ก่อฉาบ', 'เหล็ก', 'ประปา', 'ไฟฟ้า', 'ฝ้า', 'กระเบื้อง', 'อลูมิเนียม', 'ไม้', 'สี', 'สุขาภิบาล']
  const seqOf = (id: number, name: string) => {
    const list = seq.get(id)
    if (list && list.length > 0) return list.reduce((a, b) => a + b, 0) / list.length
    const idx = TYPICAL_ORDER.findIndex((k) => name.includes(k))
    return idx >= 0 ? 1000 + idx : 2000 + id
  }

  const jobs: PlotBoardJob[] = []
  const usedTrades = new Set<string>()
  type BoqInfo = { item_name: string; contractor_type_id: number | null; created_at: string }
  const sorted: { j: RawJob; boq: BoqInfo }[] = []
  for (const j of jobRows) {
    const boq = one(j.boq_master) as BoqInfo | null
    if (boq) sorted.push({ j, boq })
  }
  sorted.sort((a, b) => a.boq.created_at.localeCompare(b.boq.created_at))
  sorted.forEach(({ j, boq }, order) => {
    const tradeKey = boq.contractor_type_id == null ? 'none' : String(boq.contractor_type_id)
    usedTrades.add(tradeKey)
    const percent = j.status === 'completed' ? 100 : Math.min(100, Math.round(progress.get(j.id)?.percent ?? 0))
    jobs.push({
      id: j.id,
      plotId: j.plot_id,
      title: boq.item_name,
      tradeKey,
      contractorId: j.contractor_id,
      contractorName: one(j.contractors)?.name ?? null,
      status: j.status || 'pending',
      percent,
      order,
      plannedThisWeek: thisWeek.has(j.id),
      missedLastWeek: missed.has(j.id) && percent < 100,
    })
  })

  const trades = ((typesRes.data || []) as { id: number; name: string }[])
    .filter((t) => usedTrades.has(String(t.id)))
    .sort((a, b) => seqOf(a.id, a.name) - seqOf(b.id, b.name) || a.id - b.id)
    .map((t) => ({ key: String(t.id), name: t.name }))
  if (usedTrades.has('none')) trades.push({ key: 'none', name: 'อื่นๆ' })

  const groupOf = new Map<string, string>()
  for (const g of (groupsRes.data || []) as unknown as { name: string; plot_group_members: { plot_id: string }[] }[]) {
    for (const m of g.plot_group_members) if (!groupOf.has(m.plot_id)) groupOf.set(m.plot_id, g.name)
  }
  const plots = ((plotsRes.data || []) as unknown as { id: string; name: string; house_models: { name: string | null; code: string | null } | { name: string | null; code: string | null }[] | null }[])
    .map((p) => {
      const hm = one(p.house_models)
      return { id: p.id, name: p.name, houseType: houseTypeLabel(hm?.name, hm?.code), groupName: groupOf.get(p.id) || '' }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'th', { numeric: true }))

  return { trades, plots, jobs }
}

/**
 * Sets the note on a plan row (used for the "not done" reason). Any admin/pm/
 * foreman may do this through weekly_plan_set_note when that function exists;
 * until then it falls back to a plain update, which RLS limits to the row's
 * creator and admin/pm.
 */
export async function setWeeklyPlanItemNote(id: string, note: string | null): Promise<WeeklyPlanResult> {
  const caller = await getCaller()
  if ('error' in caller) return caller
  const supabase = await createClient()
  const text = note?.trim() || null
  const viaRpc = await supabase.rpc('weekly_plan_set_note', { p_id: id, p_note: text })
  if (viaRpc.error) {
    const { data, error } = await supabase.from('weekly_plan_items').update({ note: text }).eq('id', id).select('id')
    if (error) return { error: `บันทึกหมายเหตุไม่สำเร็จ: ${error.message}` }
    if (!data || data.length === 0) return { error: 'บันทึกเหตุผลได้เฉพาะผู้สร้างรายการหรือ PM' }
  }
  revalidatePath('/dashboard/weekly-plan')
  return { ok: true }
}

export type WeeklyPlanItemInput = {
  projectId: string
  plotId: string | null
  weekStart: string
  kind: WeeklyPlanKind
  title: string
  /** BOQ work: the job assignment being scheduled. The title is taken from the BOQ, not from `title`. */
  jobAssignmentId?: string | null
  ownerId: string | null
  contractorId?: string | null
  carryPct?: number | null
  planPct?: (number | null)[]
  actualPct?: (number | null)[]
  note?: string | null
}

function detailColumns(input: Pick<WeeklyPlanItemInput, 'contractorId' | 'carryPct' | 'planPct' | 'actualPct' | 'note'>) {
  const pct = (v: (number | null)[] | undefined) => {
    if (!v || v.every((x) => x == null)) return null
    return v.slice(0, 7).map((x) => (x == null || Number.isNaN(x) ? null : Math.min(100, Math.max(0, x))))
  }
  return {
    contractor_id: input.contractorId || null,
    carry_pct: input.carryPct == null || Number.isNaN(input.carryPct) ? null : Math.min(100, Math.max(0, input.carryPct)),
    plan_pct: pct(input.planPct),
    actual_pct: pct(input.actualPct),
    note: input.note?.trim() || null,
  }
}

function validateInput(input: WeeklyPlanItemInput): string | null {
  if (!input.projectId) return 'กรุณาเลือกโครงการ'
  if (!KINDS.includes(input.kind)) return 'ประเภทงานไม่ถูกต้อง'
  if (!input.jobAssignmentId && !input.title.trim()) return 'กรุณากรอกชื่องาน'
  if (input.jobAssignmentId && !input.plotId) return 'งาน BOQ ต้องระบุแปลง'
  if (!isMonday(input.weekStart)) return 'สัปดาห์ไม่ถูกต้อง'
  return null
}

const DUPLICATE_MESSAGE = 'งานนี้ถูกวางแผนในสัปดาห์ที่เลือกแล้ว'

/** Turns database errors into messages a planner can act on. */
function planErrorMessage(prefix: string, error: { code?: string; message: string }): string {
  if (error.code === '23505') return `${prefix}: ${DUPLICATE_MESSAGE}`
  return `${prefix}: ${error.message}`
}

type VerifiedJob = { id: string; plotId: string; title: string; contractorId: string | null }

/** Loads the given job assignments from the database and checks that every one
 * belongs to one of `plotIds` in `projectId`. Titles come from the BOQ, never the client. */
async function verifyJobs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobIds: string[],
  plotIds: string[],
  projectId: string
): Promise<{ error: string } | { jobs: VerifiedJob[] }> {
  const { data, error } = await supabase
    .from('job_assignments')
    .select('id, plot_id, contractor_id, plots(project_id), boq_master(item_name)')
    .in('id', jobIds)
  if (error) return { error: `ตรวจสอบงาน BOQ ไม่สำเร็จ: ${error.message}` }

  type Row = {
    id: string
    plot_id: string | null
    contractor_id: string | null
    plots: { project_id: string } | null
    boq_master: { item_name: string } | null
  }
  const rows = (data || []) as unknown as Row[]
  const jobs: VerifiedJob[] = []
  for (const id of jobIds) {
    const r = rows.find((x) => x.id === id)
    if (!r || !r.boq_master) return { error: 'ไม่พบงาน BOQ ที่เลือก' }
    if (!r.plot_id || !plotIds.includes(r.plot_id)) return { error: 'งาน BOQ ที่เลือกไม่ใช่ของแปลงที่เลือก' }
    if (r.plots?.project_id !== projectId) return { error: 'งาน BOQ ที่เลือกไม่ใช่ของโครงการนี้' }
    jobs.push({ id, plotId: r.plot_id, title: r.boq_master.item_name, contractorId: r.contractor_id })
  }
  return { jobs }
}

export type WeeklyPlanBatchInput = Omit<WeeklyPlanItemInput, 'plotId' | 'weekStart' | 'jobAssignmentId'> & {
  /** Manual (non-BOQ) work: one item is created per plot; empty means a single item with no plot. */
  plotIds: string[]
  /** BOQ work: one item is created per job per week. Each job must belong to one of `plotIds`. */
  jobAssignmentIds?: string[]
  /** BOQ work: starting % and daily PLAN per job (a job already part-done starts from where it is). Falls back to the shared carryPct / planPct. */
  jobPlans?: Record<string, { carryPct: number | null; planPct: (number | null)[] }>
  /** BOQ work: crew for jobs that have none yet, by job id. */
  jobContractors?: Record<string, string>
  /** One item is created per week (Mondays). */
  weekStarts: string[]
}

const MAX_BATCH = 300

/** Creates plan items. Manual work: the same item for every selected plot in
 * every selected week. BOQ work: one item per selected job per selected week,
 * with title and contractor taken from the database. */
export async function createWeeklyPlanItems(input: WeeklyPlanBatchInput): Promise<WeeklyPlanResult & { created?: number }> {
  const caller = await getCaller()
  if ('error' in caller) return caller
  const weeks = [...new Set(input.weekStarts)]
  if (weeks.length === 0) return { error: 'กรุณาเลือกสัปดาห์' }
  const jobIds = [...new Set(input.jobAssignmentIds || [])]
  const isBoq = jobIds.length > 0
  const plotIds = input.plotIds.length > 0 ? [...new Set(input.plotIds)] : [null]
  if (isBoq && plotIds[0] == null) return { error: 'งาน BOQ ต้องระบุแปลง' }
  for (const w of weeks) {
    const invalid = validateInput({
      ...input,
      plotId: plotIds[0],
      weekStart: w,
      jobAssignmentId: isBoq ? jobIds[0] : null,
      kind: isBoq ? 'main' : input.kind,
    })
    if (invalid) return { error: invalid }
  }
  const count = isBoq ? jobIds.length * weeks.length : plotIds.length * weeks.length
  if (count > MAX_BATCH) return { error: `สร้างครั้งเดียวได้ไม่เกิน ${MAX_BATCH} รายการ` }

  const supabase = await createClient()
  const detail = detailColumns(input)
  let rows: Record<string, unknown>[]

  if (isBoq) {
    const verified = await verifyJobs(supabase, jobIds, plotIds as string[], input.projectId)
    if ('error' in verified) return verified
    const { data: existing, error: existingError } = await supabase
      .from('weekly_plan_items')
      .select('job_assignment_id')
      .in('job_assignment_id', jobIds)
      .in('week_start', weeks)
    if (existingError) return { error: `ตรวจสอบรายการซ้ำไม่สำเร็จ: ${existingError.message}` }
    if ((existing || []).length > 0) return { error: DUPLICATE_MESSAGE }

    rows = weeks.flatMap((week) =>
      verified.jobs.map((job) => {
        const own = input.jobPlans?.[job.id]
        const own_detail = own ? detailColumns({ ...input, carryPct: own.carryPct, planPct: own.planPct }) : detail
        return {
          project_id: input.projectId,
          plot_id: job.plotId,
          week_start: week,
          kind: 'main',
          title: job.title,
          job_assignment_id: job.id,
          owner_id: input.ownerId || null,
          ...own_detail,
          // Contractor chosen in the plan wins; otherwise the job's own contractor, if any.
          contractor_id: input.jobContractors?.[job.id] || own_detail.contractor_id || job.contractorId,
          created_by: caller.userId,
        }
      })
    )
  } else {
    if (!input.title.trim()) return { error: 'กรุณากรอกชื่องาน' }
    rows = weeks.flatMap((week) =>
      plotIds.map((plotId) => ({
        project_id: input.projectId,
        plot_id: plotId,
        week_start: week,
        kind: input.kind,
        title: input.title.trim(),
        owner_id: input.ownerId || null,
        ...detail,
        created_by: caller.userId,
      }))
    )
  }

  const { error } = await supabase.from('weekly_plan_items').insert(rows)
  if (error) return { error: planErrorMessage('เพิ่มรายการไม่สำเร็จ', error) }
  revalidatePath('/dashboard/weekly-plan')
  return { ok: true, created: rows.length }
}

/** admin/pm edit any item; a foreman only items they created (RLS enforces).
 * For BOQ work the title always comes from the BOQ and the job must belong to the plot. */
export async function updateWeeklyPlanItem(id: string, input: WeeklyPlanItemInput): Promise<WeeklyPlanResult> {
  const caller = await getCaller()
  if ('error' in caller) return caller
  const invalid = validateInput(input)
  if (invalid) return { error: invalid }

  const supabase = await createClient()
  let title = input.title.trim()
  if (input.jobAssignmentId) {
    const verified = await verifyJobs(supabase, [input.jobAssignmentId], [input.plotId!], input.projectId)
    if ('error' in verified) return verified
    title = verified.jobs[0].title
  }

  const { data, error } = await supabase
    .from('weekly_plan_items')
    .update({
      project_id: input.projectId,
      plot_id: input.plotId || null,
      week_start: input.weekStart,
      kind: input.kind,
      title,
      job_assignment_id: input.jobAssignmentId || null,
      owner_id: input.ownerId || null,
      ...detailColumns(input),
    })
    .eq('id', id)
    .select('id')
  if (error) return { error: planErrorMessage('แก้ไขรายการไม่สำเร็จ', error) }
  if (!data || data.length === 0) return { error: 'แก้ไขได้เฉพาะรายการที่คุณสร้างเอง' }
  revalidatePath('/dashboard/weekly-plan')
  return { ok: true }
}

export async function deleteWeeklyPlanItem(id: string): Promise<WeeklyPlanResult> {
  const caller = await getCaller()
  if ('error' in caller) return caller
  const supabase = await createClient()
  const { data, error } = await supabase.from('weekly_plan_items').delete().eq('id', id).select('id')
  if (error) return { error: `ลบรายการไม่สำเร็จ: ${error.message}` }
  if (!data || data.length === 0) return { error: 'ลบได้เฉพาะรายการที่คุณสร้างเอง' }
  revalidatePath('/dashboard/weekly-plan')
  return { ok: true }
}

/** Anyone on the construction side (admin, pm, foreman) may tick done. */
export async function setWeeklyPlanItemStatus(id: string, status: WeeklyPlanStatus): Promise<WeeklyPlanResult> {
  const caller = await getCaller()
  if ('error' in caller) return caller
  if (status !== 'planned' && status !== 'done') return { error: 'สถานะไม่ถูกต้อง' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('weekly_plan_set_status', { p_id: id, p_status: status })
  if (error) return { error: `อัปเดตสถานะไม่สำเร็จ: ${error.message}` }
  revalidatePath('/dashboard/weekly-plan')
  return { ok: true }
}

/** Records that this project-week's plan was agreed in the meeting (admin/pm). */
export async function agreeWeeklyPlan(projectId: string, weekStart: string): Promise<WeeklyPlanResult> {
  const caller = await getCaller()
  if ('error' in caller) return caller
  if (caller.role !== 'admin' && caller.role !== 'pm') return { error: 'เฉพาะแอดมินและ PM เท่านั้นที่บันทึกการตกลงแผนได้' }
  if (!projectId || !isMonday(weekStart)) return { error: 'ข้อมูลไม่ถูกต้อง' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('weekly_plan_meetings')
    .upsert(
      { project_id: projectId, week_start: weekStart, agreed_by: caller.userId, agreed_at: new Date().toISOString() },
      { onConflict: 'project_id,week_start' }
    )
  if (error) return { error: `บันทึกการตกลงแผนไม่สำเร็จ: ${error.message}` }
  revalidatePath('/dashboard/weekly-plan')
  return { ok: true }
}

export async function unagreeWeeklyPlan(projectId: string, weekStart: string): Promise<WeeklyPlanResult> {
  const caller = await getCaller()
  if ('error' in caller) return caller
  if (caller.role !== 'admin' && caller.role !== 'pm') return { error: 'เฉพาะแอดมินและ PM เท่านั้น' }
  const supabase = await createClient()
  const { error } = await supabase.from('weekly_plan_meetings').delete().eq('project_id', projectId).eq('week_start', weekStart)
  if (error) return { error: `ยกเลิกการตกลงแผนไม่สำเร็จ: ${error.message}` }
  revalidatePath('/dashboard/weekly-plan')
  return { ok: true }
}

export type WeeklyPlanSummary = { main: number; dc: number; other: number; inspect: number; unassigned: number }

/** Planned (not done) items for the given week across all projects; for the
 * dashboard. Returns zeros for roles that cannot read the plan. */
export async function getWeeklyPlanSummary(weekStart: string): Promise<WeeklyPlanSummary> {
  const summary: WeeklyPlanSummary = { main: 0, dc: 0, other: 0, inspect: 0, unassigned: 0 }
  const { user, role } = await getDashboardSession()
  if (!user || !ALLOWED_ROLES.includes(role)) return summary

  const monday = isMonday(weekStart) ? weekStart : mondayOf(weekStart)
  const supabase = await createClient()
  const { data } = await supabase
    .from('weekly_plan_items')
    .select('kind, owner_id')
    .eq('week_start', monday)
    .eq('status', 'planned')

  for (const row of (data || []) as { kind: WeeklyPlanKind; owner_id: string | null }[]) {
    if (row.kind in summary) summary[row.kind as keyof WeeklyPlanSummary] += 1
    if (!row.owner_id) summary.unassigned += 1
  }
  return summary
}

export type JobMaterialDetailRow = {
  materialTypeId: number
  name: string
  unit: string
  /** this job's BOQ quantity of the material */
  jobQty: number
  /** whole-house BOQ, and the waste allowance on top of it */
  boqQty: number
  allowanceQty: number
  orderedQty: number
  issuedQty: number
  overOrdered: boolean
  overUsed: boolean
  /** the POs / requests / withdrawals behind the plot's figure; only loaded for materials that are over */
  docs: { kind: 'po' | 'pr' | 'stock_out'; docNo: string | null; docDate: string | null; supplier: string | null; plotLabel: string; quantity: number }[]
}

/** The material-by-material picture behind a BOQ task's ordered/used figures. Quantities only, no prices. */
export async function getJobMaterialDetail(plotId: string, projectId: string, boqItemId: string): Promise<{ rows: JobMaterialDetailRow[] } | { error: string }> {
  const caller = await getCaller()
  if ('error' in caller) return caller
  const supabase = await createClient()
  const [matsRes, rollupRes] = await Promise.all([
    supabase.from('boq_material_items').select('material_type_id, planned_quantity').eq('boq_id', boqItemId),
    supabase.rpc('boq_control_rollup', { p_project_id: projectId, p_scope: { plot_group_id: null, plot_ids: [plotId] } }),
  ])
  if (matsRes.error) return { error: `โหลดวัสดุไม่สำเร็จ: ${matsRes.error.message}` }
  if (rollupRes.error) return { error: `โหลดวัสดุไม่สำเร็จ: ${rollupRes.error.message}` }
  type Roll = { material_type_id: number; material_name: string; unit: string; planned_qty: number | string; allowance_qty: number | string; ordered_qty: number | string; issued_qty: number | string }
  const roll = new Map(((rollupRes.data || []) as Roll[]).map((r) => [r.material_type_id, r]))

  const rows: JobMaterialDetailRow[] = []
  for (const m of matsRes.data || []) {
    const r = roll.get(m.material_type_id)
    if (!r) continue
    const boqQty = Number(r.planned_qty)
    const cap = boqQty + Number(r.allowance_qty)
    const orderedQty = Number(r.ordered_qty)
    const issuedQty = Number(r.issued_qty)
    rows.push({
      materialTypeId: m.material_type_id,
      name: r.material_name,
      unit: r.unit,
      jobQty: Number(m.planned_quantity),
      boqQty,
      allowanceQty: Number(r.allowance_qty),
      orderedQty,
      issuedQty,
      overOrdered: cap > 0 && orderedQty > cap,
      overUsed: cap > 0 && issuedQty > cap,
      docs: [],
    })
  }
  await Promise.all(
    rows
      .filter((r) => r.overOrdered || r.overUsed)
      .map(async (r) => {
        const { data } = await supabase.rpc('boq_control_material_detail', {
          p_project_id: projectId,
          p_material_type_id: r.materialTypeId,
          p_scope: { plot_group_id: null, plot_ids: [plotId] },
        })
        r.docs = ((data || []) as { doc_kind: 'po' | 'pr' | 'stock_out'; doc_no: string | null; doc_date: string | null; supplier_name: string | null; plot_label: string; quantity: number | string }[])
          .filter((d) => d.doc_kind !== 'pr')
          .map((d) => ({ kind: d.doc_kind, docNo: d.doc_no, docDate: d.doc_date, supplier: d.supplier_name, plotLabel: d.plot_label, quantity: Number(d.quantity) }))
      })
  )
  rows.sort((a, b) => Number(b.overOrdered || b.overUsed) - Number(a.overOrdered || a.overUsed) || a.name.localeCompare(b.name, 'th'))
  return { rows }
}

/**
 * Records one day of real progress (cumulative %, or null to clear) on a plan row.
 * Open to admin/pm/foreman for ANY row - not just ones they created - through an RPC
 * that touches nothing but actual_pct.
 */
export async function recordWeeklyPlanActual(id: string, day: number, value: number | null): Promise<WeeklyPlanResult> {
  const caller = await getCaller()
  if ('error' in caller) return caller
  if (!Number.isInteger(day) || day < 0 || day > 6) return { error: 'วันไม่ถูกต้อง' }
  if (value != null && (!Number.isFinite(value) || value < 0 || value > 100)) return { error: 'ความคืบหน้าต้องอยู่ระหว่าง 0-100%' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('weekly_plan_record_actual', { p_id: id, p_day: day, p_value: value })
  if (error) return { error: `บันทึกความคืบหน้าไม่สำเร็จ: ${error.message}` }
  revalidatePath('/dashboard/weekly-plan')
  revalidatePath('/dashboard/billing')
  return { ok: true }
}

/**
 * Carries last week's unfinished BOQ jobs into `weekStart` in one click: same
 * job, contractor and owner, with last week's progress as the starting point
 * and a suggested target (see rolloverPlan). Jobs already planned for the week
 * are skipped, so pressing it twice adds nothing. An agreed week stays locked
 * by the database like any other insert.
 */
export async function rollOverWeeklyPlan(projectId: string, weekStart: string): Promise<WeeklyPlanResult & { created?: number }> {
  const caller = await getCaller()
  if ('error' in caller) return caller
  if (!projectId) return { error: 'กรุณาเลือกโครงการ' }
  if (!isMonday(weekStart)) return { error: 'สัปดาห์ไม่ถูกต้อง' }

  const supabase = await createClient()
  const prevWeek = addDaysStr(weekStart, -7)
  const [prevRes, currentRes] = await Promise.all([
    supabase
      .from('weekly_plan_items')
      .select('plot_id, title, job_assignment_id, owner_id, contractor_id, carry_pct, plan_pct, actual_pct, status, note')
      .eq('project_id', projectId)
      .eq('week_start', prevWeek)
      .not('job_assignment_id', 'is', null),
    supabase.from('weekly_plan_items').select('job_assignment_id').eq('project_id', projectId).eq('week_start', weekStart).not('job_assignment_id', 'is', null),
  ])
  if (prevRes.error) return { error: `อ่านแผนสัปดาห์ก่อนไม่สำเร็จ: ${prevRes.error.message}` }
  if (currentRes.error) return { error: `อ่านแผนสัปดาห์นี้ไม่สำเร็จ: ${currentRes.error.message}` }

  const already = new Set((currentRes.data || []).map((r) => r.job_assignment_id as string))
  const rows = (prevRes.data || [])
    .filter((r) => r.status !== 'done' && !already.has(r.job_assignment_id as string))
    .map((r) => ({ prev: r, next: rolloverPlan({ carryPct: r.carry_pct, planPct: padDays(r.plan_pct), actualPct: padDays(r.actual_pct) }) }))
    .filter(({ prev }) => currentProgress({ carryPct: prev.carry_pct, planPct: padDays(prev.plan_pct), actualPct: padDays(prev.actual_pct) }) < 100)
    .map(({ prev, next }) => ({
      project_id: projectId,
      plot_id: prev.plot_id,
      week_start: weekStart,
      kind: 'main',
      title: prev.title,
      job_assignment_id: prev.job_assignment_id,
      owner_id: prev.owner_id,
      contractor_id: prev.contractor_id,
      carry_pct: next.carry,
      plan_pct: next.plan,
      // A missed promise keeps its reason ("✗ ของไม่มา") as context for the new week.
      note: typeof prev.note === 'string' && prev.note.startsWith('✗') && prev.note.slice(1).trim() ? `ยกมา: ${prev.note.slice(1).trim()}` : null,
      created_by: caller.userId,
    }))
  if (rows.length === 0) return { error: 'ไม่มีงานค้างจากสัปดาห์ก่อนที่ต้องต่อ' }

  const { error } = await supabase.from('weekly_plan_items').insert(rows)
  if (error) return { error: planErrorMessage('ต่องานไม่สำเร็จ', error) }
  revalidatePath('/dashboard/weekly-plan')
  return { ok: true, created: rows.length }
}
