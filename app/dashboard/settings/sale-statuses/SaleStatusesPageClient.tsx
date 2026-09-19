'use client'

import { useEffect, useState, useTransition } from 'react'
import { ArrowLeft, Loader2, Plus, Tag } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button, ButtonLink } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { STATUS_COLOR_KEYS, statusColorClasses } from '@/lib/sales/statusColors'
import { createSaleStatus, updateSaleStatus, type SaleStatus } from '@/actions/sales-actions'

const STAGE_LABELS: Record<string, string> = {
  open: 'ว่าง (open)',
  reserved: 'จอง (reserved)',
  contracted: 'ทำสัญญา (contracted)',
  closing: 'ใกล้โอน (closing)',
  closed: 'ปิดการขาย (closed)',
  lost: 'ยกเลิก (lost)',
}
const STAGES = Object.keys(STAGE_LABELS)

type Draft = { label: string; color: string; stage: string; sort_order: string; is_active: boolean }

function toDraft(s: SaleStatus): Draft {
  return { label: s.label, color: s.color, stage: s.stage, sort_order: String(s.sort_order), is_active: s.is_active }
}

export default function SaleStatusesPageClient({
  initialStatuses,
  initialError,
}: {
  initialStatuses: SaleStatus[]
  initialError?: string | null
}) {
  const [statuses, setStatuses] = useState<SaleStatus[]>(initialStatuses)
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(initialStatuses.map((s) => [s.code, toDraft(s)]))
  )
  const [savingCode, setSavingCode] = useState<string | null>(null)
  const [isCreating, startCreating] = useTransition()
  // Bumped on a successful create to remount the (uncontrolled) add-status
  // form with fresh defaultValues - otherwise the just-submitted values sit
  // in the fields and a second click re-submits the same code.
  const [formKey, setFormKey] = useState(0)
  const toast = useToast()

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  function updateDraft(code: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }))
  }

  async function handleSaveRow(code: string) {
    const draft = drafts[code]
    if (!draft) return
    setSavingCode(code)

    const formData = new FormData()
    formData.set('label', draft.label)
    formData.set('color', draft.color)
    formData.set('stage', draft.stage)
    formData.set('sort_order', draft.sort_order)
    if (draft.is_active) formData.set('is_active', 'on')

    const res = await updateSaleStatus(code, formData)
    setSavingCode(null)

    if (!res.success) {
      toast.error(res.error || 'บันทึกไม่สำเร็จ')
      return
    }
    setStatuses((prev) =>
      prev.map((s) => (s.code === code ? { ...s, ...draft, sort_order: Number(draft.sort_order) } : s))
    )
    toast.success(`บันทึกสถานะ "${draft.label}" แล้ว`)
  }

  function handleCreate(formData: FormData) {
    startCreating(async () => {
      const res = await createSaleStatus(formData)
      if (!res.success) {
        toast.error(res.error || 'เพิ่มสถานะไม่สำเร็จ')
        return
      }
      const code = String(formData.get('code') || '')
      const created: SaleStatus = {
        code,
        label: String(formData.get('label') || ''),
        color: String(formData.get('color') || ''),
        stage: String(formData.get('stage') || ''),
        sort_order: Number(formData.get('sort_order') || 0),
        is_active: true,
      }
      setStatuses((prev) => [...prev, created].sort((a, b) => a.sort_order - b.sort_order))
      setDrafts((prev) => ({ ...prev, [code]: toDraft(created) }))
      setFormKey((k) => k + 1)
      toast.success(`เพิ่มสถานะ "${created.label}" แล้ว`)
    })
  }

  const sorted = [...statuses].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-indigo-600">
            <Tag className="h-4 w-4" aria-hidden />
            ฝ่ายขาย
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">สถานะการขาย</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            เพิ่ม เปลี่ยนชื่อ และเปลี่ยนสีสถานะได้เอง — รหัส (code) แก้ไม่ได้เพราะเป็นตัวอ้างอิงของประวัติการขายเดิม
            ทุกสถานะต้องระบุ stage เพื่อให้รายงานสรุปได้แม้เพิ่มสถานะใหม่ทีหลัง
          </p>
        </div>
        <ButtonLink href="/dashboard/settings" variant="secondary">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          กลับไปตั้งค่า
        </ButtonLink>
      </div>

      <Card className="border-slate-200 p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">เพิ่มสถานะใหม่</h2>
        <form key={formKey} action={handleCreate} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-6">
          <input name="code" required placeholder="code เช่น vip_hold" className="col-span-2 sm:col-span-1" />
          <input name="label" required placeholder="ชื่อที่แสดง" className="col-span-2 sm:col-span-1" />
          <select name="color" required defaultValue="">
            <option value="" disabled>สี</option>
            {STATUS_COLOR_KEYS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select name="stage" required defaultValue="">
            <option value="" disabled>Stage</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
          <input name="sort_order" type="number" placeholder="ลำดับ" defaultValue={(sorted.length + 1) * 10} />
          <Button type="submit" disabled={isCreating}>
            {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            เพิ่ม
          </Button>
        </form>
      </Card>

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Code</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">ชื่อที่แสดง</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">สี</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Stage</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">ลำดับ</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">ใช้งาน</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {sorted.map((s) => {
                const draft = drafts[s.code] || toDraft(s)
                const preview = statusColorClasses(draft.color)
                return (
                  <tr key={s.code} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{s.code}</td>
                    <td className="px-2 py-2">
                      <input
                        value={draft.label}
                        onChange={(e) => updateDraft(s.code, { label: e.target.value })}
                        className="w-full"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={draft.color}
                          onChange={(e) => updateDraft(s.code, { color: e.target.value })}
                        >
                          {STATUS_COLOR_KEYS.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] ring-1 ring-inset ${preview.chip}`}>
                          {draft.label || s.label}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={draft.stage}
                        onChange={(e) => updateDraft(s.code, { stage: e.target.value })}
                      >
                        {STAGES.map((st) => (
                          <option key={st} value={st}>{STAGE_LABELS[st]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        value={draft.sort_order}
                        onChange={(e) => updateDraft(s.code, { sort_order: e.target.value })}
                        className="w-20"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={draft.is_active}
                        onChange={(e) => updateDraft(s.code, { is_active: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button size="sm" variant="secondary" onClick={() => handleSaveRow(s.code)} disabled={savingCode === s.code}>
                        {savingCode === s.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'บันทึก'}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
