'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, ClipboardEdit } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { getMaterialStockDetail } from '@/actions/stock-actions'
import AdjustStockModal from '@/components/stock/AdjustStockModal'
import type { StockMovement } from '@/lib/types/stock'

const numberFormat = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 })

const TYPE_LABEL: Record<StockMovement['type'], string> = { in: 'รับเข้า', out: 'เบิกออก' }

const SOURCE_LABEL: Record<StockMovement['source_type'], string> = {
  goods_receipt: 'รับสินค้าตาม PO',
  manual_request: 'เบิกให้ผู้รับเหมา',
  opening_balance: 'ยอดยกมา (ย้ายระบบ)',
  count_adjustment: 'ปรับยอดจากนับสต็อก',
}

function describeSource(m: StockMovement): string {
  const parts: string[] = []
  if (m.contractors?.name) parts.push(`ผู้รับเหมา: ${m.contractors.name}`)
  if (m.projects?.name) parts.push(`โครงการ: ${m.projects.name}`)
  if (m.plots?.name) parts.push(`แปลง: ${m.plots.name}`)
  if (m.plot_groups?.name) parts.push(`กลุ่มแปลง: ${m.plot_groups.name}`)
  if (m.requested_by_profile?.full_name) parts.push(`โดย: ${m.requested_by_profile.full_name}`)
  if (m.note) parts.push(m.note)
  return parts.length > 0 ? parts.join(' · ') : '-'
}

export default function MaterialStockDetailPage({ params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = use(params)
  const [material, setMaterial] = useState<{
    id: number
    name: string
    unit: string
    category: string | null
    is_requestable: boolean
  } | null>(null)
  const [quantityOnHand, setQuantityOnHand] = useState(0)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [canAdjust, setCanAdjust] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isAdjustOpen, setIsAdjustOpen] = useState(false)
  const toast = useToast()

  useEffect(() => {
    void load()
  }, [materialId])

  async function load() {
    setIsLoading(true)
    try {
      const data = await getMaterialStockDetail(Number(materialId))
      setMaterial(data.material)
      setQuantityOnHand(data.quantity_on_hand)
      setMovements(data.movements)
      setCanAdjust(data.canAdjust)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลวัสดุไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดข้อมูลวัสดุ...</p>
      </div>
    )
  }

  if (!material) {
    return <div className="mx-auto max-w-3xl py-12 text-center text-slate-400">ไม่พบวัสดุนี้</div>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/dashboard/stock" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> กลับไปหน้าสต็อกวัสดุ
      </Link>

      <PageHeader
        title={material.name}
        subtitle={`${material.category || 'ไม่ระบุหมวดหมู่'} · หน่วย: ${material.unit}`}
        actions={
          <div className="flex items-center gap-2">
            {!material.is_requestable && <Badge tone="warning">รับเข้าอย่างเดียว</Badge>}
            {canAdjust && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setIsAdjustOpen(true)}>
                <ClipboardEdit className="h-3.5 w-3.5" /> ปรับยอดสต็อก
              </Button>
            )}
          </div>
        }
      />

      <Card className="p-6">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {material.is_requestable ? 'คงเหลือปัจจุบัน' : 'ยอดรับเข้าสะสม'}
        </div>
        <div
          className={`mt-1 font-mono text-4xl font-semibold ${
            quantityOnHand < 0 ? 'text-red-600' : quantityOnHand === 0 ? 'text-amber-600' : 'text-slate-900'
          }`}
        >
          {numberFormat.format(quantityOnHand)} <span className="text-lg font-normal text-slate-400">{material.unit}</span>
        </div>
        {!material.is_requestable ? (
          <p className="mt-2 text-sm text-slate-500">
            วัสดุนี้ตั้งเป็น &quot;รับเข้าอย่างเดียว&quot; - ไม่มีขั้นตอนเบิกจ่ายให้ผู้รับเหมาในระบบ ตัวเลขนี้คือยอดรับเข้าสะสมทั้งหมด
          </p>
        ) : (
          quantityOnHand < 0 && (
            <p className="mt-2 text-sm text-red-600">สต็อกติดลบ - ควรตรวจสอบยอดจริงหน้างานเทียบกับระบบ</p>
          )
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 text-sm text-slate-500">
          ประวัติการเคลื่อนไหว <span className="font-semibold text-slate-700">{movements.length}</span> รายการ
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">วันที่</th>
                <th className="px-4 py-3">ประเภท</th>
                <th className="px-4 py-3">ที่มา</th>
                <th className="px-4 py-3">รายละเอียด</th>
                <th className="px-4 py-3 text-right">จำนวน</th>
                <th className="px-4 py-3 text-right">คงเหลือหลังรายการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center italic text-slate-400">
                    ยังไม่มีการเคลื่อนไหวของวัสดุนี้
                  </td>
                </tr>
              ) : (
                movements.map((m) => (
                  <tr key={m.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(m.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={m.type === 'in' ? 'success' : 'info'}>{TYPE_LABEL[m.type]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{SOURCE_LABEL[m.source_type]}</td>
                    <td className="px-4 py-3 text-slate-500">{describeSource(m)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-medium ${m.type === 'in' ? 'text-emerald-600' : 'text-slate-700'}`}>
                      {m.type === 'in' ? '+' : '-'}
                      {numberFormat.format(m.quantity)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500">{numberFormat.format(m.new_qty)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {canAdjust && (
        <AdjustStockModal
          isOpen={isAdjustOpen}
          onClose={() => setIsAdjustOpen(false)}
          onSuccess={load}
          materialId={material.id}
          materialName={material.name}
          unit={material.unit}
          currentQty={quantityOnHand}
        />
      )}
    </div>
  )
}
