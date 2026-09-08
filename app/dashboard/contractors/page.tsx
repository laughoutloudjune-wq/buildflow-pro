import { getContractors } from '@/actions/contractor-actions'
import { getContractorTypes } from '@/actions/contractor-type-actions'
import ContractorsPageClient from './ContractorsPageClient'

export default async function ContractorsPage() {
  const [contractors, types] = await Promise.all([getContractors(), getContractorTypes()])

  return <ContractorsPageClient contractors={contractors || []} types={types || []} />
}
