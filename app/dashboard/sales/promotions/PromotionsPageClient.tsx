'use client'

import { useEffect, useState, useTransition } from 'react'
import { ArrowLeft, Loader2, Plus, Tag } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button, ButtonLink } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import { createPromotion, setPromotionActive, updatePromotion, type Promotion } from '@/actions/promotions-actions'

type Draft = { name: string; description: string; discount_type: 'percent' | 'amount'; discount_value: string }

function toDraft(p: Promotion): Draft {
  return { name: p.name, description: p.description || '', discount_type: p.discountType, discount_value: String(p.discountValue) }
}

export default function PromotionsPageClient({
  initialPromotions,
  initialError,
  canManage,
}: {
  initialPromotions: Promotion[]
  initialError?: string | null
  canManage: boolean
}) {
  const [promotions, setPromotions] = useState<Promotion[]>(initialPromotions)
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(initialPromotions.map((p) => [p.id, toDraft(p)]))
  )
  const [savingId, setSavingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [isCreating, startCreating] = useTransition()
  const [formKey, setFormKey] = useState(0)
  const toast = useToast()

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function handleSaveRow(id: string) {
    const draft = drafts[id]
    if (!draft) return
    if (!draft.name.trim()) {
      toast.error('กรุณาใส่ชื่อโปรโมชั่น')
      return
    }
    setSavingId(id)

    const formData = new FormData()
    formData.set('name', draft.name)
    formData.set('description', draft.description)
    formData.set('discount_type', draft.discount_type)
    formData.set('discount_value', draft.discount_value)

    const res = await updatePromotion(id, formData)
    setSavingId(null)

    if (!res.success) {
      toast.error(res.error || 'บันทึกไม่สำเร็จ')
      return
    }
    setPromotions((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, name: draft.name, description: draft.description || null, discountType: draft.discount_type, discountValue: Number(draft.discount_value) }
          : p
      )
    )
    toast.success(`บันทึกโปรโมชั่น "${draft.name}" แล้ว`)
  }

  async function handleToggleActive(promo: Promotion) {
    setTogglingId(promo.id)
    const res = await setPromotionActive(promo.id, !promo.isActive)
    setTogglingId(null)
    if (!res.success) {
      toast.error(res.error || 'เปลี่ยนสถานะไม่สำเร็จ')
      return
    }
    setPromotions((prev) => prev.map((p) => (p.id === promo.id ? { ...p, isActive: !p.isActive } : p)))
    toast.success(promo.isActive ? `ปิดใช้งาน "${promo.name}" แล้ว` : `เปิดใช้งาน "${promo.name}" แล้ว`)
  }

  function handleCreate(formData: FormData) {
    startCreating(async () => {
      const res = await createPromotion(formData)
      if (!res.success) {
        toast.error(res.error || 'เพิ่มโปรโมชั่นไม่สำเร็จ')
        return
      }
      setFormKey((k) => k + 1)
      toast.success(`เพิ่มโปรโมชั่น "${formData.get('name')}" แล้ว`)
      // Re-derive the full list from the server rather than fabricating a
      // fake id client-side - handleSaveRow/handleToggleActive both need a
      // real promotion id to call their actions against.
      window.location.reload()
    })
  }

  const sorted = [...promotions].sort((a, b) => a.name.localeCompare(b.name, 'th'))

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-indigo-600">
            <Tag className="h-4 w-4" aria-hidden />
            ฝ่ายขาย
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">โปรโมชั่น</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            รายการโปรโมชั่นให้เลือกใช้ในหน้ารายละเอียดแปลง - แต่ละดีลเลือกได้ทีละ 1 โปรโมชั่น
            ปิดใช้งานแทนการลบ เพื่อไม่ให้ดีลเก่าที่เคยใช้โปรโมชั่นนี้หายไป
          </p>
        </div>
        <ButtonLink href="/dashboard/sales" variant="secondary">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          กลับไปผังการขาย
        </ButtonLink>
      </div>

      {canManage && (
        <Card className="border-slate-200 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">เพิ่มโปรโมชั่นใหม่</h2>
          <form key={formKey} action={handleCreate} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-6">
            <input name="name" required placeholder="ชื่อโปรโมชั่น" className="col-span-2 sm:col-span-2" />
            <input name="description" placeholder="รายละเอียด / เงื่อนไข" className="col-span-2 sm:col-span-2" />
            <select name="discount_type" required defaultValue="amount">
              <option value="amount">ลดเป็นจำนวนเงิน</option>
              <option value="percent">ลดเป็นเปอร์เซ็นต์</option>
            </select>
            <input name="discount_value" type="number" min="0" step="0.01" required placeholder="มูลค่าส่วนลด" />
            <Button type="submit" disabled={isCreating} className="col-span-2 sm:col-span-6 sm:w-fit">
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              เพิ่มโปรโมชั่น
            </Button>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">ชื่อโปรโมชั่น</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">รายละเอียด</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">ส่วนลด</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">ใช้งาน</th>
                {canManage && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 5 : 4} className="px-4 py-8 text-center text-slate-400">
                    ยังไม่มีโปรโมชั่น
                  </td>
                </tr>
              )}
              {sorted.map((p) => {
                const draft = drafts[p.id] || toDraft(p)
                return (
                  <tr key={p.id} className={`hover:bg-slate-50/80 ${!p.isActive ? 'opacity-60' : ''}`}>
                    <td className="px-2 py-2">
                      {canManage ? (
                        <input
                          value={draft.name}
                          onChange={(e) => updateDraft(p.id, { name: e.target.value })}
                          className="w-full min-w-[140px]"
                        />
                      ) : (
                        <span className="px-2">{p.name}</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {canManage ? (
                        <input
                          value={draft.description}
                          onChange={(e) => updateDraft(p.id, { description: e.target.value })}
                          className="w-full min-w-[180px]"
                        />
                      ) : (
                        <span className="px-2 text-slate-500">{p.description || '-'}</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {canManage ? (
                        <div className="flex items-center gap-1.5">
                          <select
                            value={draft.discount_type}
                            onChange={(e) => updateDraft(p.id, { discount_type: e.target.value as Draft['discount_type'] })}
                          >
                            <option value="amount">บาท</option>
                            <option value="percent">%</option>
                          </select>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={draft.discount_value}
                            onChange={(e) => updateDraft(p.id, { discount_value: e.target.value })}
                            className="w-24"
                          />
                        </div>
                      ) : (
                        <span className="px-2">
                          {p.discountType === 'percent' ? `${p.discountValue}%` : `${formatCurrency(p.discountValue)} บาท`}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {canManage ? (
                        <input
                          type="checkbox"
                          checked={p.isActive}
                          disabled={togglingId === p.id}
                          onChange={() => handleToggleActive(p)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      ) : (
                        <span className="text-xs text-slate-500">{p.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-2 py-2 text-right">
                        <Button size="sm" variant="secondary" onClick={() => handleSaveRow(p.id)} disabled={savingId === p.id}>
                          {savingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'บันทึก'}
                        </Button>
                      </td>
                    )}
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
