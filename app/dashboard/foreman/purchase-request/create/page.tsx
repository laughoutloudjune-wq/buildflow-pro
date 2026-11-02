import { getMyRequestForReuse } from '@/actions/foreman-purchase-requests'
import CreateForemanPurchaseRequestPageClient from './CreateForemanPurchaseRequestPageClient'

/** ?from=<request id> opens the form with that request's plots and materials
 * already filled in; ?projectId=&plotId= (the plot page's "ขอซื้อ") just the plot. */
export default async function CreateForemanPurchaseRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; projectId?: string; plotId?: string }>
}) {
  const { from, projectId, plotId } = await searchParams
  let reuse: Awaited<ReturnType<typeof getMyRequestForReuse>> = null
  if (from) {
    try {
      reuse = await getMyRequestForReuse(from)
    } catch {
      reuse = null
    }
  }
  const initialScope = reuse
    ? { projectId: reuse.projectId, plotIds: reuse.plotIds }
    : projectId
      ? { projectId, plotIds: plotId ? [plotId] : [] }
      : undefined
  return <CreateForemanPurchaseRequestPageClient initialScope={initialScope} initialLines={reuse?.lines} />
}
