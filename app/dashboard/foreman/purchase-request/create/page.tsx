import { getMyRequestForReuse } from '@/actions/foreman-purchase-requests'
import CreateForemanPurchaseRequestPageClient from './CreateForemanPurchaseRequestPageClient'

/** ?from=<request id> opens the form with that request's plots and materials already filled in. */
export default async function CreateForemanPurchaseRequestPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams
  let reuse: Awaited<ReturnType<typeof getMyRequestForReuse>> = null
  if (from) {
    try {
      reuse = await getMyRequestForReuse(from)
    } catch {
      reuse = null
    }
  }
  return <CreateForemanPurchaseRequestPageClient initialScope={reuse ? { projectId: reuse.projectId, plotIds: reuse.plotIds } : undefined} initialLines={reuse?.lines} />
}
