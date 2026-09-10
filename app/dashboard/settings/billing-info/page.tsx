import { getOrganizationSettings } from '@/actions/settings-actions'
import BillingInfoPageClient from './BillingInfoPageClient'

export default async function BillingInfoPage() {
  let settings: Awaited<ReturnType<typeof getOrganizationSettings>> = null
  let initialError: string | null = null
  try {
    settings = await getOrganizationSettings()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ'
  }

  return <BillingInfoPageClient settings={settings} initialError={initialError} />
}
