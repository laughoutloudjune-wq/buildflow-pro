import { getPurchaseOrderDetailBundle } from '@/actions/procurement/po-detail-bundle'
import PurchaseOrderDetailPageClient from './PurchaseOrderDetailPageClient'

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const bundle = await getPurchaseOrderDetailBundle(id)

  return (
    <PurchaseOrderDetailPageClient
      fetchedAt={bundle.fetchedAt}
      id={bundle.id}
      order={bundle.order}
      formOptions={bundle.formOptions}
      initialError={bundle.initialError}
    />
  )
}
