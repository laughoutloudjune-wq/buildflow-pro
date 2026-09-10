import { getSuppliers } from '@/actions/procurement-actions'
import SuppliersPageClient from './SuppliersPageClient'

export default async function SuppliersPage() {
  let suppliers: Awaited<ReturnType<typeof getSuppliers>> = []
  let initialError: string | null = null
  try {
    suppliers = await getSuppliers(false)
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลผู้จำหน่ายไม่สำเร็จ'
  }

  return <SuppliersPageClient suppliers={suppliers} initialError={initialError} />
}
