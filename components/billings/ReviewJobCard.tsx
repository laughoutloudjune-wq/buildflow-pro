import { useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import type { ProgressHistoryItem } from '@/lib/types/billing'
import type { ReviewJobInsight } from '@/actions/billing/review-insights'
import { PROGRESS_CLAIM_TOLERANCE, type RecordedProgress } from '@/lib/billing'

const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '-')
const MARK = { y: '✓', n: '✗', '': '' } as const

/**
 * One job on a progress bill: a bar (paid grey, this claim purple, site check
 * green tick), four numbers, the approved % to edit, and the story behind the
 * numbers on tap. The money is exactly what the page computed before: this
 * card only shows it and calls the same % handler.
 */
export default function ReviewJobCard({
  name,
  plotName,
  totalBoq,
  paid,
  previousPercent,
  requestedPercent,
  requestedAmount,
  approvedPercent,
  approvedAmount,
  recorded,
  insight,
  history,
  editable,
  onChange,
  onRemove,
}: {
  name: string
  plotName: string
  totalBoq: number
  paid: number
  previousPercent: number
  requestedPercent: number | null
  requestedAmount: number | null
  approvedPercent: number
  approvedAmount: number
  recorded: RecordedProgress | undefined
  insight: ReviewJobInsight | undefined
  history: ProgressHistoryItem[]
  editable: boolean
  onChange: (pct: number) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const site = recorded ? recorded.pct : null
  const over = site != null && approvedPercent > site + PROGRESS_CLAIM_TOLERANCE
  const below = approvedPercent < previousPercent
  const changed = requestedPercent != null && Math.abs(approvedPercent - requestedPercent) > 0.004
  const latestWeekly = insight?.weekly[0]
  const siteSource = recorded ? `เช็คงาน${latestWeekly?.mark ? ` ${MARK[latestWeekly.mark]}` : ''} ${fmtDate(recorded.asOf)}` : 'ยังไม่มีเช็คงาน'
  // Offered only when the site check sits between what is already paid and what was claimed.
  const canUseSite = editable && site != null && requestedPercent != null && site < requestedPercent && site >= previousPercent && Math.abs(approvedPercent - site) > 0.004

  return (
    <div className={`border-b border-slate-100 py-4 last:border-0 ${changed ? 'bg-indigo-50/30' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-medium text-slate-900">{name}</span>
          <span className="ml-2 text-xs text-slate-500">แปลง {plotName || '-'}</span>
        </div>
        <span className="text-xs tabular-nums text-slate-500">มูลค่างาน ฿{formatCurrency(totalBoq)}</span>
      </div>

      <div className="my-2.5 flex items-center gap-3">
        <span className="relative block h-3 flex-1 rounded-full bg-slate-100" aria-hidden>
          <span className="absolute inset-y-0 left-0 rounded-full bg-slate-400" style={{ width: `${Math.min(100, previousPercent)}%` }} />
          <span
            className={`absolute inset-y-0 rounded-full opacity-85 ${over ? 'bg-amber-500' : 'bg-indigo-500'}`}
            style={{ left: `${Math.min(100, previousPercent)}%`, width: `${Math.max(0, Math.min(100, approvedPercent) - Math.min(100, previousPercent))}%` }}
          />
          {site != null && <span className="absolute -inset-y-1 w-[3px] rounded bg-emerald-600" style={{ left: `calc(${Math.min(100, site)}% - 1px)` }} title={`หน้างานทำได้ ${site}%`} />}
        </span>
        <span className="w-12 text-right text-sm font-semibold tabular-nums">{Math.round(approvedPercent * 100) / 100}%</span>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <dt className="text-xs text-slate-500">จ่ายแล้ว (งวดก่อน)</dt>
          <dd className="font-semibold tabular-nums">
            {Math.round(previousPercent * 100) / 100}% · ฿{formatCurrency(paid)}
          </dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <dt className="text-xs text-slate-500">ช่างขอ</dt>
          <dd className="font-semibold tabular-nums">
            {requestedPercent == null ? '-' : `${Math.round(requestedPercent * 100) / 100}% · ฿${formatCurrency(requestedAmount || 0)}`}
          </dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <dt className="text-xs text-slate-500">หน้างานทำได้</dt>
          <dd className={`font-semibold tabular-nums ${over ? 'text-amber-700' : site != null ? 'text-emerald-700' : 'text-slate-400'}`}>{site == null ? '—' : `${site}%`}</dd>
          <dd className="text-[11px] text-slate-500">{siteSource}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <dt className="text-xs text-slate-500">อนุมัติ</dt>
          <dd className="font-semibold tabular-nums text-emerald-700">฿{formatCurrency(approvedAmount)}</dd>
        </div>
      </dl>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          % อนุมัติ
          <input
            type="number"
            className="w-24 text-right"
            aria-label={`% อนุมัติ ${name}`}
            aria-invalid={below || undefined}
            value={approvedPercent || ''}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            min={previousPercent.toFixed(2)}
            max="100"
            step="0.01"
            disabled={!editable}
          />
        </label>
        {canUseSite && (
          <button type="button" onClick={() => onChange(site!)} className="rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
            ใช้ตามหน้างาน {site}%
          </button>
        )}
        {editable && changed && (
          <button type="button" onClick={() => onChange(requestedPercent!)} className="text-sm text-indigo-600 hover:underline">
            กลับเป็นที่ช่างขอ
          </button>
        )}
        {below && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
            <AlertTriangle className="h-3 w-3" aria-hidden /> ต้องไม่ต่ำกว่า {previousPercent.toFixed(2)}%
          </span>
        )}
        {over && (
          <span className="text-xs font-medium text-amber-700">
            สูงกว่าหน้างาน {Math.round((approvedPercent - (site as number)) * 100) / 100}% (ถ้าอนุมัติจะจ่ายเกินงาน ฿{formatCurrency((totalBoq * (approvedPercent - (site as number))) / 100)})
          </span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-sm text-indigo-600 hover:underline">
            {open ? 'ซ่อนที่มา' : 'ดูที่มา ›'}
          </button>
          {editable && (
            <button
              type="button"
              onClick={onRemove}
              title="ลบรายการนี้ออกจากใบเบิก (เช่น รายการซ้ำ)"
              aria-label="ลบรายการนี้ออกจากใบเบิก"
              className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </span>
      </div>

      {open && (
        <div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          <section>
            <h4 className="mb-1 font-semibold">งวดที่ผ่านมา</h4>
            {history.length === 0 ? (
              <p className="text-slate-500">ยังไม่เคยเบิก</p>
            ) : (
              <ul className="space-y-0.5">
                {history.map((h) => (
                  <li key={h.id}>
                    ใบเบิก #{String(h.doc_no || '-').padStart(4, '0')} · {fmtDate(h.billing_date || h.created_at)} · {h.progress_percent == null ? '-' : `${Number(h.progress_percent).toFixed(2)}%`} · ฿
                    {formatCurrency(h.amount || 0)} <span className="text-xs text-slate-500">({h.status || '-'})</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4 className="mb-1 font-semibold">เช็คงานรายสัปดาห์</h4>
            {!insight || insight.weekly.length === 0 ? (
              <p className="text-slate-500">งานนี้ยังไม่เคยอยู่ในแผนสัปดาห์</p>
            ) : (
              <ul className="space-y-0.5">
                {insight.weekly.map((w) => (
                  <li key={w.weekStart}>
                    สัปดาห์ {fmtDate(w.weekStart)} · รับปาก {w.target >= 100 ? 'เสร็จ' : `ถึง ${w.target}%`} ·{' '}
                    {w.mark === 'y' ? '✓ ทำได้' : w.mark === 'n' ? `✗ ไม่ได้${w.reason ? ` (${w.reason})` : ''}` : 'ยังไม่เช็ค'}
                    {w.pct != null && ` · ตอนนี้ ${w.pct}%`}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4 className="mb-1 font-semibold">วัสดุของงานนี้ (แปลง {plotName || '-'})</h4>
            {!insight || insight.materials.length === 0 ? (
              <p className="text-slate-500">งานนี้ยังไม่ได้ผูกวัสดุใน BOQ</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {insight.materials.map((m) => (
                    <tr key={m.name} className="border-t border-slate-200">
                      <td className="py-1 pr-2">{m.name}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">แผน {m.plan.toLocaleString('th-TH', { maximumFractionDigits: 1 })}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">
                        ใช้ {m.used.toLocaleString('th-TH', { maximumFractionDigits: 1 })} {m.unit}
                      </td>
                      <td className="py-1">
                        {m.state === 'over' ? (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">ใช้เกิน</span>
                        ) : m.state === 'ordered_over' ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">สั่งเกิน</span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">ปกติ</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
