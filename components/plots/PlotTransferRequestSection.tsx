'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import ReasonDialog from '@/components/ui/ReasonDialog'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import { TR_STATUS_LABEL, TR_STATUS_TONE } from '@/lib/sales/transferRequestLabels'
import {
  createTransferRequest,
  getTransferRequestForSale,
  setTransferRequestStatus,
  updateTransferRequest,
  type TransferRequestRow,
  type TransferRequestStatus,
} from '@/actions/transfer-requests'
import { clearCommission, getPlotCommission, setCommission, type PlotCommission } from '@/actions/commission-actions'

const SOURCE_LABEL = { plot: 'ตั้งเฉพาะแปลงนี้', project: 'ค่าเริ่มต้นของโครงการ', none: 'ยังไม่ได้ตั้งค่า' } as const

/** TR (ใบขอโอน) for the deal on this plot, plus the plot's commission
 * override. Loads its own data so the plot-detail bundle stays untouched. */
export default function PlotTransferRequestSection({
  plotId,
  plotSaleId,
  canEdit,
}: {
  plotId: string
  plotSaleId: string
  canEdit: boolean
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [loaded, setLoaded] = useState(false)
  const [tr, setTr] = useState<TransferRequestRow | null>(null)
  const [canApprove, setCanApprove] = useState(false)
  const [commission, setCommissionState] = useState<PlotCommission | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [overrideDraft, setOverrideDraft] = useState('')

  const load = useCallback(async () => {
    const [trRes, commRes] = await Promise.all([getTransferRequestForSale(plotSaleId), getPlotCommission(plotId)])
    setTr(trRes.request)
    setCanApprove(trRes.canApprove)
    setCommissionState(commRes)
    setOverrideDraft(commRes.plotOverride !== null ? String(commRes.plotOverride) : '')
    setLoaded(true)
  }, [plotId, plotSaleId])

  useEffect(() => {
    // Initial fetch on mount; setState happens after the awaited server actions resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  function run(fn: () => Promise<{ ok: true } | { error: string }>, okMessage: string) {
    startTransition(async () => {
      const res = await fn()
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      toast.success(okMessage)
      await load()
    })
  }

  function handleCreate() {
    run(() => createTransferRequest(plotSaleId), 'สร้างใบขอโอนแล้ว')
  }

  function handleSaveDraft(formData: FormData) {
    if (!tr) return
    run(
      () =>
        updateTransferRequest(tr.id, {
          price: Number(formData.get('price') || 0),
          discount: Number(formData.get('discount') || 0),
          promotionTotal: Number(formData.get('promotion_total') || 0),
          commissionAmount: Number(formData.get('commission_amount') || 0),
          notes: String(formData.get('notes') || ''),
        }),
      'บันทึกใบขอโอนแล้ว'
    )
  }

  function handleRefreshFromDeal() {
    if (!tr) return
    run(() => updateTransferRequest(tr.id, { refresh: true }), 'ดึงข้อมูลล่าสุดจากดีลแล้ว')
  }

  function handleStatus(status: TransferRequestStatus, okMessage: string, reason?: string) {
    if (!tr) return
    run(() => setTransferRequestStatus(tr.id, status, reason), okMessage)
  }

  function handleSaveOverride() {
    const amount = Number(overrideDraft)
    if (overrideDraft.trim() === '' || !Number.isFinite(amount) || amount < 0) {
      toast.error('กรุณาใส่จำนวนเงินค่าคอมมิชชันให้ถูกต้อง')
      return
    }
    run(() => setCommission({ plotId, amount }), 'บันทึกค่าคอมมิชชันของแปลงแล้ว')
  }

  function handleClearOverride() {
    run(() => clearCommission({ plotId }), 'ล้างค่าคอมมิชชันเฉพาะแปลงแล้ว ใช้ค่าของโครงการแทน')
  }

  if (!loaded) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดใบขอโอน...
        </div>
      </Card>
    )
  }

  const draftEditable = tr?.status === 'draft' && canEdit

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <FileText className="h-4 w-4 text-slate-400" /> ใบขอโอน (TR)
        </h3>
        {tr && <Badge tone={TR_STATUS_TONE[tr.status]}>{TR_STATUS_LABEL[tr.status]}</Badge>}
      </div>

      {commission && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-slate-500">ค่าคอมมิชชัน (จำนวนคงที่)</span>
            <span className="font-semibold text-slate-800">{formatCurrency(commission.effective)}</span>
            <span className="text-xs text-slate-400">{SOURCE_LABEL[commission.source]}</span>
          </div>
          {commission.canManage && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">ค่าคอมมิชชันเฉพาะแปลงนี้ (บาท)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={overrideDraft}
                  onChange={(e) => setOverrideDraft(e.target.value)}
                  placeholder={commission.projectDefault !== null ? String(commission.projectDefault) : '0'}
                  className="w-40"
                />
              </div>
              <Button type="button" size="sm" onClick={handleSaveOverride} disabled={isPending}>บันทึก</Button>
              {commission.plotOverride !== null && (
                <Button type="button" size="sm" variant="secondary" onClick={handleClearOverride} disabled={isPending}>
                  ใช้ค่าของโครงการ
                </Button>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-slate-400">ใบขอโอนที่สร้างแล้วจะเก็บยอดค่าคอมมิชชัน ณ วันที่สร้างไว้ ไม่เปลี่ยนตามค่าที่แก้ภายหลัง</p>
        </div>
      )}

      {!tr ? (
        <div className="mt-4">
          <p className="mb-3 text-sm text-slate-500">ดีลนี้ยังไม่มีใบขอโอน</p>
          {canEdit && (
            <Button type="button" onClick={handleCreate} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              สร้างใบขอโอน
            </Button>
          )}
        </div>
      ) : (
        <form action={handleSaveDraft} className="mt-4 space-y-3">
          <div className="text-xs text-slate-400">
            {tr.requestNo}
            {tr.requestedByName && ` · สร้างโดย ${tr.requestedByName}`}
            {tr.approvedByName && tr.approvedAt && ` · ${tr.status === 'rejected' ? 'ไม่อนุมัติ' : 'อนุมัติ'}โดย ${tr.approvedByName}`}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['price', 'ราคา', tr.price],
                ['discount', 'ส่วนลด', tr.discount],
                ['promotion_total', 'มูลค่าโปรโมชั่น', tr.promotionTotal],
                ['commission_amount', 'ค่าคอมมิชชัน', tr.commissionAmount],
              ] as const
            ).map(([name, label, value]) => (
              <div key={`${name}-${value}`}>
                <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  name={name}
                  defaultValue={value}
                  disabled={!draftEditable}
                  className="w-full"
                />
              </div>
            ))}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">หมายเหตุ</label>
            <textarea name="notes" rows={2} defaultValue={tr.notes ?? ''} disabled={!draftEditable} className="w-full" />
          </div>
          {tr.status === 'rejected' && tr.rejectReason && (
            <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">เหตุผลที่ไม่อนุมัติ: {tr.rejectReason}</p>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
            {draftEditable && (
              <>
                <Button type="button" variant="secondary" onClick={handleRefreshFromDeal} disabled={isPending}>
                  ดึงข้อมูลล่าสุดจากดีล
                </Button>
                <Button type="submit" variant="secondary" disabled={isPending}>บันทึกร่าง</Button>
                <Button
                  type="button"
                  onClick={() => handleStatus('submitted', 'ส่งใบขอโอนให้หัวหน้าฝ่ายขายอนุมัติแล้ว')}
                  disabled={isPending}
                >
                  ส่งขออนุมัติ
                </Button>
              </>
            )}
            {tr.status === 'submitted' && canApprove && (
              <>
                <Button type="button" variant="secondary" onClick={() => setRejectOpen(true)} disabled={isPending}>
                  ไม่อนุมัติ
                </Button>
                <Button type="button" onClick={() => handleStatus('approved', 'อนุมัติใบขอโอนแล้ว')} disabled={isPending}>
                  อนุมัติ
                </Button>
              </>
            )}
            {tr.status === 'approved' && canEdit && (
              <Button type="button" onClick={() => handleStatus('done', 'บันทึกว่าโอนเสร็จสิ้นแล้ว')} disabled={isPending}>
                โอนเสร็จสิ้น
              </Button>
            )}
            {tr.status === 'rejected' && canEdit && (
              <Button type="button" onClick={() => handleStatus('draft', 'เปิดใบขอโอนกลับมาแก้ไขแล้ว')} disabled={isPending}>
                แก้ไขและส่งใหม่
              </Button>
            )}
          </div>
        </form>
      )}

      <ReasonDialog
        isOpen={rejectOpen}
        title="ไม่อนุมัติใบขอโอน"
        label="เหตุผลที่ไม่อนุมัติ"
        required
        confirmLabel="ไม่อนุมัติ"
        busy={isPending}
        onCancel={() => setRejectOpen(false)}
        onConfirm={(reason) => {
          setRejectOpen(false)
          handleStatus('rejected', 'บันทึกการไม่อนุมัติแล้ว', reason)
        }}
      />
    </Card>
  )
}
