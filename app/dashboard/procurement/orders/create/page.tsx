import { getSuppliers, getCompanies } from '@/actions/procurement-actions'
import { getProjects } from '@/actions/project-actions'
import PurchaseOrderForm, { type PurchaseOrderFormOptions } from '@/components/procurement/PurchaseOrderForm'

// The three lookups the form needs before it can paint are fetched here, in
// one parallel round trip on the server, instead of after hydration. The form
// renders nothing but a spinner until it has them, which is what made this
// route the worst Largest Contentful Paint in the app.
export default async function CreatePurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ fromRequest?: string }>
}) {
  const [{ fromRequest }, projects, suppliers, companies] = await Promise.all([
    searchParams,
    getProjects({ includeCentralStock: true }),
    getSuppliers(),
    getCompanies(),
  ])

  const initialOptions: PurchaseOrderFormOptions = {
    projects: projects as PurchaseOrderFormOptions['projects'],
    suppliers,
    companies,
  }

  return <PurchaseOrderForm mode="create" fromRequestId={fromRequest ?? null} initialOptions={initialOptions} />
}
