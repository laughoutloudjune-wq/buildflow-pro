import { getMaterialStockDetail } from '@/actions/stock-actions'
import MaterialStockDetailPageClient from './MaterialStockDetailPageClient'

export default async function MaterialStockDetailPage({ params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await params
  let detail: Awaited<ReturnType<typeof getMaterialStockDetail>> | null = null
  let initialError: string | null = null
  try {
    detail = await getMaterialStockDetail(Number(materialId))
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลวัสดุไม่สำเร็จ'
  }

  return <MaterialStockDetailPageClient detail={detail} initialError={initialError} />
}
