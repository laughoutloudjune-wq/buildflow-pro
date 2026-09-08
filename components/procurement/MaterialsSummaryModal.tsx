'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { getMaterialsSummaryForProject } from '@/actions/procurement-actions'
import type { MaterialsSummaryRow } from '@/actions/procurement/materials-summary'

const STATUS_LABEL: Record<string, string> = {
  draft: 'ร่าง',
  sent: 'ยืนยันสั่งซื้อ',
  partially_received: 'รับของบางส่วน',
  received: 'รับของแล้ว',
  paid: 'ชำระแล้ว',
}

type Props = {
  isOpen: boolean
  onClose: () => void
  projectId: string
  /** Shown in the modal title, e.g. "กลุ่มแปลง 98-102" or "ทั้งโครงการ". */
  scopeLabel: string
  plotGroupId?: string
  plotIds?: string[]
}

/** Rolls up every purchase order tagged to a project (optionally narrowed
 * to one plot group) into one row per material - answers "what's been
 * bought/received for this batch" without opening each PO individually. */
export default function MaterialsSummaryModal({ isOpen, onClose, projectId, scopeLabel, plotGroupId, plotIds }: Props) {
  const toast = useToast()
  const [rows, setRows] = useState<MaterialsSummaryRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!isOpen) return
    setIsLoading(true)
    getMaterialsSummaryForProject(projectId, { plotGroupId, plotIds })
      .then(setRows)
      .catch((error) => toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลวัสดุไม่สำเร็จ'))
      .finally(() => setIsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, projectId, plotGroupId, (plotIds || []).join(',')])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`วัสดุที่เกี่ยวข้อง - ${scopeLabel}`} panelClassName="max-w-3xl">
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-10 text-center text-sm text-slate-400">
          ยังไม่มีใบสั่งซื้อที่เกี่ยวข้องกับขอบเขตนี้
        </div>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-3 py-2">วัสดุ</th>
                <th className="px-3 py-2 text-right">สั่งซื้อรวม</th>
                <th className="px-3 py-2 text-right">รับแล้ว</th>
                <th className="px-3 py-2">ใบสั่งซื้อที่เกี่ยวข้อง</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row) => (
                <tr key={row.material_type_id} className="align-top">
                  <td className="px-3 py-2.5 font-medium text-slate-800">{row.name}</td>
                  <td className="px-3 py-2.5 text-right text-slate-700">
                    {row.quantity_ordered.toLocaleString('th-TH')} {row.unit}
                  </td>
                  <td className="px-3 py-2.5 text-right text-emerald-700">
                    {row.quantity_received.toLocaleString('th-TH')} {row.unit}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {row.orders.map((o) => (
                        <Link
                          key={o.id}
                          href={`/dashboard/procurement/orders/${o.id}`}
                          title={STATUS_LABEL[o.status] || o.status}
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
          </table>
        </div>
      )}
    </Modal>
  )
}
