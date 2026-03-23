'use client'

import { useEffect, useState } from 'react'
import { X, FileText, Loader2, Trash2 } from 'lucide-react'
import dynamic from 'next/dynamic'
import { deleteBilling, getBillingById } from '@/actions/billing-actions'
import { getOrganizationSettings } from '@/actions/settings-actions'
import { BillingPdf } from '@/components/pdf/BillingPdf'
import { formatCurrency } from '@/lib/currency'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import NoticeBanner from '@/components/ui/NoticeBanner'

const PDFViewer = dynamic(
  () => import('@react-pdf/renderer').then((mod) => mod.PDFViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[400px] items-center justify-center text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Generating PDF...</span>
      </div>
    ),
  }
)

type BillingDetail = Awaited<ReturnType<typeof getBillingById>>
type BillingJobLine = NonNullable<NonNullable<BillingDetail>['billing_jobs']>[number]
type BillingAdjustmentLine = NonNullable<NonNullable<BillingDetail>['billing_adjustments']>[number]
type SettingsDetail = Awaited<ReturnType<typeof getOrganizationSettings>>

interface BillingModalProps {
  billingId: string | null
  onClose: () => void
  onDeleted?: () => void
  onStatus?: (payload: { tone: 'success' | 'error'; message: string }) => void
}

export default function BillingModal({ billingId, onClose, onDeleted, onStatus }: BillingModalProps) {
  const [billing, setBilling] = useState<BillingDetail>(null)
  const [settings, setSettings] = useState<SettingsDetail>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'details' | 'pdf'>('details')
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!billingId) {
      setBilling(null)
      setSettings(null)
      setLocalError(null)
      return
    }

    setLoading(true)
    setLocalError(null)
    Promise.all([getBillingById(billingId), getOrganizationSettings()])
      .then(([billingData, settingsData]) => {
        setBilling(billingData)
        setSettings(settingsData)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Failed to load billing'
        setLocalError(message)
      })
      .finally(() => setLoading(false))
  }, [billingId])

  const calculateDetails = (data: BillingDetail) => {
    if (!data) return { wht: 0, retention: 0, totalBase: 0 }
    const totalBase = (data.total_work_amount || 0) + (data.total_add_amount || 0)
    const wht = (totalBase * (data.wht_percent || 0)) / 100
    const retention = (totalBase * (data.retention_percent || 0)) / 100
    return { wht, retention, totalBase }
  }

  const { wht, retention, totalBase } = calculateDetails(billing)
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
      <div className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b bg-slate-50 p-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
              <FileText className="h-5 w-5 text-indigo-600" />
              รายละเอียดใบวางบิล #{billing?.doc_no ? String(billing.doc_no).padStart(4, '0') : '...'}
            </h2>
            <p className="text-xs text-slate-500">
              โครงการ: {billing?.projects?.name}
              {plotLabel ? ` • แปลง ${plotLabel}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isDeleting || !billing}
              className="rounded-full p-2 transition hover:bg-red-50 disabled:opacity-50"
              title="ลบประวัติ"
            >
              <Trash2 className="h-5 w-5 text-red-500" />
            </button>
            <button onClick={onClose} className="rounded-full p-2 transition hover:bg-slate-200">
              <X className="h-5 w-5 text-slate-500" />
            </button>
          </div>
        </div>

        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('details')}
            className={`flex-1 py-3 text-sm font-bold transition ${
              activeTab === 'details' ? 'border-b-2 border-indigo-600 bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            รายละเอียด
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-slate-100 p-6">
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

              {activeTab === 'details' && billing ? (
                <div className="mx-auto max-w-3xl space-y-6">
                  <div className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
                    <div className="flex justify-between">
                      <div>
                        <label className="text-xs text-slate-500">ผู้รับเหมา</label>
                        <div className="font-bold text-slate-800">{billing.contractors?.name}</div>
                        <div className="text-sm text-slate-500">{billing.contractors?.phone || '-'}</div>
                        <div className="mt-1 text-xs text-slate-500">แปลง: {plotLabel || '-'}</div>
                      </div>
                      <div className="text-right">
                        <label className="text-xs text-slate-500">วันที่เอกสาร</label>
                        <div className="font-bold text-slate-800">{new Date(billing.billing_date).toLocaleDateString('th-TH')}</div>
                        <div
                          className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                            billing.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100'
                          }`}
                        >
                          {billing.status}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b bg-slate-50 text-slate-600">
                        <tr>
                          <th className="p-3">รายการ</th>
                          <th className="p-3 text-right">จำนวนเงิน</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
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
                          return (
                            <tr
                              key={`adj-${adj.id}`}
                              className={adj.type === 'deduction' ? 'bg-red-50/30 text-red-600' : 'bg-blue-50/30 text-blue-600'}
                            >
                              <td className="p-3">
                                {adj.type === 'addition' ? '[+]' : '[-]'} {adj.description} ({adj.quantity} {adj.unit})
                              </td>
                              <td className="p-3 text-right">
                                {adj.type === 'deduction' ? '-' : ''}฿{formatCurrency(totalAmount)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot className="bg-slate-50 text-slate-700">
                        <tr>
                          <td className="p-3 text-right font-bold">รวมค่างาน (Subtotal)</td>
                          <td className="p-3 text-right font-bold">฿{formatCurrency(totalBase)}</td>
                        </tr>
                        {billing.total_deduct_amount > 0 ? (
                          <tr>
                            <td className="p-3 text-right text-red-600">รายการหัก (Deduction)</td>
                            <td className="p-3 text-right text-red-600">-฿{formatCurrency(billing.total_deduct_amount)}</td>
                          </tr>
                        ) : null}
                        {wht > 0 ? (
                          <tr>
                            <td className="p-3 text-right text-slate-500">หัก ณ ที่จ่าย ({billing.wht_percent}%)</td>
                            <td className="p-3 text-right text-slate-500">-฿{formatCurrency(wht)}</td>
                          </tr>
                        ) : null}
                        {retention > 0 ? (
                          <tr>
                            <td className="p-3 text-right text-slate-500">หักประกันผลงาน ({billing.retention_percent}%)</td>
                            <td className="p-3 text-right text-slate-500">-฿{formatCurrency(retention)}</td>
                          </tr>
                        ) : null}
                        <tr className="bg-emerald-50 text-emerald-700">
                          <td className="p-3 text-right text-lg font-bold">ยอดสุทธิ (Net Amount)</td>
                          <td className="p-3 text-right text-lg font-bold">฿{formatCurrency(billing.net_amount)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              ) : null}

              {activeTab === 'pdf' && billing ? (
                <div className="flex h-full w-full flex-col overflow-hidden rounded-lg bg-slate-500 shadow-inner">
                  <PDFViewer className="h-full w-full border-none">
                    <BillingPdf data={billing} settings={settings} />
                  </PDFViewer>
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
