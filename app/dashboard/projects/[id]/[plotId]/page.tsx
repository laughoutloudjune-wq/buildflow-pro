import { getJobAssignments, getPlotById } from '@/actions/job-actions'
import { getHouseModels } from '@/actions/boq-actions'
import { getContractors } from '@/actions/contractor-actions'
import PlotDetailPageClient from './PlotDetailPageClient'

export default async function PlotDetailPage({ params }: { params: Promise<{ id: string; plotId: string }> }) {
  const { id: projectId, plotId } = await params

  let plot: Awaited<ReturnType<typeof getPlotById>> = null
  let jobs: Awaited<ReturnType<typeof getJobAssignments>> = []
  let contractors: Awaited<ReturnType<typeof getContractors>> = []
  let houseModels: Awaited<ReturnType<typeof getHouseModels>> = []

  try {
    const [pData, jData, cData, hmData] = await Promise.all([
      getPlotById(plotId),
      getJobAssignments(plotId),
      getContractors(),
      getHouseModels(),
    ])
    plot = pData
    jobs = jData || []
    contractors = cData || []
    houseModels = hmData || []
  } catch (error) {
    console.error(error)
  }

  return (
    <PlotDetailPageClient
      projectId={projectId}
      plotId={plotId}
      plot={plot}
      initialJobs={jobs}
      contractors={contractors}
      houseModels={houseModels}
    />
  )
}
