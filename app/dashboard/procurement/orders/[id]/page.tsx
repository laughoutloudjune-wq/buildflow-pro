'use client'

import { useEffect, useState, useTransition, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, XCircle, PackageCheck, ChevronDown, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import PurchaseOrderForm from '@/components/procurement/PurchaseOrderForm'
import PurchaseOrderDocActions from '@/components/procurement/PurchaseOrderDocActions'
import {
  cancelPurchaseOrder,
  getPurchaseOrderById,
  setPurchaseOrderStatus,
  markPurchaseOrderReceived,
  unmarkPurchaseOrderReceived,
  unmarkPurchaseOrderPaid,
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

const STATUS_TONE: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-slate-100 text-slate-500',
  sent: 'bg-indigo-50 text-indigo-700',
  partially_received: 'bg-amber-50 text-amber-700',
  received: 'bg-emerald-50 text-emerald-700',
  paid: 'bg-violet-50 text-violet-700',
  cancelled: 'bg-red-50 text-red-700',
}

function formatDate(value: string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString('th-TH')
}

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const toast = useToast()

  useEffect(() => {
    void load()
  }, [id])

  async function load() {
    setIsLoading(true)
    try {
      const data = await getPurchaseOrderById(id)
      setOrder(data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดใบสั่งซื้อไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  function handleCancel() {
    const reason = prompt('เหตุผลที่ยกเลิก:')
    if (reason === null) return
    startTransition(async () => {
      try {
        await cancelPurchaseOrder(id, reason)
        await load()
        toast.success('ยกเลิกใบสั่งซื้อแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ยกเลิกไม่สำเร็จ')
      }
    })
  }

  function handleStatusChange(status: 'draft' | 'sent') {
    if (!order || order.status === status) return
    startTransition(async () => {
      try {
        await setPurchaseOrderStatus(id, status)
        await load()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'เปลี่ยนสถานะไม่สำเร็จ')
      }
    })
  }

  function handleMarkReceived() {
    const today = new Date().toISOString().slice(0, 10)
    const input = prompt('วันที่รับของ (YYYY-MM-DD):', today)
    if (input === null) return
    startTransition(async () => {
      try {
        await markPurchaseOrderReceived(id, input)
        await load()
        toast.success('บันทึกการรับของแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'บันทึกการรับของไม่สำเร็จ')
      }
    })
  }

  function handleUnmarkReceived() {
    if (!confirm('ยกเลิกการรับของ และย้อนกลับไปสถานะยืนยันสั่งซื้อ?')) return
    startTransition(async () => {
      try {
        await unmarkPurchaseOrderReceived(id)
        await load()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ยกเลิกการรับของไม่สำเร็จ')
      }
    })
  }

  function handleUnmarkPaid() {
    if (!confirm('ยกเลิกการชำระเงิน และย้อนกลับไปสถานะรับของแล้ว?')) return
    startTransition(async () => {
      try {
        await unmarkPurchaseOrderPaid(id)
        await load()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ยกเลิกการชำระเงินไม่สำเร็จ')
      }
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดใบสั่งซื้อ...</p>
      </div>
    )
  }

  if (!order) {
    return <div className="py-16 text-center text-slate-400">ไม่พบใบสั่งซื้อนี้</div>
  }

  const canEditStatus = order.status === 'draft' || order.status === 'sent'
  const canCancel = order.status === 'draft' || order.status === 'sent'
  const canReceiveLineItems = order.status === 'sent' || order.status === 'partially_received'
  const canMarkReceived = order.status === 'sent' || order.status === 'partially_received'
  const canUnmarkReceived = order.status === 'received'
  const canUnmarkPaid = order.status === 'paid'
  const isFormReadOnly = order.status !== 'draft'

  const milestones = [
    { label: 'สร้างเมื่อ', value: formatDate(order.created_at) },
    { label: 'ยืนยันเมื่อ', value: formatDate(order.confirmed_at) },
    { label: 'รับของเมื่อ', value: formatDate(order.received_at), by: order.receiver?.full_name },
    { label: 'ชำระเมื่อ', value: formatDate(order.paid_at), by: order.payer?.full_name },
  ].filter((m) => m.value)

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <div>
        <Link
          href="/dashboard/procurement/orders"
          className="mb-2 flex w-fit items-center gap-1 text-sm text-slate-500 transition hover:text-indigo-600"
        >
          <ArrowLeft className="h-4 w-4" /> กลับไปใบสั่งซื้อ
        </Link>
        <PageHeader
          title={`ใบสั่งซื้อ ${order.po_no}`}
          subtitle={order.projects?.name || '-'}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {canEditStatus ? (
                <div className={`relative inline-flex items-center rounded-full ${STATUS_TONE[order.status]}`}>
                  <select
                    value={order.status}
                    onChange={(e) => handleStatusChange(e.target.value as 'draft' | 'sent')}
                    disabled={isPending}
                    className="appearance-none rounded-full bg-transparent px-3 py-1 pr-7 text-sm font-medium outline-none"
                  >
                    <option value="draft">{STATUS_LABEL.draft}</option>
                    <option value="sent">{STATUS_LABEL.sent}</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5" />
                </div>
              ) : (
                <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_TONE[order.status]}`}>{STATUS_LABEL[order.status]}</span>
              )}

              <PurchaseOrderDocActions orderId={order.id} poNo={order.po_no} />

              {canReceiveLineItems && (
                <Button type="button" variant="secondary" size="sm" onClick={() => router.push(`/dashboard/procurement/orders/${order.id}/receive`)}>
                  <PackageCheck className="h-3.5 w-3.5" /> รับของ (รายการ)
                </Button>
              )}
              {canMarkReceived && (
                <Button type="button" size="sm" onClick={handleMarkReceived} disabled={isPending}>
                  <PackageCheck className="h-3.5 w-3.5" /> ทำเครื่องหมายว่ารับของแล้ว
                </Button>
              )}
              {canUnmarkReceived && (
                <Button type="button" variant="secondary" size="sm" onClick={handleUnmarkReceived} disabled={isPending}>
                  <Undo2 className="h-3.5 w-3.5" /> ยกเลิกการรับของ
                </Button>
              )}
              {canUnmarkPaid && (
                <Button type="button" variant="secondary" size="sm" onClick={handleUnmarkPaid} disabled={isPending}>
                  <Undo2 className="h-3.5 w-3.5" /> ยกเลิกการชำระ
                </Button>
              )}
              {canCancel && (
                <Button type="button" variant="danger" size="sm" onClick={handleCancel} disabled={isPending}>
                  <XCircle className="h-3.5 w-3.5" /> ยกเลิก
                </Button>
              )}
            </div>
          }
        />

        {milestones.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {milestones.map((m) => (
              <span key={m.label} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
                <span className="font-medium text-slate-500">{m.label}</span> {m.value}
                {m.by ? ` โดย ${m.by}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>


      <PurchaseOrderForm mode="edit" orderId={id} initialOrder={order} readOnly={isFormReadOnly} />
    </div>
  )
}
