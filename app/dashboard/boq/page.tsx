import { getHouseModels } from '@/actions/boq-actions'
import { getProjects } from '@/actions/project-actions'
import HouseModelsPageClient from './HouseModelsPageClient'

export default async function BoqPage() {
  const [models, projects] = await Promise.all([getHouseModels(), getProjects({ onlyProjectsPage: true })])

  return <HouseModelsPageClient models={models || []} projects={projects || []} />
}
