import { getSalesBoardOptions } from '@/actions/sales-actions'
import { getSalesDashboard } from '@/actions/sales-dashboard-actions'
import SalesDashboardPageClient from './SalesDashboardPageClient'

type SearchParams = { project?: string }

export default async function SalesDashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const projectId = params.project || null

  let projects: Awaited<ReturnType<typeof getSalesBoardOptions>>['projects'] = []
  let data: Awaited<ReturnType<typeof getSalesDashboard>> | null = null
  let initialError: string | null = null

  try {
    const [optionsRes, dataRes] = await Promise.all([getSalesBoardOptions(), getSalesDashboard(projectId)])
    projects = optionsRes.projects
    data = dataRes
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ'
  }

  return (
    <SalesDashboardPageClient
      projects={projects}
      projectId={projectId}
      data={data}
      initialError={initialError}
    />
  )
}
