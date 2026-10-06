'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireModuleAccess, getDashboardSession } from '@/lib/auth/route-access'

// Commission is a fixed amount (baht), default per project with an optional
// override per plot (WORKFLOW_PLAN.md step 2). Writes go through the
// commission_setting_set/clear RPCs, which check admin/pm/sales_exec.

const MANAGE_ROLES = ['admin', 'pm', 'sales_exec']

export type CommissionOverride = { plotId: string; plotName: string; amount: number }
export type ProjectCommission = {
  projectId: string
  projectName: string
  defaultAmount: number | null
  overrides: CommissionOverride[]
}

export async function getCommissionOverview(): Promise<{ projects: ProjectCommission[]; canManage: boolean } | { error: string }> {
  const { role } = await requireModuleAccess('sales')
  const supabase = await createClient()

  const [projectsRes, settingsRes] = await Promise.all([
    supabase.from('projects').select('id, name').eq('kind', 'development').order('name'),
    supabase.from('commission_settings').select('project_id, plot_id, amount, plots ( name )'),
  ])
  if (projectsRes.error) return { error: 'โหลดโครงการไม่สำเร็จ' }
  if (settingsRes.error) return { error: 'โหลดค่าคอมมิชชันไม่สำเร็จ' }

  const rows = (settingsRes.data || []) as unknown as {
    project_id: string
    plot_id: string | null
    amount: number
    plots: { name: string } | { name: string }[] | null
  }[]

  const projects: ProjectCommission[] = (projectsRes.data || []).map((p) => {
    const mine = rows.filter((r) => r.project_id === p.id)
    return {
      projectId: p.id,
      projectName: p.name,
      defaultAmount: mine.find((r) => r.plot_id === null)?.amount ?? null,
      overrides: mine
        .filter((r) => r.plot_id !== null)
        .map((r) => ({
          plotId: r.plot_id as string,
          plotName: (Array.isArray(r.plots) ? r.plots[0]?.name : r.plots?.name) || '',
          amount: r.amount,
        })),
    }
  })

  return { projects, canManage: MANAGE_ROLES.includes(role) }
}

export type PlotCommission = {
  /** What a new TR for this plot would copy: override, else project default, else 0. */
  effective: number
  source: 'plot' | 'project' | 'none'
  plotOverride: number | null
  projectDefault: number | null
  projectId: string | null
  canManage: boolean
}

/** Not gated with requireModuleAccess - same reasoning as getPlotSaleDetail:
 * the plot page is shared with construction viewers, and RLS on
 * commission_settings (admin/pm/sales/sales_exec) returns nothing for them. */
export async function getPlotCommission(plotId: string): Promise<PlotCommission> {
  const supabase = await createClient()
  const { role } = await getDashboardSession()
  const empty: PlotCommission = { effective: 0, source: 'none', plotOverride: null, projectDefault: null, projectId: null, canManage: false }

  const { data: plot } = await supabase.from('plots').select('project_id').eq('id', plotId).maybeSingle()
  if (!plot) return empty

  const { data } = await supabase
    .from('commission_settings')
    .select('plot_id, amount')
    .eq('project_id', plot.project_id)
  const rows = data || []
  const plotOverride = rows.find((r) => r.plot_id === plotId)?.amount ?? null
  const projectDefault = rows.find((r) => r.plot_id === null)?.amount ?? null

  return {
    effective: plotOverride ?? projectDefault ?? 0,
    source: plotOverride !== null ? 'plot' : projectDefault !== null ? 'project' : 'none',
    plotOverride,
    projectDefault,
    projectId: plot.project_id,
    canManage: MANAGE_ROLES.includes(role),
  }
}

export async function setCommission(input: { projectId?: string; plotId?: string | null; amount: number }): Promise<{ ok: true } | { error: string }> {
  await requireModuleAccess('sales')
  if (!Number.isFinite(input.amount) || input.amount < 0) return { error: 'จำนวนเงินไม่ถูกต้อง' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('commission_setting_set', {
    p_payload: { project_id: input.projectId || null, plot_id: input.plotId || null, amount: input.amount },
  })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/sales/transfer-requests')
  revalidatePath('/dashboard/projects')
  return { ok: true }
}

export async function clearCommission(input: { projectId?: string; plotId?: string | null }): Promise<{ ok: true } | { error: string }> {
  await requireModuleAccess('sales')
  const supabase = await createClient()
  const { error } = await supabase.rpc('commission_setting_clear', {
    p_payload: { project_id: input.projectId || null, plot_id: input.plotId || null },
  })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/sales/transfer-requests')
  revalidatePath('/dashboard/projects')
  return { ok: true }
}
