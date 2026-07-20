'use client'

import { useEffect, useState } from 'react'
import { X, FileText, Loader2, Trash2, Plus, Minus } from 'lucide-react'
import { deleteBilling, getBillingById } from '@/actions/billing-actions'
import { formatCurrency } from '@/lib/currency'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import NoticeBanner from '@/components/ui/NoticeBanner'
import { Badge, statusTone } from '@/components/ui/Badge'

type BillingDetail = Awaited<ReturnType<typeof getBillingById>>
type BillingJobLine = NonNullable<NonNullable<BillingDetail>['billing_jobs']>[number]
type BillingAdjustmentLine = NonNullable<NonNullable<BillingDetail>['billing_adjustments']>[number]

interface BillingModalProps {
  billingId: string | null
  onClose: () => void
  onDeleted?: () => void
  onStatus?: (payload: { tone: 'success' | 'error'; message: string }) => void
}

export default function BillingModal({ billingId, onClose, onDeleted, onStatus }: BillingModalProps) {
  const [billing, setBilling] = useState<BillingDetail>(null)
  const [loading, setLoading] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!billingId) {
      setBilling(null)
      setLocalError(null)
      return
    }

    setLoading(true)
    setLocalError(null)
    getBillingById(billingId)
      .then((billingData) => {
        setBilling(billingData)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Failed to load billing'
        setLocalError(message)
      })
      .finally(() => setLoading(false))
  }, [billingId])

  const plotLabel =
    billing?.plots?.name ||
    (billing?.billing_jobs || [])
      .map((j: BillingJobLine) => j.job_assignments?.plots?.name)
      .filter(Boolean)
      .join(', ')

  const handleDelete = async () => {
    if (!billingId || isDeleting) return
    setIsDeleting(true)
    setLocalError(null)
    try {
      await deleteBilling(billingId)
      onClose()
      onDeleted?.()
      onStatus?.({ tone: 'success', message: 'ลบใบเบิกเรียบร้อยแล้ว' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ลบรายการไม่สำเร็จ'
      setLocalError(message)
      onStatus?.({ tone: 'error', message })
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  if (!billingId) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm transition-opacity ${
        billingId ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      <div className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_32px_64px_-24px_rgba(0,0,0,0.25)]">
        <div className="flex items-center justify-between border-b border-slate-200/70 bg-white/80 p-5 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-indigo-50">
              <FileText className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight text-slate-900">
                รายละเอียดใบวางบิล #{billing?.doc_no ? String(billing.doc_no).padStart(4, '0') : '...'}
              </h2>
              <p className="text-xs text-slate-500">
                โครงการ: {billing?.projects?.name}
                {plotLabel ? ` • แปลง ${plotLabel}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isDeleting || !billing}
              className="rounded-full p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
              title="ลบประวัติ"
            >
              <Trash2 className="h-[18px] w-[18px]" />
            </button>
            <button onClick={onClose} className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-900/5 hover:text-slate-700">
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-[#f5f5f7] p-6">
          {loading ? (
            <div className="flex h-full items-center justify-center text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
              {localError ? (
                <div className="mx-auto mb-4 max-w-3xl">
                  <NoticeBanner tone="error" message={localError} onClose={() => setLocalError(null)} />
                </div>
              ) : null}

              {billing ? (
                <div className="mx-auto max-w-3xl space-y-4">
                  <div className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)]">
                    <div className="flex justify-between">
                      <div>
                        <label className="text-xs font-medium text-slate-500">ผู้รับเหมา</label>
                        <div className="text-[15px] font-semibold text-slate-900">{billing.contractors?.name}</div>
                        <div className="text-sm text-slate-500">{billing.contractors?.phone || '-'}</div>
                        <div className="mt-1 text-xs text-slate-500">แปลง: {plotLabel || '-'}</div>
                      </div>
                      <div className="text-right">
                        <label className="text-xs font-medium text-slate-500">วันที่เอกสาร</label>
                        <div className="text-[15px] font-semibold text-slate-900">{new Date(billing.billing_date).toLocaleDateString('th-TH')}</div>
                        <Badge tone={statusTone(billing.status || '')} className="mt-1">
                          {billing.status}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)]">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-100 bg-slate-50/80 text-slate-500">
                        <tr>
                          <th className="p-3 font-medium">รายการ</th>
                          <th className="p-3 text-right font-medium">จำนวนเงิน</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {billing.billing_jobs?.map((job: BillingJobLine) => (
                          <tr key={`job-${job.id}`}>
                            <td className="p-3">
                              <div className="font-medium text-slate-700">{job.job_assignments?.boq_master?.item_name}</div>
                              <div className="text-xs text-slate-400">แปลง {job.job_assignments?.plots?.name}</div>
                            </td>
                            <td className="p-3 text-right">฿{formatCurrency(job.amount)}</td>
                          </tr>
                        ))}

                        {billing.billing_adjustments?.map((adj: BillingAdjustmentLine) => {
                          const totalAmount = (adj.quantity || 0) * (adj.unit_price || 0)
                          const isAddition = adj.type === 'addition'
                          return (
                            <tr key={`adj-${adj.id}`} className={isAddition ? 'bg-emerald-50/40' : 'bg-red-50/40'}>
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                                      isAddition ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'
                                    }`}
                                  >
                                    {isAddition ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                                  </span>
                                  <span className={isAddition ? 'text-emerald-700' : 'text-red-700'}>
                                    {adj.description} <span className="text-slate-400">({adj.quantity} {adj.unit})</span>
                                  </span>
                                </div>
                              </td>
                              <td className={`p-3 text-right font-medium ${isAddition ? 'text-emerald-700' : 'text-red-700'}`}>
                                {isAddition ? '' : '-'}฿{formatCurrency(totalAmount)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot className="border-t border-slate-100 bg-emerald-50/80 text-emerald-700">
                        <tr>
                          <td className="p-3 text-right text-base font-bold">ยอดสุทธิ (Net Amount)</td>
                          <td className="p-3 text-right text-base font-bold">฿{formatCurrency(billing.net_amount)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="ลบใบเบิก"
        message="ต้องการลบใบเบิกนี้ใช่หรือไม่? การลบจะกระทบกับประวัติเอกสารนี้"
        confirmLabel={isDeleting ? 'กำลังลบ...' : 'ลบใบเบิก'}
        cancelLabel="ยกเลิก"
        busy={isDeleting}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
