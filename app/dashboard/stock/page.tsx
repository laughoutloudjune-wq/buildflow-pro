'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, ListTree, PackageMinus, BarChart3 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import WithdrawDrawer from '@/components/stock/WithdrawDrawer'
import { getStockOverview } from '@/actions/stock-actions'
import type { StockOverviewRow } from '@/lib/types/stock'

const numberFormat = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 })

export default function StockOverviewPage() {
  const [rows, setRows] = useState<StockOverviewRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('ทั้งหมด')
  const [showAll, setShowAll] = useState(false)
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false)
  const toast = useToast()

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setIsLoading(true)
    try {
      setRows(await getStockOverview())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลสต็อกไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

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
  }, [rows, search, category, showAll])

  const trackedCount = rows.filter((r) => r.tracked).length
  const negativeCount = rows.filter((r) => r.tracked && r.quantity_on_hand < 0).length
  const zeroCount = rows.filter((r) => r.tracked && r.quantity_on_hand === 0).length

  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดข้อมูลสต็อก...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
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
            <Button onClick={() => setIsWithdrawOpen(true)}>
              <PackageMinus className="h-4 w-4" /> เบิกวัสดุให้ผู้รับเหมา
            </Button>
          </>
        }
      />

      <WithdrawDrawer isOpen={isWithdrawOpen} onClose={() => setIsWithdrawOpen(false)} onSuccess={load} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">วัสดุที่มีการเคลื่อนไหว</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{trackedCount.toLocaleString('th-TH')}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">สต็อกติดลบ</div>
          <div className={`mt-1 text-2xl font-semibold ${negativeCount > 0 ? 'text-red-600' : 'text-slate-900'}`}>
            {negativeCount.toLocaleString('th-TH')}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">สต็อกหมด (0)</div>
          <div className={`mt-1 text-2xl font-semibold ${zeroCount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
            {zeroCount.toLocaleString('th-TH')}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาวัสดุ..."
            className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            แสดงวัสดุทั้งหมด (รวมที่ยังไม่มีการเคลื่อนไหว)
          </label>
        </div>

        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 text-sm text-slate-500">
          <span>
            ผลลัพธ์ <span className="font-semibold text-slate-700">{filtered.length}</span> รายการ
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">วัสดุ</th>
                <th className="px-4 py-3">หมวดหมู่</th>
                <th className="px-4 py-3">หน่วย</th>
                <th className="px-4 py-3 text-right">คงเหลือ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center italic text-slate-400">
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
