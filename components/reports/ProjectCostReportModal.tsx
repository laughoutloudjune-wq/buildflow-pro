'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import { getMaterialsSummaryForProject } from '@/actions/procurement-actions'
import { getLaborLedger } from '@/actions/labor-budget-actions'
import type { MaterialsSummaryRow } from '@/actions/procurement/materials-summary'
import type { LaborLedgerEntry } from '@/lib/labor-budget'

const PO_STATUS_LABEL: Record<string, string> = {
  draft: 'ร่าง',
  sent: 'ยืนยันสั่งซื้อ',
  partially_received: 'รับของบางส่วน',
  received: 'รับของแล้ว',
  paid: 'ชำระแล้ว',
}

type Tab = 'materials' | 'labor'

type Props = {
  isOpen: boolean
  onClose: () => void
  projectId: string
  /** Shown in the modal title, e.g. "กลุ่มแปลง 98-102" or "ทั้งโครงการ". */
  scopeLabel: string
  plotGroupId?: string
  plotIds?: string[]
}

/** Combines the two cost sources that already exist per-project - purchase
 * order materials and the contractor labor ledger - into one view, so a
 * project or plot group's total cost so far doesn't require opening two
 * separate reports and adding them up by hand. Other costs (misc expenses,
 * machinery) aren't tracked anywhere in the app yet, so they're not part of
 * this total. */
export default function ProjectCostReportModal({ isOpen, onClose, projectId, scopeLabel, plotGroupId, plotIds }: Props) {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('materials')
  const [materialsRows, setMaterialsRows] = useState<MaterialsSummaryRow[]>([])
  const [laborEntries, setLaborEntries] = useState<LaborLedgerEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!isOpen) return
    setIsLoading(true)
    Promise.all([
      getMaterialsSummaryForProject(projectId, { plotGroupId, plotIds }),
      getLaborLedger({ projectId, plotGroupId }),
    ])
      .then(([materials, labor]) => {
        setMaterialsRows(materials)
        setLaborEntries(labor.entries)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'โหลดรายงานต้นทุนไม่สำเร็จ'))
      .finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, projectId, plotGroupId, (plotIds || []).join(',')])

  const materialsTotal = materialsRows.reduce((sum, r) => sum + r.received_value, 0)
  const laborTotal = laborEntries.reduce((sum, e) => sum + e.approved, 0)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`รายงานต้นทุน - ${scopeLabel}`} panelClassName="max-w-4xl">
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-xs text-slate-500">วัสดุที่รับแล้ว</div>
              <div className="text-lg font-bold text-slate-800">฿{formatCurrency(materialsTotal)}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-xs text-slate-500">ค่าแรงที่อนุมัติแล้ว</div>
              <div className="text-lg font-bold text-slate-800">฿{formatCurrency(laborTotal)}</div>
            </div>
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
              <div className="text-xs text-indigo-600">รวมต้นทุนที่เกิดขึ้นแล้ว</div>
              <div className="text-lg font-bold text-indigo-700">฿{formatCurrency(materialsTotal + laborTotal)}</div>
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            ยังไม่รวมค่าใช้จ่ายอื่น (เช่น ค่าเช่ารถเครน ค่าขนส่ง) และค่าเครื่องจักร เนื่องจากระบบยังไม่มีการบันทึกส่วนนี้
          </p>

          <div className="flex gap-2 border-b border-slate-200">
            {(['materials', 'labor'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                  tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t === 'materials' ? `วัสดุ (${materialsRows.length})` : `ค่าแรง (${laborEntries.length})`}
              </button>
            ))}
          </div>

          {tab === 'materials' ? (
            materialsRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-10 text-center text-sm text-slate-400">
                ยังไม่มีใบสั่งซื้อที่เกี่ยวข้องกับขอบเขตนี้
              </div>
            ) : (
              <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-3 py-2">วัสดุ</th>
                      <th className="px-3 py-2 text-right">สั่งซื้อรวม</th>
                      <th className="px-3 py-2 text-right">รับแล้ว</th>
                      <th className="px-3 py-2 text-right">มูลค่าที่รับแล้ว</th>
                      <th className="px-3 py-2">ใบสั่งซื้อที่เกี่ยวข้อง</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {materialsRows.map((row) => (
                      <tr key={row.material_type_id} className="align-top">
                        <td className="px-3 py-2.5 font-medium text-slate-800">{row.name}</td>
                        <td className="px-3 py-2.5 text-right text-slate-700">
                          {row.quantity_ordered.toLocaleString('th-TH')} {row.unit}
                        </td>
                        <td className="px-3 py-2.5 text-right text-emerald-700">
                          {row.quantity_received.toLocaleString('th-TH')} {row.unit}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium text-slate-800">฿{formatCurrency(row.received_value)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {row.orders.map((o) => (
                              <Link
                                key={o.id}
                                href={`/dashboard/procurement/orders/${o.id}`}
                                title={PO_STATUS_LABEL[o.status] || o.status}
                                className="rounded-full bg-indigo-50 px-2 py-0.5 font-mono text-xs text-indigo-700 hover:bg-indigo-100"
                              >
                                {o.po_no}
                              </Link>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t bg-slate-50">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-right font-semibold text-slate-700">รวม</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">฿{formatCurrency(materialsTotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          ) : laborEntries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-10 text-center text-sm text-slate-400">
              ยังไม่มีงานผู้รับเหมาที่เกี่ยวข้องกับขอบเขตนี้
            </div>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-3 py-2">ผู้รับเหมา</th>
                    <th className="px-3 py-2">รายการงาน / แปลง</th>
                    <th className="px-3 py-2 text-right">งบประมาณ</th>
                    <th className="px-3 py-2 text-right">อนุมัติแล้ว</th>
                    <th className="px-3 py-2 text-right">ค้างอนุมัติ</th>
                    <th className="px-3 py-2 text-right">คงเหลือ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {laborEntries.map((entry) => (
                    <tr key={entry.jobId} className="align-top">
                      <td className="px-3 py-2.5 text-slate-700">{entry.contractorName}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-slate-800">{entry.itemName}</div>
                        <div className="text-xs text-slate-400">แปลง {entry.plotName}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-700">฿{formatCurrency(entry.budget)}</td>
                      <td className="px-3 py-2.5 text-right text-emerald-700">฿{formatCurrency(entry.approved)}</td>
                      <td className="px-3 py-2.5 text-right text-amber-700">{entry.pending > 0 ? `฿${formatCurrency(entry.pending)}` : '-'}</td>
                      <td className={`px-3 py-2.5 text-right font-medium ${entry.remaining < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                        ฿{formatCurrency(entry.remaining)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-slate-50">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right font-semibold text-slate-700">รวม</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-800">฿{formatCurrency(laborTotal)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
