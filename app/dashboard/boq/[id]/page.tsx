import { getHouseModelById, getBOQItems, getHouseModels } from '@/actions/boq-actions'
import { getContractorTypes } from '@/actions/contractor-type-actions'
import BOQDetailPageClient from './BOQDetailPageClient'

export default async function BOQDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let model: Awaited<ReturnType<typeof getHouseModelById>> = null
  let items: Awaited<ReturnType<typeof getBOQItems>> = []
  let types: Awaited<ReturnType<typeof getContractorTypes>> = []
  let allModels: Awaited<ReturnType<typeof getHouseModels>> = []

  try {
    const [m, i, t, hm] = await Promise.all([
      getHouseModelById(id),
      getBOQItems(id),
      getContractorTypes(),
      getHouseModels(),
    ])
    model = m
    items = i || []
    types = t || []
    allModels = (hm || []).filter((x) => x.id !== id)
  } catch (error) {
    console.error('Error loading BOQ Detail:', error)
  }

  return <BOQDetailPageClient id={id} model={model} initialItems={items} types={types} allModels={allModels} />
}
