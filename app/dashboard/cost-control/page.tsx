import { redirect } from 'next/navigation'

type SearchParams = { project?: string; group?: string; plots?: string; tab?: string }

/**
 * Cost control has moved into the construction hubs. Old links, bookmarks and
 * the e2e deep links keep working: the scope picks the hub, the old tab picks
 * the tab (quantity control -> วัสดุ BOQ, materials cost -> ต้นทุนวัสดุ).
 */
export default async function CostControlRedirect({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { project, group, plots, tab } = await searchParams
  if (tab === 'labor-cost') redirect('/dashboard/reports/labor-budget')
  if (!project) redirect('/dashboard/board')

  const plotIds = plots ? plots.split(',').filter(Boolean) : []
  if (plotIds.length === 1) {
    redirect(`/dashboard/projects/${project}/${plotIds[0]}?tab=${tab === 'material-cost' ? 'cost' : tab === 'qty' ? 'materials' : 'construction'}`)
  }
  if (plotIds.length === 0 && group) {
    redirect(`/dashboard/projects/${project}/groups/${group}?tab=${tab === 'qty' ? 'boq' : tab === 'material-cost' ? 'cost' : 'plots'}`)
  }
  redirect(`/dashboard/projects/${project}/board${tab === 'qty' ? '?tab=boq' : tab === 'material-cost' ? '?tab=matcost' : ''}`)
}
