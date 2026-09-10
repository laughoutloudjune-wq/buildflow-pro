import { getCompanies } from '@/actions/procurement-actions'
import CompaniesPageClient from './CompaniesPageClient'

export default async function CompaniesPage() {
  let companies: Awaited<ReturnType<typeof getCompanies>> = []
  let initialError: string | null = null
  try {
    companies = await getCompanies(false)
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลบริษัทไม่สำเร็จ'
  }

  return <CompaniesPageClient companies={companies} initialError={initialError} />
}
