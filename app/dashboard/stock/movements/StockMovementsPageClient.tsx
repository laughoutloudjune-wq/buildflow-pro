'use client'

import { useEffect, useMemo, useState } from 'react'
import { BackButton } from '@/components/ui/BackButton'
import { useUrlNumber, useUrlState, useSkipFirstEffect, useUrlString } from '@/lib/use-url-state'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'
import EditWithdrawalModal from '@/components/stock/EditWithdrawalModal'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { useToast } from '@/components/ui/Toast'
import Pagination, { usePagedRows } from '@/components/ui/Pagination'
import type { StockMovement } from '@/lib/types/stock'
import { TableFrame } from '@/components/ui/TableFrame'
import { PageToolbar } from '@/components/ui/PageToolbar'

const PAGE_SIZE = 50

const numberFormat = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 })

const TYPE_LABEL: Record<StockMovement['type'], string> = { in: 'รับเข้า', out: 'เบิกออก' }

const SOURCE_LABEL: Record<StockMovement['source_type'], string> = {
  goods_receipt: 'รับสินค้าตาม PO',
  manual_request: 'เบิกให้ผู้รับเหมา',
  opening_balance: 'ยอดยกมา (ย้ายระบบ)',
  count_adjustment: 'ปรับยอดจากนับสต็อก',
  direct_to_site: 'ส่งตรงหน้างาน',
}

// goods_receipt_create posts an 'in' immediately followed by an 'out' for any
// line that never entered the store (see MATERIAL_FLOW_PLAN.md Phase 1) -
// same source_id (the receipt line), so the pair collapses to just the
// direct_to_site row rather than reading as two separate deliveries.
function collapseDirectToSite(movements: StockMovement[]): StockMovement[] {
  const directSiteSourceIds = new Set(movements.filter((m) => m.source_type === 'direct_to_site').map((m) => m.source_id))
  return movements.filter((m) => !(m.source_type === 'goods_receipt' && directSiteSourceIds.has(m.source_id)))
}

const SOURCE_LABELS: Record<string, string> = {
  goods_receipt: 'รับสินค้าตาม PO',
  manual_request: 'เบิกให้ผู้รับเหมา',
  opening_balance: 'ยอดยกมา (ย้ายระบบ)',
  count_adjustment: 'ปรับยอดจากนับสต็อก',
  direct_to_site: 'ส่งตรงหน้างาน',
}

const ALL = 'ทั้งหมด'

