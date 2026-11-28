'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { getJobProgressHistory } from '@/actions/billing-actions'
import { getContractors } from '@/actions/contractor-actions'
import { assignContractor, updateJobStatus } from '@/actions/job-actions'
import { getJobIssue, type JobIssue } from '@/actions/construction-hubs'
import type { ProgressHistoryItem } from '@/lib/types/billing'
import { BILL_STAGE_LABEL, MONEY, baht, fmtDateTime } from '@/components/construction/vocab'

const STATUS_LABEL: Record<string, string> = { pending: 'รอเริ่ม', in_progress: 'กำลังทำ', completed: 'เสร็จสิ้น' }

type Contractor = { id: string; name: string }

/**
 * The one thing that is wrong with one job, with the fix next to it. Opened from
 * a red "!" cell, a ต้องดู item or any grid cell, instead of the whole plot.
 *  - paid in full but not finished: the bills behind the payments + "ตั้งเป็นเสร็จสิ้น"
 *  - no crew: pick a crew and save
 *  - otherwise: the job's facts, bills and a status switch
 * Warnings only; nothing here blocks.
 */
export default function JobIssueModal({
  jobId,
  projectId,
  canEdit,
  onOpenBill,
  onOpenPlot,
  queue,
  onSwitch,
  onChanged,
  onClose,
}: {
  jobId: string
  projectId: string
  canEdit: boolean
  onOpenBill: (billId: string) => void
  onOpenPlot: (plotId: string, plotName: string) => void
  /** Other jobs with the same problem on this plot, to step through. */
  queue?: { jobId: string; name: string }[]
  onSwitch?: (jobId: string) => void
  onChanged: () => void
  onClose: () => void
}) {
  const toast = useToast()
  const [job, setJob] = useState<JobIssue | null | undefined>(undefined)
  const [bills, setBills] = useState<ProgressHistoryItem[] | null>(null)
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [crew, setCrew] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    getJobIssue(jobId)
      .then((j) => !cancelled && setJob(j))
      .catch(() => !cancelled && setJob(null))
    getJobProgressHistory([jobId])
      .then((r) => !cancelled && setBills(((r?.[jobId] || []) as ProgressHistoryItem[]).slice()))
      .catch(() => !cancelled && setBills([]))
    getContractors()
      .then((c) => !cancelled && setContractors((c as { id: string; name: string }[]).map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [jobId])

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(okMsg)
      onChanged()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const value = job?.value ?? 0
  const paid = job?.paid ?? 0
  const paidNotDone = !!job && value > 0 && paid >= value - 0.005 && job.status !== 'completed'
  const noCrew = !!job && !job.contractorId
  const title = job ? `${job.name} · แปลง ${job.plotName}` : 'งาน'

  return (
    <Modal isOpen onClose={onClose} title={title} panelClassName="w-full max-w-[min(1100px,96vw)]" bodyClassName="p-0">
      {job === undefined ? (
        <p className="p-6 text-sm text-slate-500">กำลังโหลด...</p>
      ) : job === null ? (
        <p className="p-6 text-sm text-slate-500">ไม่พบงานนี้</p>
      ) : (
        <div className="grid gap-0 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-3 p-4 md:border-r md:border-slate-100">
            {paidNotDone && (
              <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700">
                จ่ายครบแล้ว {baht(paid)} จาก {baht(value)} แต่สถานะยังเป็น &ldquo;{STATUS_LABEL[job.status] || job.status}&rdquo; ตรวจดูใบเบิกด้านล่าง ถ้างานเสร็จจริงให้กด &ldquo;ตั้งเป็นเสร็จสิ้น&rdquo;
              </p>
            )}
            {!paidNotDone && noCrew && <p className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-800">งานนี้ยังไม่มีช่าง เลือกช่างทางขวา</p>}
            <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
              {[
                [MONEY.contract, baht(value)],
                [MONEY.paid, baht(paid)],
                [MONEY.left, baht(Math.max(0, value - paid))],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="font-medium tabular-nums text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
            <div>
              <h4 className="mb-1.5 text-sm font-semibold text-slate-800">ใบเบิกของงานนี้</h4>
              {bills == null ? (
                <p className="text-xs text-slate-500">กำลังโหลด...</p>
              ) : bills.length === 0 ? (
                <p className="text-xs text-slate-500">ยังไม่มีใบเบิก</p>
              ) : (
                <table className="w-full table-fixed text-sm [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-slate-500 [&_td]:whitespace-nowrap">
                  <thead>
                    <tr>
                      <th className="w-[28%]">สร้างเมื่อ</th>
                      <th className="w-[13%]">เลขที่</th>
                      <th className="w-[12%] text-right">สะสม</th>
                      <th className="w-[23%] text-right">ยอด</th>
                      <th className="w-[24%] pl-4">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...bills].sort((a, b) => String(b.created_at || b.billing_date || '').localeCompare(String(a.created_at || a.billing_date || ''))).map((r) => (
                      <tr key={r.id} onClick={() => onOpenBill(String(r.id))} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                        <td>{fmtDateTime(r.created_at || r.billing_date)}</td>
                        <td className="font-medium text-indigo-700">#{String(r.doc_no ?? '').padStart(4, '0')}</td>
                        <td className="text-right tabular-nums">{r.progress_percent == null ? '—' : `${Math.round(r.progress_percent)}%`}</td>
                        <td className="text-right tabular-nums">{baht(r.amount)}</td>
                        <td className="pl-4">{r.status === 'approved' ? 'อนุมัติแล้ว' : r.status === 'pending_review' ? BILL_STAGE_LABEL.review : r.status === 'rejected' ? BILL_STAGE_LABEL.returned : r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-1 text-[11px] text-slate-500">กดที่แถวเพื่อเปิดใบเบิก</p>
            </div>
          </div>

          <div className="space-y-4 p-4">
            {!canEdit ? (
              <p className="text-sm text-slate-500">บทบาทของคุณดูได้อย่างเดียว</p>
            ) : (
              <>
                {noCrew && (
                  <section className="space-y-2">
                    <h4 className="text-sm font-semibold text-slate-800">ช่าง</h4>
                    <select value={crew} onChange={(e) => setCrew(e.target.value)} className="w-full" aria-label="ช่าง">
                      <option value="">— เลือกช่าง —</option>
                      {contractors.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" disabled={busy || !crew} onClick={() => run(() => assignContractor(job.jobId, crew, job.plotId, projectId), 'ใส่ช่างแล้ว')}>
                      บันทึกช่าง
                    </Button>
                    {queue && onSwitch && queue.filter((q) => q.jobId !== job.jobId).length > 0 && (
                      <div className="pt-1">
                        <p className="mb-1 text-[11px] text-slate-500">งานอื่นในแปลงนี้ที่ยังไม่มีช่าง</p>
                        <div className="flex flex-wrap gap-1">
                          {queue.filter((q) => q.jobId !== job.jobId).map((q) => (
                            <button key={q.jobId} type="button" onClick={() => onSwitch(q.jobId)} className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-indigo-700 hover:bg-indigo-50">
                              {q.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )}
                {!noCrew && (
                  <section className="space-y-2">
                    <h4 className="text-sm font-semibold text-slate-800">สถานะ</h4>
                    <p className="text-xs text-slate-500">ช่าง: {job.contractorName || '-'} · ตอนนี้ {STATUS_LABEL[job.status] || job.status}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {job.status !== 'completed' && (
                        <Button size="sm" disabled={busy} onClick={() => run(() => updateJobStatus(job.jobId, 'completed', job.plotId, projectId), 'ตั้งเป็นเสร็จสิ้นแล้ว')}>
                          ตั้งเป็นเสร็จสิ้น
                        </Button>
                      )}
                      {job.status !== 'in_progress' && (
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => updateJobStatus(job.jobId, 'in_progress', job.plotId, projectId), 'ตั้งเป็นกำลังทำแล้ว')}>
                          กำลังทำ
                        </Button>
                      )}
                    </div>
                  </section>
                )}
                <button type="button" onClick={() => onOpenPlot(job.plotId, job.plotName)} className="text-xs text-indigo-600 hover:underline">
                  เปิดหน้าแปลง {job.plotName} ›
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
