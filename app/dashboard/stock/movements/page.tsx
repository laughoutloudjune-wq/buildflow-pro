'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { getStockMovements } from '@/actions/stock-actions'
import type { StockMovement } from '@/lib/types/stock'

const numberFormat = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 })

const TYPE_LABEL: Record<StockMovement['type'], string> = { in: 'รับเข้า', out: 'เบิกออก' }

const SOURCE_LABEL: Record<StockMovement['source_type'], string> = {
  goods_receipt: 'รับสินค้าตาม PO',
  manual_request: 'เบิกให้ผู้รับเหมา',
  opening_balance: 'ยอดยกมา (ย้ายระบบ)',
  count_adjustment: 'ปรับยอดจากนับสต็อก',
}

const ALL = 'ทั้งหมด'

export default function StockMovementsPage() {
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>(ALL)
  const [sourceFilter, setSourceFilter] = useState<string>(ALL)
  const [projectFilter, setProjectFilter] = useState<string>(ALL)
  const [contractorFilter, setContractorFilter] = useState<string>(ALL)
  const toast = useToast()

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setIsLoading(true)
    try {
      setMovements(await getStockMovements())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดประวัติการเคลื่อนไหวไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  const projectOptions = useMemo(
    () => [ALL, ...Array.from(new Set(movements.map((m) => m.projects?.name).filter((n): n is string => Boolean(n)))).sort((a, b) => a.localeCompare(b, 'th'))],
    [movements]
  )
  const contractorOptions = useMemo(
    () => [ALL, ...Array.from(new Set(movements.map((m) => m.contractors?.name).filter((n): n is string => Boolean(n)))).sort((a, b) => a.localeCompare(b, 'th'))],
    [movements]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return movements
      .filter((m) => !q || m.material_types?.name.toLowerCase().includes(q))
      .filter((m) => typeFilter === ALL || m.type === typeFilter)
      .filter((m) => sourceFilter === ALL || m.source_type === sourceFilter)
      .filter((m) => projectFilter === ALL || m.projects?.name === projectFilter)
      .filter((m) => contractorFilter === ALL || m.contractors?.name === contractorFilter)
  }, [movements, search, typeFilter, sourceFilter, projectFilter, contractorFilter])

  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดประวัติการเคลื่อนไหว...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/dashboard/stock" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> กลับไปหน้าสต็อกวัสดุ
      </Link>

      <PageHeader title="ประวัติการเคลื่อนไหวสต็อก" subtitle="ทุกรายการรับเข้า-เบิกออก ของทุกวัสดุ" />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อวัสดุ..."
            className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none">
            <option value={ALL}>ประเภททั้งหมด</option>
            <option value="in">รับเข้า</option>
            <option value="out">เบิกออก</option>
          </select>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none">
            <option value={ALL}>ที่มาทั้งหมด</option>
            <option value="goods_receipt">รับสินค้าตาม PO</option>
            <option value="manual_request">เบิกให้ผู้รับเหมา</option>
            <option value="opening_balance">ยอดยกมา (ย้ายระบบ)</option>
            <option value="count_adjustment">ปรับยอดจากนับสต็อก</option>
          </select>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none">
            {projectOptions.map((p) => (
              <option key={p} value={p}>
                {p === ALL ? 'โครงการทั้งหมด' : p}
              </option>
            ))}
          </select>
          <select value={contractorFilter} onChange={(e) => setContractorFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none">
            {contractorOptions.map((c) => (
              <option key={c} value={c}>
                {c === ALL ? 'ผู้รับเหมาทั้งหมด' : c}
              </option>
            ))}
          </select>
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
                <th className="px-4 py-3">วันที่</th>
                <th className="px-4 py-3">วัสดุ</th>
                <th className="px-4 py-3">ประเภท</th>
                <th className="px-4 py-3">ที่มา</th>
                <th className="px-4 py-3">โครงการ / แปลง / ผู้รับเหมา</th>
                <th className="px-4 py-3 text-right">จำนวน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center italic text-slate-400">
                    ไม่พบรายการที่ตรงกับเงื่อนไข
                  </td>
                </tr>
              ) : (
                filtered.map((m) => (
                  <tr key={m.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                      {new Date(m.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td className="px-4 py-3">
                      {m.material_types ? (
                        <Link href={`/dashboard/stock/${m.material_type_id}`} className="font-medium text-indigo-600 hover:underline">
                          {m.material_types.name}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={m.type === 'in' ? 'success' : 'info'}>{TYPE_LABEL[m.type]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{SOURCE_LABEL[m.source_type]}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {[m.projects?.name, m.plots?.name, m.plot_groups?.name, m.contractors?.name, m.note].filter(Boolean).join(' · ') || '-'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-medium ${m.type === 'in' ? 'text-emerald-600' : 'text-slate-700'}`}>
                      {m.type === 'in' ? '+' : '-'}
                      {numberFormat.format(m.quantity)}
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
