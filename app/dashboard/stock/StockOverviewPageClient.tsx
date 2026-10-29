'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ListTree, PackageMinus, BarChart3, ClipboardEdit, ClipboardList, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { useToast } from '@/components/ui/Toast'
import WithdrawDrawer from '@/components/stock/WithdrawDrawer'
import AdjustStockModal from '@/components/stock/AdjustStockModal'
import type { StockOverviewRow } from '@/lib/types/stock'
import { createStockAdjustment } from '@/actions/stock-actions'
import { todayInBangkok } from '@/lib/utils'
import { TableFrame } from '@/components/ui/TableFrame'
import { PageToolbar } from '@/components/ui/PageToolbar'

const numberFormat = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 })

export default function StockOverviewPageClient({
  rows,
  canAdjust,
  initialError,
  withdrawPreset = null,
}: {
  rows: StockOverviewRow[]
  /** Stock count adjustment is pm/admin only - hides the quick-adjust
   * column instead of showing it and failing on submit. */
  canAdjust: boolean
  initialError?: string | null
  withdrawPreset?: { projectId: string; plotId?: string } | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('ทั้งหมด')
  const [showAll, setShowAll] = useState(false)
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(Boolean(withdrawPreset))
  // Row being adjusted from the list - lets the Phase 5 yard-count cutover
  // (MATERIAL_FLOW_PLAN.md) walk the whole list without a page navigation
  // per material, the same AdjustStockModal the per-material detail page
  // already uses.
  const [adjustingRow, setAdjustingRow] = useState<StockOverviewRow | null>(null)
  // Count sheet: type what was counted for any number of materials, save once.
  // Each changed row still goes through stock_adjustment_create on its own.
  const [countMode, setCountMode] = useState(false)
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [countNote, setCountNote] = useState('')
  const [isSavingCount, setIsSavingCount] = useState(false)

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  const categories = useMemo(() => {
    const set = new Set(rows.map((r) => r.category).filter((c): c is string => Boolean(c)))
    return ['ทั้งหมด', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'th'))]
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => showAll || r.tracked)
      .filter((r) => category === 'ทั้งหมด' || r.category === category)
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      // Exceptions first: negative stock, then out of stock, then everything else in its usual order.
      .sort((a, b) => {
        const rank = (r: StockOverviewRow) => (r.tracked && r.quantity_on_hand < 0 ? 0 : r.tracked && r.quantity_on_hand === 0 ? 1 : 2)
        return rank(a) - rank(b)
      })
  }, [rows, search, category, showAll])

  const countChanges = useMemo(
    () =>
      rows
        .map((r) => ({ row: r, counted: counts[r.material_type_id] }))
        .filter(({ counted }) => counted !== undefined && counted.trim() !== '')
        .map(({ row, counted }) => ({ row, counted: Number(counted) }))
        .filter(({ row, counted }) => Number.isFinite(counted) && counted >= 0 && counted !== row.quantity_on_hand),
    [rows, counts]
  )

  function startCount() {
    setCounts({})
    setCountNote(`นับสต็อก ${new Date(todayInBangkok()).toLocaleDateString('th-TH')}`)
    setCountMode(true)
  }

  async function saveCount() {
    if (countChanges.length === 0 || !countNote.trim()) return
    setIsSavingCount(true)
    const failed: string[] = []
    const left: Record<number, string> = {}
    for (const { row, counted } of countChanges) {
      const result = await createStockAdjustment({ material_type_id: row.material_type_id, counted_qty: counted, note: countNote })
      if ('error' in result) {
        failed.push(`${row.name}: ${result.error}`)
        left[row.material_type_id] = String(counted)
      }
    }
    setIsSavingCount(false)
    const saved = countChanges.length - failed.length
    if (saved > 0) toast.success(`ปรับยอดแล้ว ${saved} รายการ`)
    if (failed.length > 0) {
      toast.error(`บันทึกไม่สำเร็จ ${failed.length} รายการ - ${failed[0]}`)
      setCounts(left)
    } else {
      setCounts({})
      setCountMode(false)
    }
    router.refresh()
  }

  const trackedCount = rows.filter((r) => r.tracked).length
  const negativeCount = rows.filter((r) => r.tracked && r.quantity_on_hand < 0).length
  const zeroCount = rows.filter((r) => r.tracked && r.quantity_on_hand === 0).length

  return (
    <PageContainer width="standard">
      <PageHeader
        title="สต็อกวัสดุ"
        subtitle="ปริมาณคงเหลือของแต่ละวัสดุ ณ ปัจจุบัน"
        actions={
          <>
            <ButtonLink href="/dashboard/stock/reports" variant="secondary">
              <BarChart3 className="h-4 w-4" /> รายงาน
            </ButtonLink>
            <ButtonLink href="/dashboard/stock/movements" variant="secondary">
              <ListTree className="h-4 w-4" /> ประวัติการเคลื่อนไหวทั้งหมด
            </ButtonLink>
            {canAdjust && !countMode && (
              <Button variant="secondary" onClick={startCount}>
                <ClipboardList className="h-4 w-4" /> นับสต็อก
              </Button>
            )}
            <Button onClick={() => setIsWithdrawOpen(true)}>
              <PackageMinus className="h-4 w-4" /> เบิกวัสดุให้ผู้รับเหมา
            </Button>
          </>
        }
      />

      <WithdrawDrawer
        isOpen={isWithdrawOpen}
        onClose={() => setIsWithdrawOpen(false)}
        onSuccess={() => router.refresh()}
        preset={withdrawPreset}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs font-medium text-slate-500">สต็อกติดลบ</div>
          <div className={`mt-1 text-2xl font-semibold ${negativeCount > 0 ? 'text-red-600' : 'text-slate-900'}`}>
            {negativeCount.toLocaleString('th-TH')}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-slate-500">สต็อกหมด (0)</div>
          <div className={`mt-1 text-2xl font-semibold ${zeroCount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
            {zeroCount.toLocaleString('th-TH')}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-slate-500">วัสดุที่มีการเคลื่อนไหว</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{trackedCount.toLocaleString('th-TH')}</div>
        </Card>
      </div>

      <PageToolbar
        search={{ value: search, onChange: setSearch, placeholder: 'ค้นหาวัสดุ...' }}
        resultCount={filtered.length}
        activeFilters={[
          ...(search.trim() ? [{ label: `ค้นหา "${search.trim()}"`, onRemove: () => setSearch('') }] : []),
          ...(category !== 'ทั้งหมด' ? [{ label: category, onRemove: () => setCategory('ทั้งหมด') }] : []),
          ...(showAll ? [{ label: 'แสดงวัสดุทั้งหมด', onRemove: () => setShowAll(false) }] : []),
        ]}
        onReset={() => {
          setSearch('')
          setCategory('ทั้งหมด')
          setShowAll(false)
        }}
      >
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="หมวดวัสดุ" className="min-w-[10rem]">
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="mb-0 flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          แสดงวัสดุทั้งหมด (รวมที่ยังไม่มีการเคลื่อนไหว)
        </label>
      </PageToolbar>

      <TableFrame>
          <table>
            <thead>
              <tr>
                <th className="px-4 py-3">วัสดุ</th>
                <th className="px-4 py-3">หมวดหมู่</th>
                <th className="px-4 py-3">หน่วย</th>
                <th className="px-4 py-3 text-right">คงเหลือ</th>
                {canAdjust && (countMode ? <th className="w-44 px-2 py-3 text-right">นับได้จริง</th> : <th className="w-10 px-2 py-3" />)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={canAdjust ? 5 : 4} className="px-4 py-8 text-center italic text-slate-500">
                    ไม่พบวัสดุที่ตรงกับเงื่อนไข
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.material_type_id} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/stock/${r.material_type_id}`}
                        className="font-medium text-indigo-600 hover:underline"
                      >
                        {r.name}
                      </Link>
                      {!r.is_requestable && (
                        <span
                          className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                          title="รับเข้าอย่างเดียว - เบิกให้ผู้รับเหมาไม่ได้ ตัวเลขคือยอดรับเข้าสะสม"
                        >
                          รับเข้าอย่างเดียว
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{r.category || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{r.unit}</td>
                    <td className="px-4 py-3 text-right">
                      {!r.tracked ? (
                        <Badge tone="neutral">ยังไม่มีการเคลื่อนไหว</Badge>
                      ) : r.quantity_on_hand < 0 ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="font-mono font-semibold text-red-600">
                            {numberFormat.format(r.quantity_on_hand)}
                          </span>
                          <Badge tone="danger">ติดลบ</Badge>
                        </span>
                      ) : r.quantity_on_hand === 0 ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="font-mono font-semibold text-amber-600">0</span>
                          <Badge tone="warning">หมด</Badge>
                        </span>
                      ) : (
                        <span className="font-mono font-semibold text-slate-800">
                          {numberFormat.format(r.quantity_on_hand)}
                        </span>
                      )}
                    </td>
                    {canAdjust && countMode && (
                      <td className="px-2 py-2 text-right">
                        {(() => {
                          const typed = counts[r.material_type_id] ?? ''
                          const n = Number(typed)
                          const delta = typed.trim() !== '' && Number.isFinite(n) ? n - r.quantity_on_hand : 0
                          // A big gap is only flagged, never blocked.
                          const big = delta !== 0 && Math.abs(delta) >= Math.max(1, Math.abs(r.quantity_on_hand) * 0.5)
                          return (
                            <div className="flex flex-col items-end gap-0.5">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                inputMode="decimal"
                                value={typed}
                                onChange={(e) => setCounts((prev) => ({ ...prev, [r.material_type_id]: e.target.value }))}
                                placeholder={numberFormat.format(r.quantity_on_hand)}
                                aria-label={`จำนวนที่นับได้ ${r.name}`}
                                className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-right font-mono text-sm focus:border-indigo-400 focus:outline-none"
                              />
                              {delta !== 0 && (
                                <span className={`text-[11px] font-medium ${big ? 'text-amber-600' : delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {delta > 0 ? '+' : ''}
                                  {numberFormat.format(delta)}
                                  {big ? ' · ต่างมาก ตรวจอีกครั้ง' : ''}
                                </span>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                    )}
                    {canAdjust && !countMode && (
                      <td className="px-2 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => setAdjustingRow(r)}
                          title="ปรับยอดสต็อก"
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition"
                        >
                          <ClipboardEdit className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
      </TableFrame>

      {countMode && (
        <div className="sticky bottom-0 z-10 -mx-1 pb-1">
          <Card className="elev-floating flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="text-sm font-medium text-slate-800">นับต่างจากระบบ {countChanges.length} รายการ</span>
            <input
              value={countNote}
              onChange={(e) => setCountNote(e.target.value)}
              aria-label="เหตุผลการปรับยอด"
              placeholder="เหตุผล (ต้องระบุ)"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
            />
            <Button type="button" variant="secondary" size="sm" onClick={() => { setCountMode(false); setCounts({}) }} disabled={isSavingCount}>
              ยกเลิก
            </Button>
            <Button type="button" size="sm" onClick={saveCount} disabled={isSavingCount || countChanges.length === 0 || !countNote.trim()}>
              {isSavingCount ? <Loader2 className="h-4 w-4 animate-spin" /> : `บันทึก ${countChanges.length} รายการ`}
            </Button>
          </Card>
        </div>
      )}

      {adjustingRow && (
        <AdjustStockModal
          isOpen={Boolean(adjustingRow)}
          onClose={() => setAdjustingRow(null)}
          onSuccess={() => {
            setAdjustingRow(null)
            router.refresh()
          }}
          materialId={adjustingRow.material_type_id}
          materialName={adjustingRow.name}
          unit={adjustingRow.unit}
          currentQty={adjustingRow.quantity_on_hand}
        />
      )}
    </PageContainer>
  )
}
