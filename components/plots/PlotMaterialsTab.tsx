'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { PlotMaterialRowView } from '@/lib/types/plotDetail'
import { TableFrame } from '@/components/ui/TableFrame'
import { EmptyState } from '@/components/ui/EmptyState'

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 })

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })

/** Used (withdrawn + delivered straight to the plot) against BOQ - the same
 * rule as the BOQ control page: over the planned quantity is a warning, over
 * planned + waste allowance is over budget. */
function BoqUsage({ m }: { m: PlotMaterialRowView }) {
  const used = m.issuedQty + m.directQty
  if (m.plannedQty == null) {
    return <span className="text-xs text-slate-400">ไม่มีใน BOQ</span>
  }
  const ceiling = m.plannedQty + (m.allowanceQty || 0)
  const pct = ceiling > 0 ? Math.round((used / ceiling) * 100) : 0
  const tone = used > ceiling ? 'text-rose-700 bg-rose-50' : used > m.plannedQty ? 'text-amber-800 bg-amber-50' : 'text-emerald-700 bg-emerald-50'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{pct}%</span>
}

export default function PlotMaterialsTab({ materials, canSeeCost }: { materials: PlotMaterialRowView[]; canSeeCost: boolean }) {
  const [open, setOpen] = useState<Set<number>>(new Set())

  if (materials.length === 0) {
    return (
      <Card>
        <EmptyState
          title="ยังไม่มีวัสดุสำหรับแปลงนี้"
          description="วัสดุจะแสดงที่นี่เมื่อมี BOQ ของแบบบ้าน ใบสั่งซื้อที่ผูกกับแปลง หรือการเบิกจากสโตร์ที่ระบุแปลงนี้"
        />
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

  const colCount = canSeeCost ? 10 : 8

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        ใช้แล้ว = เบิกจากสโตร์ + ส่งตรงแปลง เทียบกับ BOQ รวมเผื่อเสีย · การเบิกที่ระบุเป็นกลุ่มแปลงจะแบ่งเท่ากันทุกแปลงในกลุ่ม · การเบิกเก่าที่ไม่ได้ระบุแปลงจะไม่แสดงที่นี่
      </p>
      <TableFrame>
        <table>
          <thead>
            <tr>
              <th className="px-4 py-3 font-semibold">วัสดุ</th>
              <th className="px-4 py-3 font-semibold text-right">BOQ</th>
              <th className="px-4 py-3 font-semibold text-right">สั่งซื้อ</th>
              <th className="px-4 py-3 font-semibold text-right">รับแล้ว</th>
              <th className="px-4 py-3 font-semibold text-right">เบิกจากสโตร์</th>
              <th className="px-4 py-3 font-semibold text-right">ส่งตรงแปลง</th>
              <th className="px-4 py-3 font-semibold text-right">ใช้แล้ว</th>
              <th className="px-4 py-3 font-semibold text-right">เทียบ BOQ</th>
              {canSeeCost && <th className="px-4 py-3 font-semibold text-right">มูลค่าสั่งซื้อ</th>}
              {canSeeCost && <th className="px-4 py-3 font-semibold text-right" title="ของที่ผู้รับเหมาเบิกจากสโตร์ ตามราคาซื้อเฉลี่ยของสโตร์">มูลค่าเบิกสโตร์</th>}
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => {
              const isOpen = open.has(m.materialTypeId)
              const used = m.issuedQty + m.directQty
              const hasDetail = m.sources.length > 0 || m.stockEntries.length > 0
              return (
                <Fragment key={m.materialTypeId}>
                  <tr className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {hasDetail ? (
                        <button
                          type="button"
                          onClick={() => toggle(m.materialTypeId)}
                          className="inline-flex items-center gap-1 text-left"
                          aria-expanded={isOpen}
                          title="ดูที่มาของตัวเลข (ใบสั่งซื้อ / ใบเบิก)"
                        >
                          {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                          {m.name}
                        </button>
                      ) : (
                        <span className="pl-5">{m.name}</span>
                      )}
                    </td>
                    <td
                      className="px-4 py-3 text-right text-slate-600"
                      title={m.plannedQty != null && m.allowanceQty ? `ตาม BOQ ${fmt(m.plannedQty)} + เผื่อเสีย ${fmt(m.allowanceQty)}` : undefined}
                    >
                      {m.plannedQty != null ? `${fmt(m.plannedQty + (m.allowanceQty || 0))} ${m.unit}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{m.orderedQty ? `${fmt(m.orderedQty)} ${m.unit}` : '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{m.receivedQty ? `${fmt(m.receivedQty)} ${m.unit}` : '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{m.issuedQty ? `${fmt(m.issuedQty)} ${m.unit}` : '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{m.directQty ? `${fmt(m.directQty)} ${m.unit}` : '—'}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800">{used ? `${fmt(used)} ${m.unit}` : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <BoqUsage m={m} />
                    </td>
                    {canSeeCost && (
                      <td className="px-4 py-3 text-right font-medium text-slate-700">
                        {m.orderedValue ? `฿${formatCurrency(m.orderedValue)}` : '—'}
                      </td>
                    )}
                    {canSeeCost && (
                      <td className="px-4 py-3 text-right font-medium text-slate-700">
                        {m.issuedValue ? `฿${formatCurrency(m.issuedValue)}` : '—'}
                      </td>
                    )}
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50/60">
                      <td colSpan={colCount} className="space-y-3 px-4 py-3">
                        {m.sources.length > 0 && (
                          <table className="w-full text-xs">
                            <thead className="text-slate-400">
                              <tr>
                                <th className="py-1 pr-3 text-left font-medium">ใบสั่งซื้อ</th>
                                <th className="py-1 pr-3 text-left font-medium">คำขอซื้อ</th>
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
                                  <td className="py-1 pr-3">{s.prNo != null ? `PR-${s.prNo}` : 'ไม่ผูกคำขอซื้อ'}</td>
                                  <td className="py-1 pr-3 text-right">{fmt(s.allocatedQty)} {m.unit}</td>
                                  <td className="py-1 pr-3 text-right font-medium">
                                    {fmt(s.orderedQty)} {m.unit}
                                    {s.weight < 1 && (
                                      <span
                                        className="text-slate-500"
                                        title="คำขอซื้อนี้ครอบคลุมหลายแปลง ระบบแบ่งเท่ากันเพราะยังไม่ได้ระบุจำนวนจริงของแต่ละแปลง"
                                      >
                                        {' '}
                                        (แบ่งเท่ากัน ≈{Math.round(s.weight * 100)}%)
                                      </span>
                                    )}
                                  </td>
                                  <td
                                    className="py-1 text-right"
                                    title={s.receivedIsEstimate ? 'ประมาณตามสัดส่วน - ใบรับสินค้าไม่ได้แยกตามคำขอซื้อ' : undefined}
                                  >
                                    {s.receivedIsEstimate ? '≈ ' : ''}
                                    {fmt(s.receivedQty)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {m.stockEntries.length > 0 && (
                          <table className="w-full text-xs">
                            <thead className="text-slate-400">
                              <tr>
                                <th className="py-1 pr-3 text-left font-medium">วันที่</th>
                                <th className="py-1 pr-3 text-left font-medium">เอกสาร</th>
                                <th className="py-1 pr-3 text-left font-medium">ประเภท</th>
                                <th className="py-1 pr-3 text-left font-medium">ผู้รับเหมา</th>
                                <th className="py-1 text-right font-medium">ของแปลงนี้</th>
                              </tr>
                            </thead>
                            <tbody className="text-slate-600">
                              {m.stockEntries.map((e) => (
                                <tr key={e.movementId}>
                                  <td className="py-1 pr-3">{fmtDate(e.date)}</td>
                                  <td className="py-1 pr-3 font-mono">
                                    {e.docNo || '—'}
                                    {e.poId && e.poNo && (
                                      <>
                                        {' · '}
                                        <Link href={`/dashboard/procurement/orders/${e.poId}`} className="text-indigo-600 hover:underline">
                                          {e.poNo}
                                        </Link>
                                      </>
                                    )}
                                  </td>
                                  <td className="py-1 pr-3">{e.kind === 'issue' ? 'เบิกจากสโตร์' : 'ส่งตรงแปลง'}</td>
                                  <td className="py-1 pr-3">{e.contractorName || '—'}</td>
                                  <td className="py-1 text-right font-medium">
                                    {fmt(e.plotQty)} {m.unit}
                                    {e.groupName && (
                                      <span className="font-normal text-slate-500" title="เบิกให้ทั้งกลุ่มแปลง ระบบแบ่งเท่ากันทุกแปลงในกลุ่ม">
                                        {' '}
                                        (จาก {fmt(e.totalQty)} ให้ {e.groupName})
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </TableFrame>
    </div>
  )
}
