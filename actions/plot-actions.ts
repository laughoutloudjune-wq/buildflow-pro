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

  if (!name || !house_model_id) return

  // 1. สร้างแปลง (Plot)
  const { data: plot, error: plotError } = await supabase
    .from('plots')
    .insert([{ project_id, house_model_id, name }])
    .select()
    .single()

  if (plotError) throw new Error(plotError.message)

  // 2. ดึง BOQ Master ของแบบบ้านนั้นมาทั้งหมด
  const { data: boqItems, error: boqError } = await supabase
    .from('boq_master')
    .select('id')
    .eq('house_model_id', house_model_id)

  if (boqError) throw new Error(boqError.message)

  // 3. สร้าง Job Assignments อัตโนมัติ (Clone มา)
  if (boqItems && boqItems.length > 0) {
    const jobs = boqItems.map(item => ({
      plot_id: plot.id,
      boq_item_id: item.id,
      status: 'pending'
    }))

    const { error: jobError } = await supabase
      .from('job_assignments')
      .insert(jobs)
    
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