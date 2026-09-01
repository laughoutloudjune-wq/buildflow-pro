'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Copy, Loader2, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import {
  getPurchaseOrders,
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

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [tab, setTab] = useState<TabKey>('po')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [isLoading, setIsLoading] = useState(true)
  const [isMarkingPaid, setIsMarkingPaid] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const toast = useToast()

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    setSelected(new Set())
  }, [tab])

  async function load() {
    setIsLoading(true)
    try {
      setOrders(await getPurchaseOrders())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดใบสั่งซื้อไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  const rows = useMemo(() => orders.filter((o) => tabOf(o.status) === tab), [orders, tab])
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
        return load()
      })
      .then(() => toast.success('ทำเครื่องหมายว่าชำระเงินแล้ว'))
      .catch((error) => toast.error(error instanceof Error ? error.message : 'ทำเครื่องหมายว่าชำระเงินไม่สำเร็จ'))
      .finally(() => setIsMarkingPaid(false))
  }

  function handleDuplicateSelected() {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    setIsDuplicating(true)
    duplicatePurchaseOrders(ids)
      .then(async ({ created, failed }) => {
        setSelected(new Set())
        await load()
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
      .then(async ({ deleted, failed, errors }) => {
        setSelected(new Set())
        await load()
        if (deleted > 0) toast.success(`ลบใบสั่งซื้อแล้ว ${deleted} รายการ`)
        if (failed > 0) toast.error(`ลบไม่สำเร็จ ${failed} รายการ${errors[0] ? `: ${errors[0]}` : ''}`)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'ลบไม่สำเร็จ'))
      .finally(() => setIsDeleting(false))
  }

  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดใบสั่งซื้อ...</p>
      </div>
    )
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
              onClick={() => setTab(t.key)}
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
                <th className="px-4 py-3">เลขที่ PO</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3">ผู้จำหน่าย</th>
                <th className="px-4 py-3">บริษัทผู้ซื้อ</th>
                <th className="px-4 py-3">วัสดุ</th>
                <th className="px-4 py-3">โครงการ</th>
                <th className="px-4 py-3">{dateHeader}</th>
                <th className="px-4 py-3 text-right">ยอดรวม</th>
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
