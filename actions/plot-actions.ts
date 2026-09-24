'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireModuleAccess } from '@/lib/auth/route-access'

export type PlotActionResult =
  | { success: true }
  | { success: false; error: string }

// ดึงแปลงทั้งหมดในโครงการ
export async function getPlotsByProjectId(projectId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plots')
    .select(`
      *,
      house_models (id, name, code)
    `)
    .eq('project_id', projectId)
    .order('name', { ascending: true })

  if (error) throw new Error(error.message)
  return data
}

// สร้างแปลงใหม่ + Auto Generate Jobs
// L-10: used to insert the plot then the jobs as two separate round trips -
// a failure between them left a plot with no jobs (or half of them) and no
// way to tell from the UI that anything had gone wrong. plot_create() does
// both inside one function call, so any failure rolls back the whole thing.
export async function createPlot(formData: FormData): Promise<PlotActionResult> {
  try {
    await requireModuleAccess('projects')
    const supabase = await createClient()
    const project_id = String(formData.get('project_id') || '')
    const house_model_id = String(formData.get('house_model_id') || '')
    const name = String(formData.get('name') || '')
    const source_plot_id = String(formData.get('source_plot_id') || '') || null

    if (!name || !house_model_id) {
      return { success: false, error: 'กรุณากรอกชื่อแปลงและเลือกแบบบ้าน' }
    }

    const { error } = await supabase.rpc('plot_create', {
      p_payload: { project_id, house_model_id, name, source_plot_id },
    })
    if (error) return { success: false, error: error.message }

    revalidatePath(`/dashboard/projects/${project_id}`)
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการสร้างแปลง',
    }
  }
}

// Single-field flip for the plot list's inline toggle - updatePlot() requires
// re-sending the whole form (name, house_model_id, ...), which is overkill
// and riskier for a one-click on/off switch.
export async function setPlotSellable(id: string, projectId: string, isSellable: boolean): Promise<PlotActionResult> {
  try {
    await requireModuleAccess('projects')
    const supabase = await createClient()
    const { error } = await supabase.from('plots').update({ is_sellable: isSellable }).match({ id })
    if (error) return { success: false, error: error.message } satisfies PlotActionResult
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true } satisfies PlotActionResult
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'อัปเดตไม่สำเร็จ',
    } satisfies PlotActionResult
  }
}

export async function deletePlot(id: string, projectId: string) {
  try {
    await requireModuleAccess('projects')
    const supabase = await createClient()
    const { error } = await supabase.from('plots').delete().match({ id })
    if (error) {
      // 23503 = foreign_key_violation - a sale (or billed jobs, etc.) still
      // references this plot. plot_sales.plot_id is RESTRICT, not CASCADE
      // (H-06), specifically so this can't silently wipe a sale's payment
      // and receipt history.
      if (error.code === '23503') {
        return { success: false, error: 'แปลงนี้มีข้อมูลการขายหรือรายการอื่นผูกอยู่ ต้องยกเลิกการขาย/รายการเหล่านั้นก่อนจึงจะลบแปลงได้' } satisfies PlotActionResult
      }
      return { success: false, error: error.message } satisfies PlotActionResult
    }
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true } satisfies PlotActionResult
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการลบแปลง',
    } satisfies PlotActionResult
  }
}

// A blank field means "not entered" (null), not zero - distinguishable from
// an actual 0 เนื้อที่/ราคา that someone typed in deliberately.
function parseOptionalNumber(raw: FormDataEntryValue | null): { ok: true; value: number | null } | { ok: false } {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return { ok: true, value: null }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return { ok: false }
  return { ok: true, value: parsed }
}

export async function updatePlot(id: string, projectId: string, formData: FormData) {
  try {
    await requireModuleAccess('projects')
    const supabase = await createClient()
    const name = String(formData.get('name') || '')
    const house_model_id = String(formData.get('house_model_id') || '')
    const is_sellable = formData.get('is_sellable') === 'on'
    const title_deed_no = String(formData.get('title_deed_no') || '').trim() || null

    if (!name || !house_model_id) {
      return { success: false, error: 'กรุณากรอกชื่อแปลงและเลือกแบบบ้าน' } satisfies PlotActionResult
    }

    const landArea = parseOptionalNumber(formData.get('land_area_sqwa'))
    if (!landArea.ok) return { success: false, error: 'เนื้อที่ไม่ถูกต้อง' } satisfies PlotActionResult

    const listPrice = parseOptionalNumber(formData.get('list_price'))
    if (!listPrice.ok) return { success: false, error: 'ราคาตั้งไม่ถูกต้อง' } satisfies PlotActionResult

    // M-07 guard (future only): changing the house model out from under jobs
    // that were generated for the old one is exactly how the Arada Vela 93
    // mismatch happened. Block it once the plot has any job row - the plot's
    // jobs have to be cleared (or the plot recreated) before switching models.
    const { data: existingPlot, error: existingPlotError } = await supabase
      .from('plots')
      .select('house_model_id')
      .eq('id', id)
      .maybeSingle()
    if (existingPlotError) return { success: false, error: existingPlotError.message } satisfies PlotActionResult

    if (existingPlot && existingPlot.house_model_id !== house_model_id) {
      const { count, error: jobsCountError } = await supabase
        .from('job_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('plot_id', id)
      if (jobsCountError) return { success: false, error: jobsCountError.message } satisfies PlotActionResult
      if (count && count > 0) {
        return { success: false, error: 'แปลงนี้มีรายการงานของแบบบ้านเดิมแล้ว เปลี่ยนแบบบ้านไม่ได้' } satisfies PlotActionResult
      }
    }

    const { error } = await supabase
      .from('plots')
      .update({
        name,
        house_model_id,
        is_sellable,
        title_deed_no,
        land_area_sqwa: landArea.value,
        list_price: listPrice.value,
      })
      .match({ id })
    if (error) return { success: false, error: error.message } satisfies PlotActionResult

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/${id}`)
    return { success: true } satisfies PlotActionResult
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการแก้ไขแปลง',
    } satisfies PlotActionResult
  }
}
