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

    // M-07 guard (future only): the screen already filters the source-plot
    // list to the same project + house model, but the server has to check
    // too - this is exactly how the 43 mismatched Arada Vela/Prime rows
    // happened (a plot from the wrong project got picked). Checked before
    // the plot itself is created, so a bad source plot never leaves behind
    // an empty plot with no jobs.
    if (source_plot_id) {
      const { data: sourcePlot, error: sourcePlotError } = await supabase
        .from('plots')
        .select('id, project_id, house_model_id')
        .eq('id', source_plot_id)
        .maybeSingle()

      if (sourcePlotError) return { success: false, error: sourcePlotError.message }
      if (!sourcePlot) return { success: false, error: 'ไม่พบแปลงต้นทางที่เลือก' }
      if (sourcePlot.project_id !== project_id || sourcePlot.house_model_id !== house_model_id) {
        return { success: false, error: 'คัดลอกงานได้เฉพาะจากแปลงในโครงการเดียวกันที่ใช้แบบบ้านเดียวกันเท่านั้น' }
      }
    }

    // 1. สร้างแปลง (Plot)
    const { data: plot, error: plotError } = await supabase
      .from('plots')
      .insert([{ project_id, house_model_id, name }])
      .select()
      .single()

    if (plotError) return { success: false, error: plotError.message }
    if (!plot) return { success: false, error: 'สร้างแปลงไม่สำเร็จ' }

    // 2. สร้าง Job Assignments (เลือกวิธี: copy หรือ from template)
    let jobsToCreate: {
      plot_id: string
      boq_item_id: string
      contractor_id?: string | null
      status: string
    }[] = []

    if (source_plot_id) {
      // --- วิธีที่ 1: คัดลอกจากแปลงอื่น ---
      const { data: sourceJobs, error: sourceJobError } = await supabase
        .from('job_assignments')
        .select('boq_item_id, contractor_id')
        .eq('plot_id', source_plot_id)

      if (sourceJobError) {
        return { success: false, error: 'คัดลอกงานจากแปลงต้นทางไม่สำเร็จ: ' + sourceJobError.message }
      }

      if (sourceJobs) {
        jobsToCreate = sourceJobs
          .filter((job) => Boolean(job.boq_item_id))
          .map((job) => ({
            plot_id: plot.id,
            boq_item_id: String(job.boq_item_id),
            contractor_id: job.contractor_id ?? null, // คัดลอกผู้รับเหมามาด้วย
            status: 'pending',
          }))
      }
    } else {
      // --- วิธีที่ 2: สร้างจาก BOQ Master Template (ของเดิม) ---
      const { data: boqItems, error: boqError } = await supabase
        .from('boq_master')
        .select('id')
        .eq('house_model_id', house_model_id)

      if (boqError) return { success: false, error: boqError.message }

      if (boqItems) {
        jobsToCreate = boqItems
          .filter((item) => Boolean(item.id))
          .map((item) => ({
            plot_id: plot.id,
            boq_item_id: String(item.id),
            status: 'pending',
          }))
      }
    }

    // 3. Insert Jobs ที่เตรียมไว้
    if (jobsToCreate.length > 0) {
      const { error: jobError } = await supabase.from('job_assignments').insert(jobsToCreate)
      if (jobError) return { success: false, error: 'สร้างรายการงานอัตโนมัติไม่สำเร็จ: ' + jobError.message }
    }

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
