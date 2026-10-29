import CreatePurchaseRequestPageClient from './CreatePurchaseRequestPageClient'

/** ?purpose=store&items=12:50,13:20 opens the form prefilled - used by the
 * low-stock list's restock button. ?projectId=&plotId= comes from the plot
 * page's "ขอซื้อ" button. */
export default async function CreatePurchaseRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ purpose?: string; items?: string; projectId?: string; plotId?: string }>
}) {
  const { purpose, items, projectId, plotId } = await searchParams
  const initialLines = (items || '')
    .split(',')
    .map((pair) => {
      const [id, qty] = pair.split(':')
      return { material_type_id: Number(id), quantity: Number(qty) || 0 }
    })
    .filter((l) => Number.isInteger(l.material_type_id) && l.material_type_id > 0)

  return (
    <CreatePurchaseRequestPageClient
      initialPurpose={purpose === 'store' || purpose === 'overhead' ? purpose : undefined}
      initialLines={initialLines}
      initialScope={projectId ? { projectId, plotIds: plotId ? [plotId] : [] } : undefined}
    />
  )
}
