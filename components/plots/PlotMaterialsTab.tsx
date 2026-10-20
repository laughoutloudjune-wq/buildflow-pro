'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { PlotMaterialRowView } from '@/lib/types/plotDetail'
import { EmptyState } from '@/components/ui/EmptyState'

const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 })

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })

type Status = 'over' | 'req' | 'nob' | 'ok' | 'none'
type Filter = 'all' | 'over' | 'req' | 'nob'

/** True when any of this row's figures is a share of a batch, not an exact
 * count for this plot alone. */
function isEstimatedRow(m: PlotMaterialRowView): boolean {
  return m.sources.some((s) => s.weight < 1 || s.receivedIsEstimate) || m.stockEntries.some((e) => !!e.groupName)
}

/** Same rule as the BOQ control page: used over BOQ + waste allowance is over;
 * requested over it is a warning only. No BOQ line is its own state. */
function statusOf(m: PlotMaterialRowView): Status {
  const used = m.issuedQty + m.directQty
  if (m.requestedQty === 0 && m.orderedQty === 0 && used === 0) return 'none'
  if (m.plannedQty == null) return 'nob'
  const ceiling = m.plannedQty + (m.allowanceQty || 0)
  if (used > ceiling) return 'over'
  if (m.requestedQty > ceiling) return 'req'
  return 'ok'
}

const SEVERITY: Record<Status, number> = { over: 0, req: 1, nob: 2, ok: 3, none: 4 }

const CHIP: Record<Status, { text: string; cls: string } | null> = {
  over: { text: 'ใช้เกิน BOQ', cls: 'bg-red-50 text-red-700' },
  req: { text: 'ขอเกิน BOQ', cls: 'bg-amber-50 text-amber-800' },
  nob: { text: 'ไม่มีใน BOQ', cls: 'bg-slate-100 text-slate-600' },
  ok: null,
  none: null,
}

function MaterialBar({ m, status }: { m: PlotMaterialRowView; status: Status }) {
  const used = m.issuedQty + m.directQty
  const ceiling = m.plannedQty != null ? m.plannedQty + (m.allowanceQty || 0) : null
  const scale = Math.max(ceiling ?? 0, m.requestedQty, m.orderedQty, m.receivedQty, used, 1)
  const w = (n: number) => `${Math.min(100, (n / scale) * 100)}%`
  const usedColor = status === 'over' ? 'bg-red-500' : 'bg-indigo-500'
  return (
    <span className="relative block h-2.5 rounded-full bg-slate-100" aria-hidden>
      <span className="absolute inset-y-0 left-0 rounded-full bg-slate-200" style={{ width: w(Math.max(m.requestedQty, m.orderedQty)) }} />
      <span className="absolute inset-y-0 left-0 rounded-full bg-slate-300" style={{ width: w(m.receivedQty) }} />
      <span className={`absolute inset-y-0 left-0 rounded-full ${usedColor}`} style={{ width: w(used) }} />
      {ceiling != null && <span className="absolute -inset-y-0.5 w-0.5 bg-slate-700" style={{ left: w(ceiling) }} />}
    </span>
  )
}

function Funnel({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div className="min-w-[4.5rem]">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-slate-800">{value == null ? '—' : `${fmt(value)} ${unit}`}</div>
    </div>
  )
}

