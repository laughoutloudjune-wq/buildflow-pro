import { redirect } from 'next/navigation'
import { requireModuleAccess } from '@/lib/auth/route-access'

/** ประวัติบ้านเลขที่: a plot's bills now live on its hub (ใบเบิก tab). */
export default async function HouseHistoryRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireModuleAccess('reports')
  const { projectId, plotId } = await searchParams
  if (projectId && plotId) redirect(`/dashboard/projects/${projectId}/${plotId}?tab=bills`)
  if (projectId) redirect(`/dashboard/projects/${projectId}/board`)
  redirect('/dashboard/board')
}
