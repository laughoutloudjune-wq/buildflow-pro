'use server'

import { createClient } from '@/lib/supabase/server'

export async function getDashboardStats() {
  const supabase = await createClient()

  // 1. ดึงจำนวนโครงการ
  const { count: projectCount } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })

  // 2. ดึงจำนวนแปลงที่ดิน
  const { count: plotCount } = await supabase
    .from('plots')
    .select('*', { count: 'exact', head: true })

  // 3. ดึงยอดจ่ายเงินรวมทั้งหมด (Total Paid)
  const { data: payments } = await supabase
    .from('payments')
    .select('amount')
  
  const totalPaid = payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0

  // 4. ดึงงานที่กำลังทำอยู่ (Active Jobs)
  const { count: activeJobs } = await supabase
    .from('job_assignments')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'in_progress')

  // 5. ดึงธุรกรรมการจ่ายเงินล่าสุด 5 รายการ (Recent Transactions)
  const { data: recentPayments } = await supabase
    .from('payments')
    .select(`
      id, 
      amount, 
      created_at, 
      note,
      job_assignments (
        plots (name, projects(name))
      )
    `)
    .order('created_at', { ascending: false })
    .limit(5)

  return {
    projectCount: projectCount || 0,
    plotCount: plotCount || 0,
    totalPaid: totalPaid,
    activeJobs: activeJobs || 0,
    recentPayments: recentPayments || []
  }
}