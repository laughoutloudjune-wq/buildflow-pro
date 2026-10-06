'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getDashboardSession } from '@/lib/auth/route-access'
import { addDaysStr, isMonday, mondayOf, weeksOfMonth, type WeeklyPlanKind, type WeeklyPlanStatus } from '@/lib/weekly-plan'

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
  status: WeeklyPlanStatus
  createdBy: string | null
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

export type WeeklyPlanTargetHint = { plotId: string; plotName: string; projectId: string; text: string; date: string }

export type WeeklyPlanData = {
  role: string
  userId: string
  canManage: boolean
  weekStart: string
  weeks: string[]
  projects: { id: string; name: string }[]
  plots: { id: string; name: string; projectId: string }[]
  owners: { id: string; name: string }[]
  items: WeeklyPlanItem[]
  meetings: WeeklyPlanMeeting[]
  salesRequests: WeeklyPlanSalesRequest[]
  salesPlots: WeeklyPlanSalesPlot[]
  targetHints: WeeklyPlanTargetHint[]
}

export type WeeklyPlanResult = { ok: true } | { error: string }

const ALLOWED_ROLES = ['admin', 'pm', 'foreman']
const KINDS = ['main', 'dc', 'other', 'inspect']

async function getCaller(): Promise<{ error: string } | { userId: string; role: string }> {
  const { user, role } = await getDashboardSession()
  if (!user) return { error: 'กรุณาเข้าสู่ระบบ' }
  if (!ALLOWED_ROLES.includes(role)) return { error: 'ไม่มีสิทธิ์ใช้งานแผนงานประจำสัปดาห์' }
  return { userId: user.id, role: role as string }
}

type RawItem = {
  id: string
  project_id: string
  plot_id: string | null
  week_start: string
  kind: WeeklyPlanKind
  title: string
  owner_id: string | null
  status: WeeklyPlanStatus
  created_by: string | null
  plots: { name: string } | null
  owner: { full_name: string | null } | null
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
  const [projectsRes, plotsRes, ownersRes, itemsRes, meetingsRes, requestsRes, salesPlotsRes, scheduleRes, targetRes] =
    await Promise.all([
      supabase.from('projects').select('id, name').order('name'),
      supabase.from('plots').select('id, name, project_id').order('name'),
      supabase.from('profiles').select('id, full_name, role').in('role', ['admin', 'pm', 'foreman']),
      supabase
        .from('weekly_plan_items')
        .select(
          'id, project_id, plot_id, week_start, kind, title, owner_id, status, created_by, plots(name), owner:profiles!weekly_plan_items_owner_id_fkey(full_name)'
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
    status: r.status,
    createdBy: r.created_by,
  }))

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

  return {
    role: caller.role,
    userId: caller.userId,
    canManage: caller.role === 'admin' || caller.role === 'pm',
    weekStart,
    weeks,
    projects: (projectsRes.data || []) as { id: string; name: string }[],
    plots: ((plotsRes.data || []) as { id: string; name: string; project_id: string }[]).map((p) => ({
      id: p.id,
      name: p.name,
      projectId: p.project_id,
    })),
    owners: ((ownersRes.data || []) as { id: string; full_name: string | null }[]).map((o) => ({
      id: o.id,
      name: o.full_name || 'ไม่ระบุชื่อ',
    })),
    items,
    meetings,
    salesRequests,
    salesPlots,
    targetHints,
  }
}

export type WeeklyPlanItemInput = {
  projectId: string
  plotId: string | null
  weekStart: string
  kind: WeeklyPlanKind
  title: string
  ownerId: string | null
}

function validateInput(input: WeeklyPlanItemInput): string | null {
  if (!input.projectId) return 'กรุณาเลือกโครงการ'
  if (!KINDS.includes(input.kind)) return 'ประเภทงานไม่ถูกต้อง'
  if (!input.title.trim()) return 'กรุณากรอกชื่องาน'
  if (!isMonday(input.weekStart)) return 'สัปดาห์ไม่ถูกต้อง'
  return null
}

/** admin, pm and foreman may create items. */
export async function createWeeklyPlanItem(input: WeeklyPlanItemInput): Promise<WeeklyPlanResult> {
  const caller = await getCaller()
  if ('error' in caller) return caller
  const invalid = validateInput(input)
  if (invalid) return { error: invalid }

  const supabase = await createClient()
  const { error } = await supabase.from('weekly_plan_items').insert({
    project_id: input.projectId,
    plot_id: input.plotId || null,
    week_start: input.weekStart,
    kind: input.kind,
    title: input.title.trim(),
    owner_id: input.ownerId || null,
    created_by: caller.userId,
  })
  if (error) return { error: `เพิ่มรายการไม่สำเร็จ: ${error.message}` }
  revalidatePath('/dashboard/weekly-plan')
  return { ok: true }
}

/** admin/pm edit any item; a foreman only items they created (RLS enforces). */
export async function updateWeeklyPlanItem(id: string, input: WeeklyPlanItemInput): Promise<WeeklyPlanResult> {
  const caller = await getCaller()
  if ('error' in caller) return caller
  const invalid = validateInput(input)
  if (invalid) return { error: invalid }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('weekly_plan_items')
    .update({
      project_id: input.projectId,
      plot_id: input.plotId || null,
      week_start: input.weekStart,
      kind: input.kind,
      title: input.title.trim(),
      owner_id: input.ownerId || null,
    })
    .eq('id', id)
    .select('id')
  if (error) return { error: `แก้ไขรายการไม่สำเร็จ: ${error.message}` }
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
    if (row.kind in summary) summary[row.kind] += 1
    if (!row.owner_id) summary.unassigned += 1
  }
  return summary
}
