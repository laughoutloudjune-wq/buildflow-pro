'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import { clearCommission, setCommission, type ProjectCommission } from '@/actions/commission-actions'

/** Project-default commission (fixed baht amount). Per-plot overrides are set
 * on each plot's sales tab; this card only lists how many there are. */
export default function CommissionSettingsCard({
  initialProjects,
  canManage,
}: {
  initialProjects: ProjectCommission[]
  canManage: boolean
}) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [projects, setProjects] = useState(initialProjects)
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialProjects.map((p) => [p.projectId, p.defaultAmount !== null ? String(p.defaultAmount) : '']))
  )

  function handleSave(p: ProjectCommission) {
    const raw = drafts[p.projectId] ?? ''
    const amount = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(amount) || amount < 0) {
      toast.error('กรุณาใส่จำนวนเงินให้ถูกต้อง')
      return
    }
    startTransition(async () => {
      const res = await setCommission({ projectId: p.projectId, amount })
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      setProjects((prev) => prev.map((x) => (x.projectId === p.projectId ? { ...x, defaultAmount: amount } : x)))
      toast.success(`บันทึกค่าคอมมิชชันโครงการ ${p.projectName} แล้ว`)
    })
  }

  function handleClear(p: ProjectCommission) {
    startTransition(async () => {
      const res = await clearCommission({ projectId: p.projectId })
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      setProjects((prev) => prev.map((x) => (x.projectId === p.projectId ? { ...x, defaultAmount: null } : x)))
      setDrafts((prev) => ({ ...prev, [p.projectId]: '' }))
      toast.success('ล้างค่าเริ่มต้นแล้ว')
    })
  }

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-slate-700">ค่าคอมมิชชัน (จำนวนคงที่ต่อแปลง)</h3>
      <p className="mt-1 text-xs text-slate-400">
        ตั้งค่าเริ่มต้นต่อโครงการ ส่วนแปลงที่ต้องการยอดไม่เท่ากันให้ตั้งเฉพาะแปลงในแท็บ &quot;การขาย&quot; ของแปลงนั้น
        ยอดจะถูกคัดลอกลงใบขอโอนตอนสร้าง ใบเก่าไม่เปลี่ยนตามค่าที่แก้ภายหลัง
      </p>
      <div className="mt-3 divide-y divide-slate-100">
        {projects.map((p) => (
          <div key={p.projectId} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-[180px] flex-1">
              <div className="text-sm font-medium text-slate-800">{p.projectName}</div>
              <div className="text-xs text-slate-400">
                {p.defaultAmount !== null ? `ค่าเริ่มต้น ${formatCurrency(p.defaultAmount)}` : 'ยังไม่ได้ตั้งค่า'}
                {p.overrides.length > 0 && ` · ตั้งเฉพาะแปลง ${p.overrides.length} แปลง`}
              </div>
            </div>
            {canManage ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={drafts[p.projectId] ?? ''}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [p.projectId]: e.target.value }))}
                  className="w-36"
                  placeholder="บาท"
                  aria-label={`ค่าคอมมิชชันเริ่มต้นของ ${p.projectName}`}
                />
                <Button type="button" size="sm" onClick={() => handleSave(p)} disabled={isPending}>
                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  บันทึก
                </Button>
                {p.defaultAmount !== null && (
                  <Button type="button" size="sm" variant="secondary" onClick={() => handleClear(p)} disabled={isPending}>
                    ล้าง
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        ))}
        {projects.length === 0 && <p className="py-3 text-sm text-slate-400">ไม่พบโครงการ</p>}
      </div>
    </Card>
  )
}
