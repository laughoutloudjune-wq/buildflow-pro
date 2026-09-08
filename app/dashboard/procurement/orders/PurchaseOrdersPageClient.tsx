'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Loader2, Plus, Search, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import {
  markPurchaseOrdersAsPaid,
  duplicatePurchaseOrders,
  deletePurchaseOrders,
} from '@/actions/procurement-actions'
import type { PurchaseOrder, PurchaseOrderStatus } from '@/lib/types/procurement'

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'ร่าง',
  sent: 'ยืนยันสั่งซื้อ',
  partially_received: 'รับของบางส่วน',
  received: 'รับของแล้ว',
  paid: 'ชำระแล้ว',
  cancelled: 'ยกเลิก',
}

const STATUS_DOT: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-slate-400',
  sent: 'bg-emerald-500',
  partially_received: 'bg-amber-500',
  received: 'bg-indigo-500',
  paid: 'bg-violet-500',
  cancelled: 'bg-red-500',
}

const STATUS_TEXT: Record<PurchaseOrderStatus, string> = {
  draft: 'text-slate-500',
  sent: 'text-emerald-700',
  partially_received: 'text-amber-700',
  received: 'text-indigo-700',
  paid: 'text-violet-700',
  cancelled: 'text-red-600',
}

type TabKey = 'po' | 'receive' | 'paid'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'po', label: 'PO' },
  { key: 'receive', label: 'รับบิล' },
  { key: 'paid', label: 'ชำระบิล' },
]

function tabOf(status: PurchaseOrderStatus): TabKey {
  if (status === 'received') return 'receive'
  if (status === 'paid') return 'paid'
  return 'po'
}

function dateColumnFor(tab: TabKey, order: PurchaseOrder): string | null {
  if (tab === 'receive') return order.received_at
  if (tab === 'paid') return order.paid_at
  return order.order_date
}

/** First material line plus a count of how many more, for a quick "what's
 * in this PO" glance without opening it. Item order isn't guaranteed by the
 * schema - this is a hint, not a promise of line 1. */
function materialSummary(order: PurchaseOrder): { label: string; extra: number } {
  const items = order.purchase_order_items || []
  if (items.length === 0) return { label: '-', extra: 0 }
  return { label: items[0].material_types?.name || '-', extra: items.length - 1 }
}

type SortKey = 'po_no' | 'status' | 'supplier' | 'company' | 'project' | 'date' | 'total'

function SortableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = 'left',
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey
  direction: 'asc' | 'desc'
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
}) {
  const isActive = activeKey === sortKey
  const Icon = isActive ? (direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th className={`px-4 py-3 ${align === 'right' ? 'text-right' : ''}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-slate-700 ${isActive ? 'text-slate-800' : ''}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${isActive ? 'text-indigo-600' : 'text-slate-300'}`} />
      </button>
    </th>
  )
}

