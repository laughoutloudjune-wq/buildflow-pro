'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { getSignatureSlots, replaceSignatureSlots, uploadSignatureSlotAsset } from '@/actions/signature-slots-actions'
import type { SignatureDocumentType, SignatureSystemKey } from '@/lib/types/signatures'

const TABS: { key: SignatureDocumentType; label: string }[] = [
  { key: 'purchase_request', label: 'ใบขอซื้อ (PR)' },
  { key: 'purchase_order', label: 'ใบสั่งซื้อ (PO)' },
  { key: 'billing', label: 'ใบเบิกงวดงาน / DC' },
]

const SYSTEM_KEY_LABEL: Record<SignatureSystemKey, string> = {
  requester: 'ผู้ขอซื้อจริงในเอกสาร',
  reviewer: 'ผู้อนุมัติจริงในเอกสาร',
  preparer: 'ผู้จัดทำจริงในเอกสาร',
  supplier: 'ผู้จำหน่ายจริงในเอกสาร',
}

// Client-only key for list editing (add/reorder/remove before saving) - not
// persisted. Existing slots reuse their real id; new ones get a random one.
type SlotDraft = {
  _key: string
  label: string
  system_key: SignatureSystemKey | null
  signature_url: string | null
}

function randomKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random())
}

function toDrafts(data: Awaited<ReturnType<typeof getSignatureSlots>>): SlotDraft[] {
  return data.map((s) => ({ _key: s.id, label: s.label, system_key: s.system_key, signature_url: s.signature_url }))
}

export default function SignatureSettingsPageClient({
  initialTab,
  initialSlots,
  initialError,
}: {
  initialTab: SignatureDocumentType
  initialSlots: Awaited<ReturnType<typeof getSignatureSlots>>
  initialError?: string | null
}) {
  const toast = useToast()
  const [activeTab, setActiveTab] = useState<SignatureDocumentType>(initialTab)
  const [slots, setSlots] = useState<SlotDraft[]>(() => toDrafts(initialSlots))
  const [isLoading, setIsLoading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  // Initial tab's slots already arrived as a prop from the server - only
  // fetch when the user actually switches to a different tab.
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    void load(activeTab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  async function load(documentType: SignatureDocumentType) {
    setIsLoading(true)
    try {
      const data = await getSignatureSlots(documentType)
      setSlots(toDrafts(data))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลลายเซ็นไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  function addSlot() {
    setSlots((prev) => [...prev, { _key: randomKey(), label: '', system_key: null, signature_url: null }])
  }

  function removeSlot(key: string) {
    setSlots((prev) => prev.filter((s) => s._key !== key))
  }

  function updateLabel(key: string, label: string) {
    setSlots((prev) => prev.map((s) => (s._key === key ? { ...s, label } : s)))
  }

  function move(key: string, direction: -1 | 1) {
    setSlots((prev) => {
      const index = prev.findIndex((s) => s._key === key)
      const target = index + direction
      if (index === -1 || target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function handleUpload(key: string, file: File | undefined) {
    if (!file) return
    setUploadingKey(key)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const url = await uploadSignatureSlotAsset(formData)
      setSlots((prev) => prev.map((s) => (s._key === key ? { ...s, signature_url: url } : s)))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'อัปโหลดไม่สำเร็จ')
    } finally {
      setUploadingKey(null)
    }
  }

  function handleSave() {
    if (slots.some((s) => !s.label.trim())) {
      toast.error('กรุณาใส่ชื่อลายเซ็นทุกช่อง หรือลบช่องที่ไม่ใช้ออก')
      return
    }
    startTransition(async () => {
      try {
        const saved = await replaceSignatureSlots(
          activeTab,
          slots.map(({ label, system_key, signature_url }) => ({ label, system_key, signature_url }))
        )
        setSlots(toDrafts(saved))
        toast.success('บันทึกลายเซ็นเรียบร้อยแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ')
      }
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/dashboard/settings"
          className="mb-2 flex w-fit items-center gap-1 text-sm text-slate-500 transition hover:text-indigo-600"
        >
          <ArrowLeft className="h-4 w-4" /> กลับไปตั้งค่า
        </Link>
        <PageHeader
          title="ลายเซ็นในเอกสาร"
          subtitle="กำหนดจำนวน ป้ายชื่อ และรูปลายเซ็นของแต่ละช่องเซ็นชื่อบนเอกสารที่พิมพ์ได้"
        />
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`relative -mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              activeTab === t.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <Card className="p-4">
          <div className="space-y-3">
            {slots.length === 0 && (
              <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
                ยังไม่มีช่องลายเซ็น กดเพิ่มด้านล่างเพื่อเริ่มต้น
              </p>
            )}
            {slots.map((slot, index) => (
              <div key={slot._key} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
                <div className="flex flex-col gap-1 pt-1.5">
                  <button
                    type="button"
                    onClick={() => move(slot._key, -1)}
                    disabled={index === 0}
                    className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(slot._key, 1)}
                    disabled={index === slots.length - 1}
                    className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex-1 space-y-2">
                  <div>
                    <input
                      value={slot.label}
                      onChange={(e) => updateLabel(slot._key, e.target.value)}
                      placeholder="เช่น ผู้ตรวจสอบ"
                      className="w-full"
                    />
                    {slot.system_key && (
                      <p className="mt-1 text-xs text-indigo-600">
                        ระบบเติมชื่อ-วันที่ให้อัตโนมัติ: {SYSTEM_KEY_LABEL[slot.system_key]}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-1">
                      {uploadingKey === slot._key ? (
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                      ) : slot.signature_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={slot.signature_url} alt={slot.label} className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span className="text-center text-[10px] leading-tight text-slate-400">ไม่มีรูป
                          <br />(เซ็นสด)</span>
                      )}
                    </div>
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleUpload(slot._key, e.target.files?.[0])}
                        disabled={uploadingKey !== null}
                        className="w-full text-xs"
                      />
                      {slot.signature_url && (
                        <button
                          type="button"
                          onClick={() => setSlots((prev) => prev.map((s) => (s._key === slot._key ? { ...s, signature_url: null } : s)))}
                          className="shrink-0 text-xs text-slate-400 hover:text-red-500"
                        >
                          ลบรูป
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => removeSlot(slot._key)}
                  className="mt-1 rounded p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                  title="ลบช่องลายเซ็นนี้"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}

            <Button type="button" variant="secondary" size="sm" onClick={addSlot}>
              <Plus className="h-3.5 w-3.5" /> เพิ่มช่องลายเซ็น
            </Button>
          </div>

          <div className="mt-5 flex justify-end border-t pt-4">
            <Button type="button" onClick={handleSave} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึก'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
