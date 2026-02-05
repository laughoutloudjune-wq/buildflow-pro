'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ดึงแปลงทั้งหมดในโครงการ
export async function getPlotsByProjectId(projectId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plots')
    .select(`
      *,
      house_models (name, code)
    `)
    .eq('project_id', projectId)
    .order('name', { ascending: true })

  if (error) throw new Error(error.message)
  return data
}

// สร้างแปลงใหม่ + Auto Generate Jobs
export async function createPlot(formData: FormData) {
  const supabase = await createClient()
  const project_id = formData.get('project_id') as string
  const house_model_id = formData.get('house_model_id') as string
  const name = formData.get('name') as string
  const source_plot_id = formData.get('source_plot_id') as string | null

  if (!name || !house_model_id) {
    throw new Error('Name and House Model are required.')
  }

  // 1. สร้างแปลง (Plot)
  const { data: plot, error: plotError } = await supabase
    .from('plots')
    .insert([{ project_id, house_model_id, name }])
    .select()
    .single()

  if (plotError) throw new Error(plotError.message)
  if (!plot) throw new Error('Failed to create plot.')

  // 2. สร้าง Job Assignments (เลือกวิธี: copy หรือ from template)
  let jobsToCreate = []

  if (source_plot_id) {
    // --- วิธีที่ 1: คัดลอกจากแปลงอื่น ---
    const { data: sourceJobs, error: sourceJobError } = await supabase
      .from('job_assignments')
      .select('boq_item_id, contractor_id')
      .eq('plot_id', source_plot_id)

    if (sourceJobError) throw new Error('Could not fetch source jobs: ' + sourceJobError.message)

    if (sourceJobs) {
      jobsToCreate = sourceJobs.map(job => ({
        plot_id: plot.id,
        boq_item_id: job.boq_item_id,
        contractor_id: job.contractor_id, // คัดลอกผู้รับเหมามาด้วย
        status: 'pending'
      }))
    }
  } else {
    // --- วิธีที่ 2: สร้างจาก BOQ Master Template (ของเดิม) ---
    const { data: boqItems, error: boqError } = await supabase
      .from('boq_master')
      .select('id')
      .eq('house_model_id', house_model_id)

    if (boqError) throw new Error(boqError.message)

    if (boqItems) {
      jobsToCreate = boqItems.map(item => ({
        plot_id: plot.id,
        boq_item_id: item.id,
        status: 'pending'
      }))
    }
  }

  // 3. Insert Jobs ที่เตรียมไว้
  if (jobsToCreate.length > 0) {
    const { error: jobError } = await supabase
      .from('job_assignments')
      .insert(jobsToCreate)
    
    if (jobError) throw new Error('Failed to generate jobs: ' + jobError.message)
  }

  revalidatePath(`/dashboard/projects/${project_id}`)
}

export async function deletePlot(id: string, projectId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('plots').delete().match({ id })
  if (error) throw new Error(error.message)
  revalidatePath(`/dashboard/projects/${projectId}`)
}

export async function updatePlot(id: string, projectId: string, formData: FormData) {
    const supabase = await createClient()
    const name = formData.get('name') as string
    const house_model_id = formData.get('house_model_id') as string

    if (!name || !house_model_id) return

    const { error } = await supabase
        .from('plots')
        .update({ name, house_model_id })
        .match({ id })

    if (error) {
        throw new Error(error.message)
    }

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/${id}`)
}