export default function PurchaseOrdersPageClient({
  orders,
  initialError,
}: {
  orders: PurchaseOrder[]
  initialError?: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [tab, setTab] = useState<TabKey>('po')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [isMarkingPaid, setIsMarkingPaid] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  const [search, setSearch] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'date', direction: 'desc' })
  const collator = useMemo(() => new Intl.Collator('th', { numeric: true, sensitivity: 'base' }), [])

  function resetTabScopedFilters() {
    setSelected(new Set())
    setDateFrom('')
    setDateTo('')
  }

  function changeTab(next: TabKey) {
    setTab(next)
    resetTabScopedFilters()
  }

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }))
  }

  function clearFilters() {
    setSearch('')
    setSupplierFilter('')
    setProjectFilter('')
    setCompanyFilter('')
    setDateFrom('')
    setDateTo('')
  }

  const supplierOptions = useMemo(
    () => Array.from(new Set(orders.map((o) => o.suppliers?.name).filter((v): v is string => !!v))).sort((a, b) => collator.compare(a, b)),
    [orders, collator]
  )
  const projectOptions = useMemo(
    () => Array.from(new Set(orders.map((o) => o.projects?.name).filter((v): v is string => !!v))).sort((a, b) => collator.compare(a, b)),
    [orders, collator]
  )
  const companyOptions = useMemo(
    () => Array.from(new Set(orders.map((o) => o.companies?.name).filter((v): v is string => !!v))).sort((a, b) => collator.compare(a, b)),
    [orders, collator]
  )

  const tabRows = useMemo(() => orders.filter((o) => tabOf(o.status) === tab), [orders, tab])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let result = tabRows

    if (supplierFilter) result = result.filter((o) => o.suppliers?.name === supplierFilter)
    if (projectFilter) result = result.filter((o) => o.projects?.name === projectFilter)
    if (companyFilter) result = result.filter((o) => o.companies?.name === companyFilter)
    if (dateFrom || dateTo) {
      result = result.filter((o) => {
        const d = dateColumnFor(tab, o)
        if (!d) return false
        if (dateFrom && d < dateFrom) return false
        if (dateTo && d > dateTo) return false
        return true
      })
    }
    if (q) {
      result = result.filter((o) => {
        const materials = (o.purchase_order_items || []).map((i) => i.material_types?.name || '').join(' ')
        const haystack = `${o.po_no} ${o.suppliers?.name || ''} ${o.projects?.name || ''} ${o.companies?.name || ''} ${materials}`.toLowerCase()
        return haystack.includes(q)
      })
    }

    const dir = sort.direction === 'asc' ? 1 : -1
    return [...result].sort((a, b) => {
      switch (sort.key) {
        case 'po_no':
          return collator.compare(a.po_no, b.po_no) * dir
        case 'status':
          return collator.compare(STATUS_LABEL[a.status], STATUS_LABEL[b.status]) * dir
        case 'supplier':
          return collator.compare(a.suppliers?.name || '', b.suppliers?.name || '') * dir
        case 'company':
          return collator.compare(a.companies?.name || '', b.companies?.name || '') * dir
        case 'project':
          return collator.compare(a.projects?.name || '', b.projects?.name || '') * dir
        case 'date': {
          const da = dateColumnFor(tab, a) || ''
          const db = dateColumnFor(tab, b) || ''
          return da < db ? -dir : da > db ? dir : 0
        }
        case 'total':
          return (a.total_amount - b.total_amount) * dir
        default:
          return 0
      }
    })
  }, [tabRows, tab, search, supplierFilter, projectFilter, companyFilter, dateFrom, dateTo, sort, collator])

  const grandTotal = useMemo(() => rows.reduce((sum, o) => sum + o.total_amount, 0), [rows])
  const selectedTotal = useMemo(
    () => rows.filter((o) => selected.has(o.id)).reduce((sum, o) => sum + o.total_amount, 0),
    [rows, selected]
  )
  const allSelected = rows.length > 0 && rows.every((o) => selected.has(o.id))

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((o) => o.id)))
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleMarkPaid() {
    if (selected.size === 0) return
    setIsMarkingPaid(true)
    markPurchaseOrdersAsPaid(Array.from(selected), payDate)
      .then(() => {
        setSelected(new Set())
        router.refresh()
        toast.success('ทำเครื่องหมายว่าชำระเงินแล้ว')
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'ทำเครื่องหมายว่าชำระเงินไม่สำเร็จ'))
      .finally(() => setIsMarkingPaid(false))
  }

  function handleDuplicateSelected() {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    setIsDuplicating(true)
    duplicatePurchaseOrders(ids)
      .then(({ created, failed }) => {
        setSelected(new Set())
        router.refresh()
        if (created.length > 0) toast.success(`ทำสำเนาใบสั่งซื้อแล้ว ${created.length} รายการ (บันทึกเป็นร่าง)`)
        if (failed > 0) toast.error(`ทำสำเนาไม่สำเร็จ ${failed} รายการ`)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'ทำสำเนาไม่สำเร็จ'))
      .finally(() => setIsDuplicating(false))
  }

  function handleDeleteSelected() {
    if (selected.size === 0) return
    if (!confirm(`ลบใบสั่งซื้อที่เลือก ${selected.size} รายการ? การลบไม่สามารถย้อนกลับได้`)) return
    const ids = Array.from(selected)
    setIsDeleting(true)
    deletePurchaseOrders(ids)
      .then(({ deleted, failed, errors }) => {
        setSelected(new Set())
        router.refresh()
        if (deleted > 0) toast.success(`ลบใบสั่งซื้อแล้ว ${deleted} รายการ`)
        if (failed > 0) toast.error(`ลบไม่สำเร็จ ${failed} รายการ${errors[0] ? `: ${errors[0]}` : ''}`)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'ลบไม่สำเร็จ'))
      .finally(() => setIsDeleting(false))
  }

  const dateHeader = tab === 'receive' ? 'วันที่รับของ' : tab === 'paid' ? 'วันที่ชำระ' : 'วันที่สั่งซื้อ'

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="ใบสั่งซื้อ (Purchase Orders)"
        subtitle="ใบสั่งซื้อวัสดุที่ออกให้ผู้จำหน่าย ติดตามสถานะจนถึงชำระเงิน"
        actions={
          <Link href="/dashboard/procurement/orders/create">
            <Button>
              <Plus className="h-4 w-4" /> สร้างใบสั่งซื้อ
            </Button>
          </Link>
        }
      />


      <div className="flex gap-2 border-b border-slate-200">
        {TABS.map((t) => {
          const count = orders.filter((o) => tabOf(o.status) === t.key).length
          return (
            <button
              key={t.key}
              onClick={() => changeTab(t.key)}
              className={`relative -mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                tab === t.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${tab === t.key ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      <Card className="border-slate-200 p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9"
              placeholder="ค้นหาเลขที่ PO / ผู้จำหน่าย / โครงการ / วัสดุ"
            />
          </div>
          <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="w-full">
            <option value="">ทุกผู้จำหน่าย</option>
            {supplierOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="w-full">
            <option value="">ทุกโครงการ</option>
            {projectOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="w-full">
            <option value="">ทุกบริษัทผู้ซื้อ</option>
            {companyOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title={`${dateHeader} จาก`} />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title={`${dateHeader} ถึง`} />
          </div>
        </div>
        {(search || supplierFilter || projectFilter || companyFilter || dateFrom || dateTo) && (
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={clearFilters} className="text-xs font-medium text-indigo-600 hover:underline">
              ล้างตัวกรอง
            </button>
          </div>
        )}
      </Card>

      {selected.size > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-indigo-100 bg-indigo-50/60 px-4 py-3">
          <span className="text-sm text-indigo-800">
            เลือกแล้ว <span className="font-semibold">{selected.size}</span> รายการ · ยอดรวม{' '}
            <span className="font-semibold">฿{formatCurrency(selectedTotal)}</span>
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {tab === 'receive' && (
              <>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="text-sm" />
                <Button type="button" size="sm" onClick={handleMarkPaid} disabled={isMarkingPaid}>
                  {isMarkingPaid ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'ทำเครื่องหมายว่าชำระแล้ว'}
                </Button>
              </>
            )}
            <Button type="button" size="sm" variant="secondary" onClick={handleDuplicateSelected} disabled={isDuplicating}>
              {isDuplicating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />} ทำสำเนา
            </Button>
            <Button type="button" size="sm" variant="danger" onClick={handleDeleteSelected} disabled={isDeleting}>
              {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} ลบ
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm">
          <span className="text-slate-500">
            ผลลัพธ์ <span className="font-semibold text-slate-700">{rows.length}</span> รายการ
          </span>
          <span className="text-slate-500">
            ยอดรวมทั้งหมด: <span className="font-semibold text-slate-800">฿{formatCurrency(grandTotal)}</span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={rows.length === 0} />
                </th>
                <SortableHeader label="เลขที่ PO" sortKey="po_no" activeKey={sort.key} direction={sort.direction} onSort={toggleSort} />
                <SortableHeader label="สถานะ" sortKey="status" activeKey={sort.key} direction={sort.direction} onSort={toggleSort} />
                <SortableHeader label="ผู้จำหน่าย" sortKey="supplier" activeKey={sort.key} direction={sort.direction} onSort={toggleSort} />
                <SortableHeader label="บริษัทผู้ซื้อ" sortKey="company" activeKey={sort.key} direction={sort.direction} onSort={toggleSort} />
                <th className="px-4 py-3">วัสดุ</th>
                <SortableHeader label="โครงการ" sortKey="project" activeKey={sort.key} direction={sort.direction} onSort={toggleSort} />
                <SortableHeader label={dateHeader} sortKey="date" activeKey={sort.key} direction={sort.direction} onSort={toggleSort} />
                <SortableHeader label="ยอดรวม" sortKey="total" activeKey={sort.key} direction={sort.direction} onSort={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center italic text-slate-400">
                    ไม่มีใบสั่งซื้อในสถานะนี้
                  </td>
                </tr>
              ) : (
                rows.map((o) => {
                  const dateValue = dateColumnFor(tab, o)
                  const { label: materialLabel, extra: materialExtra } = materialSummary(o)
                  return (
                    <tr key={o.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleOne(o.id)} />
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/procurement/orders/${o.id}`} className="font-mono font-medium text-indigo-600 hover:underline">
                          {o.po_no}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${STATUS_TEXT[o.status]}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[o.status]}`} />
                          {STATUS_LABEL[o.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{o.suppliers?.name || '-'}</td>
                      <td className="px-4 py-3 text-slate-500">{o.companies?.name || '-'}</td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-slate-500">
                        {materialLabel}
                        {materialExtra > 0 && <span className="ml-1 text-xs text-slate-400">+{materialExtra}</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{o.projects?.name || '-'}</td>
                      <td className="px-4 py-3 text-slate-500">{dateValue ? new Date(dateValue).toLocaleDateString('th-TH') : '-'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">฿{formatCurrency(o.total_amount)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
