import { getContractorTypes } from '@/actions/contractor-type-actions'
import ContractorTypesPageClient from './ContractorTypesPageClient'

export default async function ContractorTypesPage() {
  let types: Awaited<ReturnType<typeof getContractorTypes>> = []
  let initialError: string | null = null
  try {
    types = await getContractorTypes()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลประเภทช่างไม่สำเร็จ'
  }

  return <ContractorTypesPageClient types={types} initialError={initialError} />
}
