import CreatePurchaseRequestPageClient from './CreatePurchaseRequestPageClient'

/** ?purpose=store&items=12:50,13:20 opens the form prefilled - used by the
 * low-stock list's restock button. */
export default async function CreatePurchaseRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ purpose?: string; items?: string }>
}) {
  const { purpose, items } = await searchParams
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
    />
  )
}
