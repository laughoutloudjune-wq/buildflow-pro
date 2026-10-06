import { redirect } from 'next/navigation'
import { getWeeklyPlanData } from '@/actions/weekly-plan-actions'
import { getDashboardSession } from '@/lib/auth/route-access'
import { todayInBangkok } from '@/lib/utils'
import { isMonday, mondayOf } from '@/lib/weekly-plan'
import WeeklyPlanClient from '@/components/weekly-plan/WeeklyPlanClient'

export default async function WeeklyPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; project?: string }>
}) {
  const { role } = await getDashboardSession()
  if (!['admin', 'pm', 'foreman'].includes(role)) redirect('/dashboard')

  const params = await searchParams
  const requested = params.week && /^\d{4}-\d{2}-\d{2}$/.test(params.week) ? params.week : todayInBangkok()
  const weekStart = isMonday(requested) ? requested : mondayOf(requested)

  const data = await getWeeklyPlanData(weekStart)
  if ('error' in data) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{data.error}</div>
  }

  return <WeeklyPlanClient data={data} projectId={params.project || data.projects[0]?.id || ''} />
}
