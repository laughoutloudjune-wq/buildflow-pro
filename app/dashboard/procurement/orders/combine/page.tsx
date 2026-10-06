import { getSuppliers } from '@/actions/procurement-actions'
import { getProjects } from '@/actions/project-actions'
import CombineRequestsForm from '@/components/procurement/CombineRequestsForm'

export default async function CombineRequestsPage() {
  const [projects, suppliers] = await Promise.all([getProjects({ includeOverhead: true }), getSuppliers()])

  return (
    <CombineRequestsForm
      projects={(projects as { id: string; name: string }[]).map((p) => ({ id: p.id, name: p.name }))}
      suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
    />
  )
}