export default function PlotMaterialsTab({ materials, canSeeCost }: { materials: PlotMaterialRowView[]; canSeeCost: boolean }) {
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<Filter>('all')

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

  const rows = materials
    .map((m) => ({ m, status: statusOf(m) }))
    .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.m.name.localeCompare(b.m.name, 'th'))
  const count = (s: Status) => rows.filter((r) => r.status === s).length
  const usedValue = materials.reduce((sum, m) => sum + (m.issuedValue || 0), 0)
  const shown = rows.filter((r) => filter === 'all' || r.status === filter)

  const summary = [
    canSeeCost ? `ใช้วัสดุไปแล้ว ฿${formatCurrency(usedValue)}` : `${materials.length} รายการวัสดุ`,
    count('over') > 0 ? `ใช้เกิน BOQ ${count('over')} รายการ` : null,
    count('req') > 0 ? `ขอเกิน BOQ ${count('req')} รายการ` : null,
  ].filter(Boolean) as string[]
  const hot = count('over') > 0

  const filters: Array<{ key: Filter; label: string; n: number }> = [
    { key: 'all', label: 'ทั้งหมด', n: rows.length },
    { key: 'over', label: 'ใช้เกิน BOQ', n: count('over') },
    { key: 'req', label: 'ขอเกิน BOQ', n: count('req') },
    { key: 'nob', label: 'ไม่มีใน BOQ', n: count('nob') },
  ]

  return (
    <div className="space-y-3">
      <p className={`rounded-md px-3 py-2 text-sm ${hot ? 'bg-red-50 text-red-900' : 'bg-slate-50 text-slate-700'}`}>{summary.join(' · ')}</p>
      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === f.key ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {f.label} {f.n}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        แถบ: <span className="text-slate-400">เทาอ่อน = ขอ/สั่ง</span> · <span className="text-slate-500">เทา = รับแล้ว</span> · <span className="text-indigo-600">ม่วง = ใช้จริง</span> · เส้นดำ = BOQ รวมเผื่อเสีย · ใช้จริง = เบิกจากสโตร์ + ส่งตรงแปลง · การเบิกที่ระบุเป็นกลุ่มแปลงจะแบ่งเท่ากันทุกแปลงในกลุ่ม
      </p>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {shown.length === 0 && <p className="p-4 text-sm text-slate-500">ไม่มีรายการในตัวกรองนี้</p>}
        {shown.map(({ m, status }) => {
          const isOpen = open.has(m.materialTypeId)
          const used = m.issuedQty + m.directQty
          const hasDetail = m.sources.length > 0 || m.stockEntries.length > 0
          const est = isEstimatedRow(m)
          const chip = CHIP[status]
          const ceiling = m.plannedQty != null ? m.plannedQty + (m.allowanceQty || 0) : null
          return (
            <div key={m.materialTypeId}>
              <button
                type="button"
                onClick={() => toggle(m.materialTypeId)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-slate-50 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]"
                aria-expanded={isOpen}
              >
                <span className="flex items-center gap-1 text-sm font-medium text-slate-800">
                  {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                  <span className="truncate">{m.name}</span>
                </span>
                <span className="order-3 col-span-2 sm:order-none sm:col-span-1">
                  <MaterialBar m={m} status={status} />
                </span>
                <span className="flex items-center justify-end gap-2 text-xs">
                  <span className="tabular-nums text-slate-600">
                    {est ? '≈ ' : ''}
                    {used ? fmt(used) : '0'}
                    {ceiling != null ? ` / ${fmt(ceiling)}` : ''} {m.unit}
                  </span>
                  {chip && <span className={`rounded-full px-2 py-0.5 font-medium ${chip.cls}`}>{chip.text}</span>}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-3 bg-slate-50/60 px-4 py-3">
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <Funnel label="แผน (BOQ+เผื่อ)" value={ceiling} unit={m.unit} />
                    <Funnel label="ขอซื้อ" value={m.requestedQty} unit={m.unit} />
                    <Funnel label="สั่ง" value={m.orderedQty} unit={m.unit} />
                    <Funnel label="รับแล้ว" value={m.receivedQty} unit={m.unit} />
                    <Funnel label="ใช้จริง" value={used} unit={m.unit} />
                    {canSeeCost && m.orderedValue ? (
                      <div className="min-w-[4.5rem]">
                        <div className="text-[11px] text-slate-500">มูลค่าสั่งซื้อ</div>
                        <div className="text-sm font-semibold tabular-nums text-slate-800">฿{formatCurrency(m.orderedValue)}</div>
                      </div>
                    ) : null}
                    {canSeeCost && m.issuedValue ? (
                      <div className="min-w-[4.5rem]">
                        <div className="text-[11px] text-slate-500" title="ตามราคาซื้อเฉลี่ยของสโตร์">มูลค่าเบิกสโตร์</div>
                        <div className="text-sm font-semibold tabular-nums text-slate-800">฿{formatCurrency(m.issuedValue)}</div>
                      </div>
                    ) : null}
                  </div>
                  {est && <p className="text-[11px] text-slate-500">≈ บางตัวเลขเป็นค่าประมาณ: การซื้อหรือเบิกที่ครอบคลุมหลายแปลงถูกแบ่งเท่ากันทุกแปลงในกลุ่ม</p>}
                  {!hasDetail && <p className="text-xs text-slate-400">ยังไม่มีใบสั่งซื้อหรือใบเบิกที่ผูกกับแปลงนี้</p>}
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
                  <th className="py-1 pr-3 text-right font-medium">ของแปลงนี้</th>
                  <th className="py-1 text-right font-medium">มูลค่า</th>
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
                    <td className="py-1 pr-3 text-right font-medium">
                      {fmt(e.plotQty)} {m.unit}
                      {e.groupName && (
                        <span className="font-normal text-slate-500" title="เบิกให้ทั้งกลุ่มแปลง ระบบแบ่งเท่ากันทุกแปลงในกลุ่ม">
                          {' '}
                          (จาก {fmt(e.totalQty)} ให้ {e.groupName})
                        </span>
                      )}
                    </td>
                    <td
                      className="whitespace-nowrap py-1 text-right"
                      title={
                        e.costEstimated
                          ? 'ต้นทุนประมาณจากราคาเฉลี่ยตอนปรับระบบ - รายการใหม่จะบันทึกต้นทุนจริงตอนเบิก'
                          : 'ต้นทุนต่อหน่วย ณ วันที่เบิก ไม่เปลี่ยนตามราคาที่มาทีหลัง'
                      }
                    >
                      {e.unitCost == null ? '—' : `${e.costEstimated ? '≈ ' : ''}฿${e.plotValue.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
