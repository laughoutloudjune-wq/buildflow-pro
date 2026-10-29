import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

// Job status follows the work by itself, so nobody has to flip it by hand:
// a contractor is chosen -> in_progress, an approved bill reaches 100% ->
// completed, that approval is undone -> back to in_progress. The status menu
// on the plot page still overrides any of these. Only the status words the
// app already uses are written (job_assignments.status has no CHECK).

/** Status for a job right after its contractor is set or cleared. */
export function statusAfterContractorChange(currentStatus: string | null, contractorId: string | null): string {
  if (!contractorId) return 'pending'
  // A finished job keeps its status when only the contractor name is fixed.
  if (currentStatus === 'completed') return 'completed'
  return 'in_progress'
}

/** After an approval: close the jobs this bill took to 100%. Best effort - the
 * approval has already gone through, so a failure here must not undo it. */
export async function completeJobsAtFullProgress(
  supabase: Supabase,
  jobs: { id: string; progress_percent: number | null }[]
) {
  const done = jobs.filter((job) => Number(job.progress_percent) >= 100).map((job) => job.id)
  if (done.length === 0) return
  await supabase.from('job_assignments').update({ status: 'completed' }).in('id', done).neq('status', 'completed')
}

/** After an approval is undone: reopen the bill's jobs that no other approved
 * bill still takes to 100%. Best effort, like the above. */
export async function reopenJobsAfterUndo(supabase: Supabase, billingId: string) {
  const { data: lines } = await supabase.from('billing_jobs').select('job_assignment_id').eq('billing_id', billingId)
  const jobIds = Array.from(new Set((lines || []).map((l) => l.job_assignment_id).filter((v): v is string => Boolean(v))))
  if (jobIds.length === 0) return

  const { data: fullLines } = await supabase
    .from('billing_jobs')
    .select('job_assignment_id, billings!inner(status)')
    .in('job_assignment_id', jobIds)
    .eq('billings.status', 'approved')
    .gte('progress_percent', 100)
  const stillFull = new Set((fullLines || []).map((l) => String(l.job_assignment_id)))
  const reopen = jobIds.filter((jobId) => !stillFull.has(jobId))
  if (reopen.length === 0) return
  await supabase.from('job_assignments').update({ status: 'in_progress' }).in('id', reopen).eq('status', 'completed')
}
