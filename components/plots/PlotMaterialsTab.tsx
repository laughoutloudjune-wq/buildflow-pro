'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { PlotMaterialRowView } from '@/lib/types/plotDetail'

const fmt = (n: number) => n.toLocaleString('th-TH')

export default function PlotMaterialsTab({ materials, canSeeCost }: { materials: PlotMaterialRowView[]; canSeeCost: boolean }) {
  const [open, setOpen] = useState<Set<number>>(new Set())

  if (materials.length === 0) {
    return (
      <Card className="p-8 text-center text-slate-400">
        ยังไม่มีวัสดุที่สั่งซื้อสำหรับแปลงนี้
      </Card>
    )
  }

  function toggle(id: number) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-700 border-b">
            <tr>
              <th className="px-4 py-3 font-semibold">วัสดุ</th>
              <th className="px-4 py-3 font-semibold text-right">สั่งซื้อ</th>
              <th className="px-4 py-3 font-semibold text-right">รับแล้ว</th>
              {canSeeCost && <th className="px-4 py-3 font-semibold text-right">มูลค่าสั่งซื้อ</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {materials.map((m) => {
              const isOpen = open.has(m.materialTypeId)
              return (
                <Fragment key={m.materialTypeId}>
                  <tr className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      <button
                        type="button"
                        onClick={() => toggle(m.materialTypeId)}
                        className="inline-flex items-center gap-1 text-left"
                        aria-expanded={isOpen}
                        title="ดูที่มาของตัวเลข (ใบสั่งซื้อ / ใบขอซื้อ)"
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                        {m.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmt(m.orderedQty)} {m.unit}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmt(m.receivedQty)} {m.unit}</td>
                    {canSeeCost && (
                      <td className="px-4 py-3 text-right font-medium text-slate-700">
                        {m.orderedValue != null ? `฿${formatCurrency(m.orderedValue)}` : '—'}
                      </td>
                    )}
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50/60">
                      <td colSpan={canSeeCost ? 4 : 3} className="px-4 py-3">
                        <table className="w-full text-xs">
                          <thead className="text-slate-400">
                            <tr>
                              <th className="py-1 pr-3 text-left font-medium">ใบสั่งซื้อ</th>
                              <th className="py-1 pr-3 text-left font-medium">ใบขอซื้อ</th>
                              <th className="py-1 pr-3 text-right font-medium">จัดสรรทั้งหมด</th>
                              <th className="py-1 pr-3 text-right font-medium">ของแปลงนี้</th>
                              <th className="py-1 text-right font-medium">รับแล้ว</th>
                            </tr>
                          </thead>
                          <tbody className="text-slate-600">
                            {m.sources.map((s, i) => (
                              <tr key={`${s.poItemId}-${s.purchaseRequestId ?? 'none'}-${i}`}>
                                <td className="py-1 pr-3 font-mono">
                                  <Link href={`/dashboard/procurement/orders/${s.poId}`} className="text-indigo-600 hover:underline">
                                    {s.poNo}
                                  </Link>
                                </td>
                                <td className="py-1 pr-3">{s.prNo != null ? `PR-${s.prNo}` : 'ไม่ผูกใบขอซื้อ'}</td>
                                <td className="py-1 pr-3 text-right">{fmt(s.allocatedQty)} {m.unit}</td>
                                <td className="py-1 pr-3 text-right font-medium">
                                  {fmt(s.orderedQty)} {m.unit}
                                  {s.weight < 1 && <span className="text-slate-400"> ({Math.round(s.weight * 100)}%)</span>}
                                </td>
                                <td className="py-1 text-right">{fmt(s.receivedQty)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
