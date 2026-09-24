import { getAllPromotions, getPromotions } from '@/actions/promotions-actions'
import { requireModuleAccess } from '@/lib/auth/route-access'
import PromotionsPageClient from './PromotionsPageClient'

/**
 * Promotion catalogue management (June, 2026-09-24) - lives under
 * /dashboard/sales, not /dashboard/settings, because the sales role has no
 * 'settings' module access but does have 'sales' (lib/permissions.ts), and
 * June's explicit choice was "admin AND sales" can manage this catalogue,
 * not admin-only like sale_statuses.
 */
export default async function PromotionsPage() {
  const { role } = await requireModuleAccess('sales')
  const canManage = role === 'admin' || role === 'sales'

  let promotions: Awaited<ReturnType<typeof getAllPromotions>> = []
  let initialError: string | null = null
  try {
    promotions = canManage ? await getAllPromotions() : await getPromotions()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ'
  }

  return <PromotionsPageClient initialPromotions={promotions} initialError={initialError} canManage={canManage} />
}
