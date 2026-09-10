import { getMaterialCatalog } from '@/actions/material-actions'
import MaterialTypesPageClient from './MaterialTypesPageClient'

export default async function MaterialTypesPage() {
  let materials: Awaited<ReturnType<typeof getMaterialCatalog>> = []
  let initialError: string | null = null
  try {
    // false = include deactivated rows too; this page manages both.
    materials = await getMaterialCatalog(false)
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลวัสดุไม่สำเร็จ'
  }

  return <MaterialTypesPageClient initialMaterials={materials} initialError={initialError} />
}
