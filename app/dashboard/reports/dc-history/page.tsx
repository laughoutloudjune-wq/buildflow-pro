import { redirect } from 'next/navigation'
import { requireModuleAccess } from '@/lib/auth/route-access'

/**
 * รายงานงานเพิ่ม (DC): DC bills now show on the plot hub, batch hub, contractor
 * hub and the project board (งานเพิ่ม (DC) tab), and in the bills inbox with the
 * DC chip. Same filters carry over where the new page has them.
 */
export default async function DcHistoryRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireModuleAccess('reports')
  const { projectId, plotId } = await searchParams
  if (projectId && plotId) redirect(`/dashboard/projects/${projectId}/${plotId}?tab=dc`)
  if (projectId) redirect(`/dashboard/projects/${projectId}/board?tab=dc`)
  redirect('/dashboard/billing?kind=dc&tab=all')
}
