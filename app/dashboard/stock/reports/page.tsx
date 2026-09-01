'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Settings } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { getLowStockMaterials, getConsumptionReport } from '@/actions/stock-actions'
import type { ConsumptionReport, LowStockRow } from '@/lib/types/stock'

const numberFormat = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 })

export default function StockReportsPage() {
  const [lowStock, setLowStock] = useState<LowStockRow[]>([])
  const [consumption, setConsumption] = useState<ConsumptionReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const toast = useToast()

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setIsLoading(true)
    try {
      const [lowStockRows, consumptionReport] = await Promise.all([getLowStockMaterials(), getConsumptionReport()])
      setLowStock(lowStockRows)
      setConsumption(consumptionReport)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดรายงานไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดรายงาน...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/dashboard/stock" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> กลับไปหน้าสต็อกวัสดุ
      </Link>

      <PageHeader title="รายงานสต็อก" subtitle="วัสดุใกล้หมด และการเบิกจ่ายตามโครงการ/ผู้รับเหมา" />

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">วัสดุใกล้หมด</h3>
            <p className="text-xs text-slate-400">คงเหลือถึงหรือต่ำกว่าจุดสั่งซื้อขั้นต่ำที่ตั้งไว้</p>
          </div>
          <Link
            href="/dashboard/settings/materials"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline"
          >
            <Settings className="h-3.5 w-3.5" /> ตั้งค่าจุดสั่งซื้อ
          </Link>
        </div>
        {lowStock.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            ไม่มีวัสดุที่ต่ำกว่าจุดสั่งซื้อขั้นต่ำ - หรือยังไม่ได้ตั้งจุดสั่งซื้อให้วัสดุใดเลย
            <br />
            ตั้งค่าได้จากหน้ารายการวัสดุ โดยแก้ไขวัสดุแล้วระบุ &quot;จุดสั่งซื้อขั้นต่ำ&quot;
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">วัสดุ</th>
                  <th className="px-4 py-3">หมวดหมู่</th>
                  <th className="px-4 py-3 text-right">คงเหลือ</th>
                  <th className="px-4 py-3 text-right">จุดสั่งซื้อ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {lowStock.map((m) => (
                  <tr key={m.material_type_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/stock/${m.material_type_id}`} className="font-medium text-indigo-600 hover:underline">
                        {m.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{m.category || '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-mono font-semibold ${m.quantity_on_hand < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                        {numberFormat.format(m.quantity_on_hand)}
                      </span>
                      {m.quantity_on_hand < 0 && (
                        <Badge tone="danger" className="ml-2">
                          ติดลบ
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500">{numberFormat.format(m.reorder_point)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-800">การเบิกจ่ายตามโครงการ</h3>
          </div>
          {!consumption || consumption.byProject.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">ยังไม่มีการเบิกวัสดุจริงในระบบ</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {consumption.byProject.map((row) => (
                <li key={row.name} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-slate-700">{row.name}</span>
                  <span className="font-mono text-slate-500">
                    {numberFormat.format(row.quantity)} <span className="text-xs text-slate-400">({row.movement_count} รายการ)</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-800">การเบิกจ่ายตามผู้รับเหมา</h3>
          </div>
          {!consumption || consumption.byContractor.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">ยังไม่มีการเบิกวัสดุจริงในระบบ</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {consumption.byContractor.map((row) => (
                <li key={row.name} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-slate-700">{row.name}</span>
                  <span className="font-mono text-slate-500">
                    {numberFormat.format(row.quantity)} <span className="text-xs text-slate-400">({row.movement_count} รายการ)</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">วัสดุที่มีการเคลื่อนไหวมากที่สุด</h3>
          <p className="text-xs text-slate-400">นับเฉพาะการรับเข้า/เบิกออกจริง ไม่รวมยอดยกมาตอนย้ายระบบ</p>
        </div>
        {consumption && consumption.mostActiveMaterials.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            ยังไม่มีการรับเข้าหรือเบิกออกจริงในระบบ (ยอดปัจจุบันทั้งหมดมาจากการย้ายระบบครั้งเดียว)
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">วัสดุ</th>
                  <th className="px-4 py-3 text-right">จำนวนรายการ</th>
                  <th className="px-4 py-3 text-right">ปริมาณรวม</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {consumption?.mostActiveMaterials.map((m) => (
                  <tr key={m.material_type_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/stock/${m.material_type_id}`} className="font-medium text-indigo-600 hover:underline">
                        {m.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-600">{m.movement_count}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500">
                      {numberFormat.format(m.total_quantity)} {m.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