export default function StockMovementsPageClient({
  movements: rawMovements,
  initialError,
}: {
  movements: StockMovement[]
  initialError?: string | null
}) {
  const movements = useMemo(() => collapseDirectToSite(rawMovements), [rawMovements])
  const [search, setSearch] = useUrlString('q', '')
  const [typeFilter, setTypeFilter] = useUrlState<string>('type', ALL)
  const [sourceFilter, setSourceFilter] = useUrlState<string>('source', ALL)
  const [projectFilter, setProjectFilter] = useUrlState<string>('project', ALL)
  const [contractorFilter, setContractorFilter] = useUrlState<string>('contractor', ALL)
  const [page, setPage] = useUrlNumber('page', 1)
  const toast = useToast()
  const router = useRouter()
  const [editingBatch, setEditingBatch] = useState<string | null>(null)
  const editingRows = editingBatch ? rawMovements.filter((m) => m.source_id === editingBatch && m.source_type === 'manual_request') : []

  // Any filter change can shrink the result set below the page the user was
  // on - back to page 1 rather than showing an empty table.
  useSkipFirstEffect(() => {
    setPage(1)
  }, [search, typeFilter, sourceFilter, projectFilter, contractorFilter])

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

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
      .filter((m) => !q || m.material_types?.name.toLowerCase().includes(q) || (m.issue_no || '').toLowerCase().includes(q))
      .filter((m) => typeFilter === ALL || m.type === typeFilter)
      .filter((m) => sourceFilter === ALL || m.source_type === sourceFilter)
      .filter((m) => projectFilter === ALL || m.projects?.name === projectFilter)
      .filter((m) => contractorFilter === ALL || m.contractors?.name === contractorFilter)
  }, [movements, search, typeFilter, sourceFilter, projectFilter, contractorFilter])

  const { pageCount, currentPage, pagedRows } = usePagedRows(filtered, page, PAGE_SIZE)

  return (
    <PageContainer width="standard">
      <BackButton fallbackHref="/dashboard/stock" label="กลับไปหน้าสต็อกวัสดุ" />

      <PageHeader title="ประวัติการเคลื่อนไหวสต็อก" subtitle="ทุกรายการรับเข้า-เบิกออก ของทุกวัสดุ" />

      <PageToolbar
        search={{ value: search, onChange: setSearch, placeholder: 'ค้นหาชื่อวัสดุ...' }}
        resultCount={filtered.length}
        activeFilters={[
          ...(search.trim() ? [{ label: `ค้นหา "${search.trim()}"`, onRemove: () => setSearch('') }] : []),
          ...(typeFilter !== ALL ? [{ label: typeFilter === 'in' ? 'รับเข้า' : 'เบิกออก', onRemove: () => setTypeFilter(ALL) }] : []),
          ...(sourceFilter !== ALL ? [{ label: SOURCE_LABELS[sourceFilter] ?? sourceFilter, onRemove: () => setSourceFilter(ALL) }] : []),
          ...(projectFilter !== ALL ? [{ label: projectFilter, onRemove: () => setProjectFilter(ALL) }] : []),
          ...(contractorFilter !== ALL ? [{ label: contractorFilter, onRemove: () => setContractorFilter(ALL) }] : []),
        ]}
        onReset={() => {
          setSearch('')
          setTypeFilter(ALL)
          setSourceFilter(ALL)
          setProjectFilter(ALL)
          setContractorFilter(ALL)
        }}
      >
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="ประเภท" className="min-w-[9rem]">
          <option value={ALL}>ประเภททั้งหมด</option>
          <option value="in">รับเข้า</option>
          <option value="out">เบิกออก</option>
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} aria-label="ที่มา" className="min-w-[9rem]">
          <option value={ALL}>ที่มาทั้งหมด</option>
          {Object.entries(SOURCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} aria-label="โครงการ" className="min-w-[9rem]">
          {projectOptions.map((p) => (
            <option key={p} value={p}>
              {p === ALL ? 'โครงการทั้งหมด' : p}
            </option>
          ))}
        </select>
        <select value={contractorFilter} onChange={(e) => setContractorFilter(e.target.value)} aria-label="ผู้รับเหมา" className="min-w-[9rem]">
          {contractorOptions.map((c) => (
            <option key={c} value={c}>
              {c === ALL ? 'ผู้รับเหมาทั้งหมด' : c}
            </option>
          ))}
        </select>
      </PageToolbar>

      <TableFrame>
          <table>
            <thead>
              <tr>
                <th className="px-4 py-3">วันที่</th>
                <th className="px-4 py-3">วัสดุ</th>
                <th className="px-4 py-3">ประเภท</th>
                <th className="px-4 py-3">ที่มา</th>
                <th className="px-4 py-3">โครงการ / แปลง / ผู้รับเหมา</th>
                <th className="px-4 py-3 text-right">จำนวน</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center italic text-slate-500">
                    ไม่พบรายการที่ตรงกับเงื่อนไข
                  </td>
                </tr>
              ) : (
                pagedRows.map((m) => (
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
                    <td className="px-4 py-3 text-slate-600">
                      {SOURCE_LABEL[m.source_type]}
                      {m.issue_no && <span className="block font-mono text-xs text-slate-500">{m.issue_no}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {[m.projects?.name, m.plots?.name, m.plot_groups?.name, m.contractors?.name, m.note].filter(Boolean).join(' · ') || '-'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-medium ${m.type === 'in' ? 'text-emerald-600' : 'text-slate-700'}`}>
                      {m.type === 'in' ? '+' : '-'}
                      {numberFormat.format(m.quantity)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {m.source_type === 'manual_request' && m.type === 'out' && m.source_id && (
                        <button
                          type="button"
                          onClick={() => setEditingBatch(m.source_id)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                        >
                          <Pencil className="h-3.5 w-3.5" /> แก้ไขใบเบิก
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        
        <Pagination currentPage={currentPage} pageCount={pageCount} onPageChange={setPage} />
      </TableFrame>
      {editingBatch && editingRows.length > 0 && (
        <EditWithdrawalModal
          rows={editingRows}
          onClose={() => setEditingBatch(null)}
          onSaved={() => {
            setEditingBatch(null)
            router.refresh()
          }}
        />
      )}
    </PageContainer>
  )
}
