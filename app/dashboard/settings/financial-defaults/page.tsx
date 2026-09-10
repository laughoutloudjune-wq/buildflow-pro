import { getOrganizationSettings } from '@/actions/settings-actions'
import FinancialDefaultsPageClient from './FinancialDefaultsPageClient'

export default async function FinancialDefaultsPage() {
  let settings: Awaited<ReturnType<typeof getOrganizationSettings>> = null
  let initialError: string | null = null
  try {
    settings = await getOrganizationSettings()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ'
  }

  return <FinancialDefaultsPageClient settings={settings} initialError={initialError} />
}
