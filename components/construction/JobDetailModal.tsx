'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { getJobProgressHistory } from '@/actions/billing-actions'
import { assignContractor } from '@/actions/job-actions'
import { getSiblingJobsWithoutCrew, type SiblingJob } from '@/actions/construction-hubs'
import type { ProgressHistoryItem } from '@/lib/types/billing'
import type { PlotJobRow } from '@/lib/types/plotDetail'
import { BILL_STAGE_LABEL, MONEY, baht, fmtDateTime } from '@/components/construction/vocab'

const STATUS_LABEL: Record<string, string> = { pending: 'รอเริ่ม', in_progress: 'กำลังทำ', completed: 'เสร็จสิ้น' }

/**
 * One job, two panes. Left: what the job is worth, what has been paid and every
 * bill that touched it. Right: the things you can change (crew, agreed price,
 * status). Changing the crew can also fill the same job on the other plots of
 * the batch that still have none. Closing returns to the plot hub.
 */
export default function JobDetailModal({
  job,
  contractors,
  canEdit,
  plotId,
  projectId,
  onAssign,
  onStatus,
  onSavePrice,
  onClose,
}: {
  job: PlotJobRow | null
  contractors: { id: string; name: string }[]
  canEdit: boolean
  plotId: string
  projectId: string
  onAssign: (jobId: string, contractorId: string) => void
  onStatus: (jobId: string, status: string) => void
  onSavePrice: (jobId: string, price: number | null) => void
  onClose: () => void
}) {
  const toast = useToast()
  const [history, setHistory] = useState<{ jobId: string; rows: ProgressHistoryItem[] } | null>(null)
  const [siblings, setSiblings] = useState<{ jobId: string; rows: SiblingJob[] } | null>(null)
  const [crew, setCrew] = useState('')
  const [applyToBatch, setApplyToBatch] = useState(false)
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)

  const jobId = job?.id
  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    getJobProgressHistory([jobId])
      .then((r) => !cancelled && setHistory({ jobId, rows: (r?.[jobId] || []) as ProgressHistoryItem[] }))
      .catch(() => !cancelled && setHistory({ jobId, rows: [] }))
    return () => {
      cancelled = true
    }
  }, [jobId])

  const itemName = job?.itemName
  useEffect(() => {
    if (!jobId || !itemName || !canEdit) return
    let cancelled = false
    getSiblingJobsWithoutCrew(plotId, itemName)
      .then((rows) => !cancelled && setSiblings({ jobId, rows }))
      .catch(() => !cancelled && setSiblings({ jobId, rows: [] }))
    return () => {
      cancelled = true
    }
  }, [jobId, itemName, plotId, canEdit])

  // Fresh form values each time a different job opens (adjusted during render).
  const [shownJobId, setShownJobId] = useState<string | null>(null)
  if ((jobId ?? null) !== shownJobId) {
    setShownJobId(jobId ?? null)
    setCrew(job?.contractorId || '')
    setPrice(job?.cost?.agreedPricePerUnit == null ? '' : String(job.cost.agreedPricePerUnit))
    setApplyToBatch(false)
  }

  if (!job) return null
  const cost = job.cost
  const value = cost?.totalBoq ?? 0
  const paid = cost?.paid ?? 0
  const rows = history?.jobId === job.id ? history.rows : null
  const sib = siblings?.jobId === job.id ? siblings.rows : []
  const crewChanged = crew !== (job.contractorId || '')

  const saveCrew = async () => {
    setBusy(true)
    try {
      onAssign(job.id, crew)
      if (applyToBatch && crew && sib.length > 0) {
        for (const s of sib) await assignContractor(s.jobId, crew, s.plotId, projectId)
        toast.success(`ใส่ช่างให้ ${sib.length} แปลงในกลุ่มแล้ว`)
        setSiblings({ jobId: job.id, rows: [] })
        setApplyToBatch(false)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const savePrice = () => {
    const raw = price.trim()
    const next = raw === '' ? null : Number(raw)
    if (next != null && (!Number.isFinite(next) || next < 0)) {
      toast.error('กรุณาใส่ราคาต่อหน่วยที่ถูกต้อง')
      return
    }
    onSavePrice(job.id, next)
  }

  return (
    <Modal isOpen onClose={onClose} title={job.itemName} panelClassName="w-full max-w-4xl" bodyClassName="p-0">
      <div className="grid gap-0 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-4 p-4 md:border-r md:border-slate-100">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {[
              ['หมวดช่าง', job.tradeName || '-'],
              ['ปริมาณ', `${job.quantity} ${job.unit}`],
              [MONEY.contract, baht(value)],
              [MONEY.paid, baht(paid)],
              [MONEY.left, baht(Math.max(0, value - paid))],
              ['ความคืบหน้า', job.progressPercent == null ? '—' : `${Math.round(job.progressPercent)}%`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="font-medium tabular-nums text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>
          {value > 0 && paid >= value - 0.005 && job.status !== 'completed' && (
            <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700">จ่ายครบ {baht(paid)} จาก {baht(value)} แล้ว แต่สถานะยังเป็น &ldquo;{STATUS_LABEL[job.status] || job.status}&rdquo; ตรวจแล้วตั้งเป็นเสร็จสิ้นได้ทางขวา</p>
          )}
          <div>
            <h4 className="mb-1.5 text-sm font-semibold text-slate-800">ใบเบิกของงานนี้</h4>
            {rows == null ? (
              <p className="text-xs text-slate-500">กำลังโหลด...</p>
            ) : rows.length === 0 ? (
              <p className="text-xs text-slate-500">ยังไม่มีใบเบิก</p>
            ) : (
              <table className="w-full table-fixed text-xs [&_td]:py-1 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_th]:text-slate-500">
                <thead>
                  <tr>
                    <th className="w-[30%]">สร้างเมื่อ</th>
                    <th className="w-[18%]">เลขที่</th>
                    <th className="w-[14%] text-right">สะสม</th>
                    <th className="w-[22%] text-right">ยอด</th>
                    <th className="w-[16%]">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].sort((a, b) => String(b.created_at || b.billing_date || '').localeCompare(String(a.created_at || a.billing_date || ''))).map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td>{fmtDateTime(r.created_at || r.billing_date)}</td>
                      <td>#{String(r.doc_no ?? '').padStart(4, '0')}</td>
                      <td className="text-right tabular-nums">{r.progress_percent == null ? '—' : `${Math.round(r.progress_percent)}%`}</td>
                      <td className="text-right tabular-nums">{baht(r.amount)}</td>
                      <td>{r.status === 'approved' ? 'อนุมัติแล้ว' : r.status === 'pending_review' ? BILL_STAGE_LABEL.review : r.status === 'rejected' ? BILL_STAGE_LABEL.returned : r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="space-y-5 p-4">
          {!canEdit ? (
            <p className="text-sm text-slate-500">บทบาทของคุณดูได้อย่างเดียว</p>
          ) : (
            <>
              <section className="space-y-2">
                <h4 className="text-sm font-semibold text-slate-800">ช่าง</h4>
                <select value={crew} onChange={(e) => setCrew(e.target.value)} className="w-full" aria-label="ช่าง">
                  <option value="">— ยังไม่มีช่าง —</option>
                  {contractors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {crewChanged && job.contractorId && job.status !== 'pending' && <p className="text-[11px] text-amber-700">เปลี่ยนช่างแล้วสถานะจะกลับเป็นรอเริ่ม</p>}
                {sib.length > 0 && (
                  <label className="flex items-start gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={applyToBatch} onChange={(e) => setApplyToBatch(e.target.checked)} className="mt-0.5 h-4 w-4" />
                    <span>ใส่ช่างคนนี้ให้งานเดียวกันในแปลงอื่นของกลุ่มที่ยังไม่มีช่างด้วย ({sib.length} แปลง: {sib.map((s) => s.plotName).join(', ')})</span>
                  </label>
                )}
                <Button size="sm" onClick={saveCrew} disabled={busy || (!crewChanged && !(applyToBatch && sib.length > 0))}>
                  บันทึกช่าง
                </Button>
              </section>

              <section className="space-y-2">
                <h4 className="text-sm font-semibold text-slate-800">ราคาตกลงต่อหน่วย</h4>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={String(cost?.boqPricePerUnit ?? 0)} className="w-32" aria-label="ราคาตกลงต่อหน่วย" />
                  <span className="text-xs text-slate-500">ราคา BOQ {baht(cost?.boqPricePerUnit ?? 0)} / {job.unit}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={savePrice}>บันทึกราคา</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setPrice(''); onSavePrice(job.id, null) }}>ใช้ราคา BOQ</Button>
                </div>
              </section>

              <section className="space-y-2">
                <h4 className="text-sm font-semibold text-slate-800">สถานะ</h4>
                <div className="flex flex-wrap gap-1.5">
                  {(['pending', 'in_progress', 'completed'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      aria-pressed={job.status === st}
                      disabled={!job.contractorId}
                      onClick={() => onStatus(job.id, st)}
                      className={`rounded-full border px-3 py-1 text-xs disabled:opacity-50 ${job.status === st ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      {STATUS_LABEL[st]}
                    </button>
                  ))}
                </div>
                {!job.contractorId && <p className="text-[11px] text-slate-500">ใส่ช่างก่อนจึงจะเปลี่ยนสถานะได้</p>}
              </section>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
