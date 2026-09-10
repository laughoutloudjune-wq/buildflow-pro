import { getProjectById } from '@/actions/project-actions'
import { getPlotsByProjectId } from '@/actions/plot-actions'
import { getHouseModels } from '@/actions/boq-actions'
import { getPlotGroups } from '@/actions/material-actions'
import type { PlotGroup } from '@/lib/types/materials'
import ProjectDetailPageClient from './ProjectDetailPageClient'

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params

  let project: Awaited<ReturnType<typeof getProjectById>> = null
  let plots: Awaited<ReturnType<typeof getPlotsByProjectId>> = []
  let houseModels: Awaited<ReturnType<typeof getHouseModels>> = []
  let plotGroups: PlotGroup[] = []

  try {
    const [p, pl, hm, groups] = await Promise.all([
      getProjectById(projectId),
      getPlotsByProjectId(projectId),
      getHouseModels(),
      getPlotGroups(projectId).catch(() => [] as PlotGroup[]),
    ])

    if (!p) {
      console.error('Project not found or access denied')
    }

    project = p
    plots = pl || []
    plotGroups = groups

    const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })
    houseModels = (hm || [])
      .filter((m) => !m.project_id || m.project_id === projectId)
      .sort((a, b) => collator.compare(a?.name || a?.code || '', b?.name || b?.code || ''))
  } catch (error) {
    console.error('Error loading data:', error)
  }

  return (
    <ProjectDetailPageClient
      projectId={projectId}
      project={project}
      initialPlots={plots}
      houseModels={houseModels}
      initialPlotGroups={plotGroups}
    />
  )
}
