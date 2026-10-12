'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { getJobMaterialDetail, type JobMaterialDetailRow, type WeeklyPlanItem } from '@/actions/weekly-plan-actions'

const qty = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 })
const KIND_LABEL = { po: 'ใบสั่งซื้อ', pr: 'ใบขอซื้อ', stock_out: 'เบิกจากสโตร์' } as const

/** Material-by-material view of a BOQ task: BOQ vs ordered vs issued, with the documents behind any over-BOQ material. */
export default function JobMaterialDetailModal({ item, onClose }: { item: WeeklyPlanItem; onClose: () => void }) {
  const [state, setState] = useState<{ rows: JobMaterialDetailRow[] } | { error: string } | null>(null)

  useEffect(() => {
    let live = true
    getJobMaterialDetail(item.plotId as string, item.projectId, item.jobBoqItemId as string).then((r) => {
      if (live) setState(r)
    })
    return () => {
      live = false
    }
  }, [item])

  return (
    <Modal isOpen onClose={onClose} title={`วัสดุ: ${item.title}${item.plotName ? ` · แปลง ${item.plotName}` : ''}`} panelClassName="max-w-3xl">
      {!state ? (
        <p className="text-sm text-slate-500">กำลังโหลด...</p>
      ) : 'error' in state ? (
        <p className="text-sm text-red-700">{state.error}</p>
      ) : state.rows.length === 0 ? (
        <p className="text-sm text-slate-500">งานนี้ไม่มีวัสดุใน BOQ</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            เทียบกับ BOQ ของแบบบ้านทั้งหลัง (รวมส่วนเผื่อเสียหาย) · ยอดสั่ง/เบิกนับทั้งแปลง ไม่แยกตามงาน
          </p>
          {state.rows.map((r) => {
            const over = r.overOrdered || r.overUsed
            const cells: [string, number][] = [
              ['BOQ งานนี้', r.jobQty],
              ['BOQ ทั้งหลัง (+เผื่อ)', r.boqQty + r.allowanceQty],
              ['สั่งซื้อแล้ว', r.orderedQty],
              ['เบิกใช้แล้ว', r.issuedQty],
            ]
            return (
              <div key={r.materialTypeId} className={`rounded-xl border p-3 ${over ? 'border-red-200 bg-red-50/40' : 'border-slate-200'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">{r.name}</p>
                  <div className="flex gap-1.5">
                    {r.overOrdered && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">สั่งเกิน BOQ</span>}
                    {r.overUsed && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">เบิกเกิน BOQ</span>}
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  {cells.map(([label, v]) => (
                    <div key={label} className="rounded-md bg-white px-2 py-1 ring-1 ring-inset ring-slate-100">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className="font-semibold tabular-nums text-slate-800">
                        {qty(v)} <span className="font-normal text-slate-500">{r.unit}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
                {over && r.docs.length > 0 && (
                  <table className="mt-2 w-full text-left text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="py-1 font-medium">เอกสาร</th>
                        <th className="py-1 font-medium">วันที่</th>
                        <th className="py-1 font-medium">แปลง</th>
                        <th className="py-1 text-right font-medium">จำนวน</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.docs.map((d, i) => (
                        <tr key={i} className="border-t border-slate-100 text-slate-700">
                          <td className="py-1">
                            {KIND_LABEL[d.kind]} {d.docNo || ''}
                            {d.supplier ? <span className="text-slate-500"> · {d.supplier}</span> : null}
                          </td>
                          <td className="py-1">{d.docDate || '-'}</td>
                          <td className="py-1">{d.plotLabel}</td>
                          <td className="py-1 text-right tabular-nums">{qty(d.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
