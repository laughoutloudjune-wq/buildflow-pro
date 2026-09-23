'use server'

import { createClient } from '@/lib/supabase/server'
import { computeActualPayout } from '@/lib/billing'
import { fetchAllRows } from '@/actions/_shared/fetch-all-rows'
import { monthRangeInBangkok } from '@/lib/utils'

const COMPLETED_STATUSES = new Set(['completed', 'done', 'approved'])

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function getBillingNetAmount(bill: any): number {
  if (bill?.net_amount != null) return toNumber(bill.net_amount)
  return toNumber(bill?.total_work_amount) + toNumber(bill?.total_add_amount) - toNumber(bill?.total_deduct_amount)
}

export async function getDashboardStats() {
  const supabase = await createClient()

  const BILLINGS_SELECT = `
      id,
      doc_no,
      project_id,
      contractor_id,
      plot_id,
      type,
      status,
      net_amount,
      total_work_amount,
      total_add_amount,
      total_deduct_amount,
      submitted_by,
      approved_by,
      submitted_at,
      approved_at,
      billing_date,
      created_at,
      paid_out_at,
      wht_percent,
      retention_percent,
      wht_applied,
      retention_applied,
      deduct_applied,
      retention_amount,
      wht_amount
    `

  // job_assignments (1,376 live rows) and billings (307 live rows, growing)
  // both cross PostgREST's silent 1,000-row cap eventually - fetchAllRows
  // pages through instead of the plain .limit(500)/no-limit queries this
  // used to run, which is what made "Active Jobs" and every money KPI below
  // quietly undercount once the tables grew (H-03). `payments` stays capped
  // at 20: it now only feeds the "recent activity" list, not a total.
  const [projectsRes, plotsRes, jobs, paymentsRes, billings, contractorsRes, profilesRes] = await Promise.all([
    supabase.from('projects').select('id, name, location, status').eq('kind', 'development'),
    supabase.from('plots').select('id, name, project_id'),
    fetchAllRows<any>((from, to) =>
      supabase.from('job_assignments').select('id, plot_id, contractor_id, status').range(from, to)
    ),
    supabase.from('payments').select('id, amount, created_at, note, job_assignment_id').order('created_at', { ascending: false }).limit(20),
    fetchAllRows<any>((from, to) => supabase.from('billings').select(BILLINGS_SELECT).order('created_at', { ascending: false }).range(from, to)),
    supabase.from('contractors').select('id, name'),
    supabase.from('profiles').select('id, full_name, email, role'),
  ])

  if (projectsRes.error) throw new Error(projectsRes.error.message)
  if (plotsRes.error) throw new Error(plotsRes.error.message)
  if (paymentsRes.error) throw new Error(paymentsRes.error.message)
  if (contractorsRes.error) throw new Error(contractorsRes.error.message)
  if (profilesRes.error) throw new Error(profilesRes.error.message)

  const projects = projectsRes.data || []
  const plots = plotsRes.data || []
  const payments = paymentsRes.data || []
  const contractors = contractorsRes.data || []
  const profiles = profilesRes.data || []

  const projectById = new Map((projects || []).map((p: any) => [String(p.id), p]))
  const contractorById = new Map((contractors || []).map((c: any) => [String(c.id), c]))
  const profileById = new Map((profiles || []).map((p: any) => [String(p.id), p]))
  const plotById = new Map((plots || []).map((p: any) => [String(p.id), p]))
  const jobById = new Map((jobs || []).map((j: any) => [String(j.id), j]))

  // "จ่ายผู้รับเหมาแล้ว" (Paid Out) is money actually transferred to
  // contractors (Q-07/H-02), not the `payments` table (posted at approval
  // time, not payout, and missing DC/deductions/WHT) - the sum every bill
  // ever marked paid_out_at, valued with the exact WHT/retention/deduction
  // formula markBillingsAsPaidOut applied at payout time.
  const paidOutTotal = billings
    .filter((b: any) => !!b.paid_out_at)
    .reduce((sum: number, b: any) => sum + computeActualPayout(b), 0)
  const activeJobs = jobs.filter((j: any) => j.status === 'in_progress').length

  // Bangkok calendar month, not the server's (UUTC) one - before 07:00 local
  // time this used to still count as "last month" (M-01).
  const { start: monthStartStr, end: monthEndStr } = monthRangeInBangkok()
  const now = new Date()
  const monthStart = new Date(`${monthStartStr}T00:00:00+07:00`)
  const monthEnd = new Date(`${monthEndStr}T00:00:00+07:00`)
  const dayMs = 24 * 60 * 60 * 1000
  const staleLimit = new Date(now.getTime() - 3 * dayMs)
  const riskLimit = new Date(now.getTime() - 7 * dayMs)
  const last30d = new Date(now.getTime() - 30 * dayMs)

  const pendingApprovals = billings.filter((b: any) => b.status === 'pending_review').length
  const approvedThisMonth = billings
    .filter((b: any) => {
      if (b.status !== 'approved') return false
      const ref = new Date(b.billing_date || b.created_at || 0)
      return ref >= monthStart && ref < monthEnd
    })
    .reduce((sum: number, b: any) => sum + getBillingNetAmount(b), 0)

  const paidOutThisMonthBills = billings.filter((b: any) => {
    if (!b.paid_out_at) return false
    const at = new Date(b.paid_out_at)
    return at >= monthStart && at < monthEnd
  })
  const paidOutThisMonth = {
    count: paidOutThisMonthBills.length,
    amount: paidOutThisMonthBills.reduce((sum: number, b: any) => sum + computeActualPayout(b), 0),
  }

  const recentApprovalLimit = new Date(now.getTime() - 7 * dayMs)
  const recentlyApprovedBills = billings.filter((b: any) => {
    if (b.status !== 'approved' || !b.approved_at) return false
    return new Date(b.approved_at) >= recentApprovalLimit
  })
  const recentlyApproved = {
    count: recentlyApprovedBills.length,
    amount: recentlyApprovedBills.reduce((sum: number, b: any) => sum + getBillingNetAmount(b), 0),
    unpaidCount: recentlyApprovedBills.filter((b: any) => !b.paid_out_at).length,
  }

  const jobsByProject = new Map<string, any[]>()
  for (const job of jobs) {
    const plot = plotById.get(String(job.plot_id || ''))
    const projectId = plot?.project_id ? String(plot.project_id) : ''
    if (!projectId) continue
    const arr = jobsByProject.get(projectId) || []
    arr.push(job)
    jobsByProject.set(projectId, arr)
  }

  const plotsByProject = new Map<string, any[]>()
  for (const plot of plots) {
    const projectId = String(plot.project_id || '')
    if (!projectId) continue
    const arr = plotsByProject.get(projectId) || []
    arr.push(plot)
    plotsByProject.set(projectId, arr)
  }

  const billsByProject = new Map<string, any[]>()
  for (const bill of billings) {
    const projectId = String(bill.project_id || '')
    if (!projectId) continue
    const arr = billsByProject.get(projectId) || []
    arr.push(bill)
    billsByProject.set(projectId, arr)
  }

  const projectHealth = projects
    .map((project: any) => {
      const projectId = String(project.id)
      const projectJobs = jobsByProject.get(projectId) || []
      const completedJobs = projectJobs.filter((j: any) => COMPLETED_STATUSES.has(String(j.status || '').toLowerCase())).length
      const totalJobs = projectJobs.length
      const completionRate = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0
      const projectBills = billsByProject.get(projectId) || []
      const pendingBills = projectBills.filter((b: any) => b.status === 'pending_review').length
      const approvedValue = projectBills
        .filter((b: any) => b.status === 'approved')
        .reduce((sum: number, b: any) => sum + getBillingNetAmount(b), 0)

      const riskScore = (pendingBills * 2) + (completionRate < 40 ? 3 : completionRate < 70 ? 1 : 0)
      const riskLevel = riskScore >= 5 ? 'high' : riskScore >= 3 ? 'medium' : 'low'
      return {
        project_id: projectId,
        project_name: project.name || '-',
        location: project.location || '-',
        total_plots: (plotsByProject.get(projectId) || []).length,
        total_jobs: totalJobs,
        completed_jobs: completedJobs,
        completion_rate: completionRate,
        pending_bills: pendingBills,
        approved_value: approvedValue,
        risk_level: riskLevel,
      }
    })
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>
      const d = rank[a.risk_level] - rank[b.risk_level]
      return d !== 0 ? d : a.project_name.localeCompare(b.project_name)
    })
    .slice(0, 6)

  const foremanStats = new Map<string, { submitted: number; rejected: number; approved: number; pending: number; totalAmount: number; stalePending: number }>()
  for (const bill of billings) {
    const submittedBy = String(bill.submitted_by || '')
    if (!submittedBy) continue
    const row = foremanStats.get(submittedBy) || { submitted: 0, rejected: 0, approved: 0, pending: 0, totalAmount: 0, stalePending: 0 }
    row.submitted += 1
    row.totalAmount += getBillingNetAmount(bill)
    if (bill.status === 'rejected') row.rejected += 1
    if (bill.status === 'approved') row.approved += 1
    if (bill.status === 'pending_review') {
      row.pending += 1
      const at = new Date(bill.submitted_at || bill.created_at || 0)
      if (at < staleLimit) row.stalePending += 1
    }
    foremanStats.set(submittedBy, row)
  }

  const foremanLeaders = Array.from(foremanStats.entries())
    .map(([userId, s]) => {
      const profile = profileById.get(userId)
      const reviewed = s.approved + s.rejected
      const rejectionRate = reviewed > 0 ? Math.round((s.rejected / reviewed) * 100) : 0
      return {
        user_id: userId,
        name: profile?.full_name || profile?.email || userId,
        submitted: s.submitted,
        approved: s.approved,
        rejected: s.rejected,
        pending: s.pending,
        stale_pending: s.stalePending,
        rejection_rate: rejectionRate,
        avg_request_value: s.submitted > 0 ? s.totalAmount / s.submitted : 0,
      }
    })
    .sort((a, b) => (b.stale_pending - a.stale_pending) || (b.pending - a.pending) || (b.submitted - a.submitted))
    .slice(0, 8)

  const reviewed30 = billings.filter((b: any) => ['approved', 'rejected'].includes(String(b.status)) && new Date(b.created_at || 0) >= last30d)
  const rejected30 = reviewed30.filter((b: any) => b.status === 'rejected').length
  const staleRequests = billings.filter((b: any) => b.status === 'pending_review' && new Date(b.submitted_at || b.created_at || 0) < staleLimit).length
  const qualitySummary = {
    total_submissions: billings.filter((b: any) => !!b.submitted_by).length,
    pending_review: pendingApprovals,
    stale_requests: staleRequests,
    rejection_rate_30d: reviewed30.length > 0 ? Math.round((rejected30 / reviewed30.length) * 100) : 0,
  }

  const contractorRiskMap = new Map<string, { pendingCount: number; pendingAmount: number; rejected30d: number; approvedAmount: number; overduePending: number }>()
  for (const bill of billings) {
    const contractorId = String(bill.contractor_id || '')
    if (!contractorId) continue
    const row = contractorRiskMap.get(contractorId) || { pendingCount: 0, pendingAmount: 0, rejected30d: 0, approvedAmount: 0, overduePending: 0 }
    const net = getBillingNetAmount(bill)
    if (bill.status === 'pending_review') {
      row.pendingCount += 1
      row.pendingAmount += net
      const at = new Date(bill.submitted_at || bill.created_at || 0)
      if (at < riskLimit) row.overduePending += 1
    } else if (bill.status === 'approved') {
      row.approvedAmount += net
    } else if (bill.status === 'rejected' && new Date(bill.created_at || 0) >= last30d) {
      row.rejected30d += 1
    }
    contractorRiskMap.set(contractorId, row)
  }

  const contractorRisk = Array.from(contractorRiskMap.entries())
    .map(([contractorId, s]) => {
      const riskScore = (s.overduePending * 3) + (s.rejected30d * 2) + (s.pendingCount > 2 ? 2 : 0)
      const riskLevel = riskScore >= 6 ? 'high' : riskScore >= 3 ? 'medium' : 'low'
      return {
        contractor_id: contractorId,
        contractor_name: contractorById.get(contractorId)?.name || contractorId,
        pending_count: s.pendingCount,
        pending_amount: s.pendingAmount,
        overdue_pending: s.overduePending,
        rejected_30d: s.rejected30d,
        approved_amount: s.approvedAmount,
        risk_score: riskScore,
        risk_level: riskLevel,
      }
    })
    .sort((a, b) => (b.risk_score - a.risk_score) || (b.pending_amount - a.pending_amount))
    .slice(0, 8)

  const timelineItems: Array<{
    id: string
    type: 'billing' | 'payment'
    at: string
    title: string
    subtitle: string
    amount: number
    status: string
  }> = []

  for (const bill of billings.slice(0, 20)) {
    const project = projectById.get(String(bill.project_id || ''))
    const contractor = contractorById.get(String(bill.contractor_id || ''))
    const plot = plotById.get(String(bill.plot_id || ''))
    timelineItems.push({
      id: `bill-${bill.id}`,
      type: 'billing',
      at: String(bill.created_at || bill.billing_date || new Date(0).toISOString()),
      title: `ใบเบิก ${bill.doc_no ? `#${bill.doc_no}` : ''}`.trim(),
      subtitle: `${contractor?.name || 'ไม่ระบุผู้รับเหมา'} • ${project?.name || 'ไม่ระบุโครงการ'}${plot?.name ? ` • แปลง ${plot.name}` : ''}`,
      amount: getBillingNetAmount(bill),
      status: String(bill.status || 'unknown'),
    })
  }

  for (const payment of payments) {
    const job = jobById.get(String(payment.job_assignment_id || ''))
    const plot = job?.plot_id ? plotById.get(String(job.plot_id)) : null
    const project = plot?.project_id ? projectById.get(String(plot.project_id)) : null
    const contractor = job?.contractor_id ? contractorById.get(String(job.contractor_id)) : null
    timelineItems.push({
      id: `pay-${payment.id}`,
      type: 'payment',
      at: String(payment.created_at || new Date(0).toISOString()),
      title: 'บันทึกการจ่ายเงิน',
      subtitle: `${contractor?.name || 'ไม่ระบุผู้รับเหมา'} • ${project?.name || 'ไม่ระบุโครงการ'}${plot?.name ? ` • แปลง ${plot.name}` : ''}`,
      amount: toNumber(payment.amount),
      status: 'paid',
    })
  }

  timelineItems.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  const recentTimeline = timelineItems.slice(0, 16)

  const recentPayments = payments.slice(0, 5).map((p: any) => {
    const job = jobById.get(String(p.job_assignment_id || ''))
    const plot = job?.plot_id ? plotById.get(String(job.plot_id)) : null
    const project = plot?.project_id ? projectById.get(String(plot.project_id)) : null
    return {
      id: p.id,
      amount: toNumber(p.amount),
      created_at: p.created_at,
      note: p.note,
      job_assignments: {
        plots: {
          name: plot?.name || '-',
          projects: { name: project?.name || '-' },
        },
      },
    }
  })

  return {
    projectCount: projects.length,
    plotCount: plots.length,
    paidOutTotal,
    activeJobs,
    pendingApprovals,
    approvedThisMonth,
    paidOutThisMonth,
    recentlyApproved,
    recentPayments,
    projectHealth,
    foremanQuality: {
      summary: qualitySummary,
      byForeman: foremanLeaders,
    },
    contractorRisk,
    recentTimeline,
  }
}
