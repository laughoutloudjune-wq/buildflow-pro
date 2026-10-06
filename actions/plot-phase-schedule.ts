'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireModuleAccess } from '@/lib/auth/route-access'

export type PlotPhaseScheduleRow = {
  contractorTypeId: number
  contractorTypeName: string
  plannedStartDate: string | null
  plannedEndDate: string | null
}

type ScheduleRecord = { contractor_type_id: number; planned_start_date: string | null; planned_end_date: string | null }
type ContractorTypeRecord = { id: number; name: string }
type JobBoqRecord = { boq_master: { contractor_type_id: number | null } | null }

/**
 * Phases relevant to this plot: every contractor_type_id actually present in
 * its job_assignments (via boq_master), merged with whatever planned dates
 * are already saved in plot_phase_schedule - so the editor only ever offers
 * trades that are real work on this plot, and a phase with no dates yet
 * still shows up (empty) instead of being omitted.
 */
export async function getPlotPhaseSchedule(plotId: string): Promise<PlotPhaseScheduleRow[]> {
  await requireModuleAccess('projects')
  const supabase = await createClient()

  const [jobsRes, scheduleRes, typesRes] = await Promise.all([
    supabase
      .from('job_assignments')
      .select('boq_master:boq_master!job_assignments_boq_item_id_fkey (contractor_type_id)')
      .eq('plot_id', plotId),
    supabase
      .from('plot_phase_schedule')
      .select('contractor_type_id, planned_start_date, planned_end_date')
      .eq('plot_id', plotId),
    supabase.from('contractor_types').select('id, name'),
  ])

  const typeNameById = new Map<number, string>((typesRes.data as ContractorTypeRecord[] | null || []).map((t) => [t.id, t.name]))
  const scheduleByTypeId = new Map<number, ScheduleRecord>(
    ((scheduleRes.data || []) as ScheduleRecord[]).map((s) => [s.contractor_type_id, s])
  )

  const usedTypeIds = new Set<number>()
  for (const job of (jobsRes.data || []) as unknown as JobBoqRecord[]) {
    const typeId = job.boq_master?.contractor_type_id
    if (typeId != null) usedTypeIds.add(typeId)
  }

  return [...usedTypeIds]
    .map((typeId) => ({
      contractorTypeId: typeId,
      contractorTypeName: typeNameById.get(typeId) || 'ไม่ระบุประเภทช่าง',
      plannedStartDate: scheduleByTypeId.get(typeId)?.planned_start_date ?? null,
      plannedEndDate: scheduleByTypeId.get(typeId)?.planned_end_date ?? null,
    }))
    .sort((a, b) => {
      if (a.plannedStartDate && b.plannedStartDate) return a.plannedStartDate.localeCompare(b.plannedStartDate)
      if (a.plannedStartDate) return -1
      if (b.plannedStartDate) return 1
      return a.contractorTypeName.localeCompare(b.contractorTypeName, 'th')
    })
}

export type PlotPhaseScheduleResult = { success: true } | { success: false; error: string }

export async function savePlotPhaseSchedule(
  plotId: string,
  projectId: string,
  entries: { contractorTypeId: number; plannedStartDate: string; plannedEndDate: string }[]
): Promise<PlotPhaseScheduleResult> {
  try {
    await requireModuleAccess('projects')

    for (const e of entries) {
      if (new Date(e.plannedStartDate) > new Date(e.plannedEndDate)) {
        return { success: false, error: 'วันเริ่มต้องไม่เกินวันสิ้นสุด' }
      }
    }

    if (entries.length > 0) {
      const supabase = await createClient()
      const { error } = await supabase.from('plot_phase_schedule').upsert(
        entries.map((e) => ({
          plot_id: plotId,
          contractor_type_id: e.contractorTypeId,
          planned_start_date: e.plannedStartDate,
          planned_end_date: e.plannedEndDate,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'plot_id,contractor_type_id' }
      )
      if (error) return { success: false, error: error.message }
    }

    revalidatePath(`/dashboard/projects/${projectId}/${plotId}`)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกแผนงาน' }
  }
}

type HouseModelTemplateRecord = { contractor_type_id: number; sequence_order: number; duration_days: number }

const DAY_MS = 24 * 60 * 60 * 1000

function addDays(dateStr: string, days: number): string {
  const t = new Date(`${dateStr}T00:00:00Z`).getTime() + days * DAY_MS
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * Auto-fills plot_phase_schedule from the house model's duration template
 * the moment a plot's jobs are synced (called from syncPlotJobs in
 * actions/job-actions.ts) - PMs then only hand-edit the exceptions instead of
 * entering every plot's schedule from scratch. Phases sharing a
 * sequence_order run as a "wave" (start together); the next wave starts once
 * the slowest phase in the current one ends - models real parallel trades
 * without needing per-pair lag/overlap parameters. Never overwrites: a no-op
 * whenever the plot already has any schedule rows (generated earlier, or
 * hand-entered), or when the house model has no template defined yet.
 */
export async function generatePlotPhaseScheduleFromTemplate(plotId: string, houseModelId: string): Promise<void> {
  const supabase = await createClient()

  const { data: existing } = await supabase.from('plot_phase_schedule').select('id').eq('plot_id', plotId).limit(1)
  if (existing && existing.length > 0) return

  const { data: templateData } = await supabase
    .from('house_model_phase_template')
    .select('contractor_type_id, sequence_order, duration_days')
    .eq('house_model_id', houseModelId)
    .order('sequence_order', { ascending: true })
  const template = (templateData || []) as HouseModelTemplateRecord[]
  if (template.length === 0) return

  const { data: firstJob } = await supabase
    .from('job_assignments')
    .select('created_at')
    .eq('plot_id', plotId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!firstJob) return

  const groups = new Map<number, HouseModelTemplateRecord[]>()
  for (const t of template) {
    if (!groups.has(t.sequence_order)) groups.set(t.sequence_order, [])
    groups.get(t.sequence_order)!.push(t)
  }
  const orderedGroupKeys = [...groups.keys()].sort((a, b) => a - b)

  let currentStart = (firstJob.created_at as string).slice(0, 10)
  const rows: { plot_id: string; contractor_type_id: number; planned_start_date: string; planned_end_date: string }[] = []
  for (const key of orderedGroupKeys) {
    const group = groups.get(key)!
    let groupEnd = currentStart
    for (const phase of group) {
      const end = addDays(currentStart, phase.duration_days)
      rows.push({ plot_id: plotId, contractor_type_id: phase.contractor_type_id, planned_start_date: currentStart, planned_end_date: end })
      if (end > groupEnd) groupEnd = end
    }
    currentStart = groupEnd
  }

  await supabase.from('plot_phase_schedule').upsert(rows, { onConflict: 'plot_id,contractor_type_id' })
}
