'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowDown, ArrowUp, ImageUp, Loader2, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { useToast } from '@/components/ui/Toast'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { getSignatureSlots, replaceSignatureSlots, uploadSignatureSlotAsset } from '@/actions/signature-slots-actions'
import type { SignatureDocumentType, SignatureSystemKey } from '@/lib/types/signatures'
import { useDepartment } from '@/components/layout/DepartmentContext'

const TABS: { key: SignatureDocumentType; label: string }[] = [
  { key: 'purchase_request', label: 'คำขอซื้อ (PR)' },
  { key: 'purchase_order', label: 'ใบสั่งซื้อ (PO)' },
  { key: 'billing', label: 'ใบเบิกงวดงาน / DC' },
  { key: 'sale_receipt', label: 'ใบเสร็จรับเงิน (ฝ่ายขาย)' },
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

function snapshotOf(drafts: SlotDraft[]): string {
  return JSON.stringify(drafts.map(({ label, system_key, signature_url }) => ({ label, system_key, signature_url })))
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
  const { theme } = useDepartment()
  const [activeTab, setActiveTab] = useState<SignatureDocumentType>(initialTab)
  const [slots, setSlots] = useState<SlotDraft[]>(() => toDrafts(initialSlots))
  const [isLoading, setIsLoading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  // What is stored right now, for the "unsaved changes" state and the tab-switch guard.
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshotOf(toDrafts(initialSlots)))
  const [pendingTab, setPendingTab] = useState<SignatureDocumentType | null>(null)
  const isDirty = snapshotOf(slots) !== savedSnapshot

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
      const drafts = toDrafts(data)
      setSlots(drafts)
      setSavedSnapshot(snapshotOf(drafts))
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
        const drafts = toDrafts(saved)
        setSlots(drafts)
        setSavedSnapshot(snapshotOf(drafts))
        toast.success('บันทึกลายเซ็นเรียบร้อยแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ')
      }
    })
  }

  return (
    <PageContainer width="form">
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

      <div className="flex gap-2 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="ประเภทเอกสาร">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            onClick={() => {
              if (t.key === activeTab) return
              if (isDirty) setPendingTab(t.key)
              else setActiveTab(t.key)
            }}
            className={`relative -mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              activeTab === t.key ? theme.tab : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <Card className="p-4">
          <div className="space-y-3">
            {slots.length === 0 && (
              <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">
                ยังไม่มีช่องลายเซ็น กดเพิ่มด้านล่างเพื่อเริ่มต้น
              </p>
            )}
            {slots.map((slot, index) => (
              <div key={slot._key} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
                <div className="flex flex-col items-center gap-1 pt-1">
                  <button
                    type="button"
                    onClick={() => move(slot._key, -1)}
                    disabled={index === 0}
                    aria-label={`ย้ายช่องที่ ${index + 1} ขึ้น`}
                    title="ย้ายขึ้น"
                    className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600" aria-hidden>
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => move(slot._key, 1)}
                    disabled={index === slots.length - 1}
                    aria-label={`ย้ายช่องที่ ${index + 1} ลง`}
                    title="ย้ายลง"
                    className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 space-y-2">
                  <div>
                    <input
                      value={slot.label}
                      onChange={(e) => updateLabel(slot._key, e.target.value)}
                      placeholder="เช่น ผู้ตรวจสอบ"
                      aria-label={`ชื่อช่องลายเซ็นที่ ${index + 1}`}
                      aria-invalid={!slot.label.trim() || undefined}
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
                        <span className="text-center text-[10px] leading-tight text-slate-500">ไม่มีรูป
                          <br />(เซ็นสด)</span>
                      )}
                    </div>
                    <div className="flex flex-1 items-center gap-2">
                      <label
                        className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 ${
                          uploadingKey !== null ? 'pointer-events-none opacity-50' : ''
                        }`}
                      >
                        <ImageUp className="h-4 w-4" aria-hidden />
                        {slot.signature_url ? 'เปลี่ยนรูปลายเซ็น' : 'อัปโหลดรูปลายเซ็น'}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleUpload(slot._key, e.target.files?.[0])}
                          disabled={uploadingKey !== null}
                          className="sr-only"
                          aria-label={`อัปโหลดรูปลายเซ็นของช่องที่ ${index + 1}`}
                        />
                      </label>
                      {slot.signature_url && (
                        <button
                          type="button"
                          onClick={() => setSlots((prev) => prev.map((s) => (s._key === slot._key ? { ...s, signature_url: null } : s)))}
                          className="shrink-0 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-red-50 hover:text-red-700"
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
                  aria-label={`ลบช่องลายเซ็นที่ ${index + 1}`}
                  className="mt-1 rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
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

          {slots.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">ตัวอย่างบนเอกสารพิมพ์</p>
              <div className="flex flex-wrap gap-6 rounded-lg border border-dashed border-slate-300 bg-white p-4">
                {slots.map((slot, index) => (
                  <div key={slot._key} className="w-32 text-center">
                    <div className="flex h-12 items-end justify-center">
                      {slot.signature_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={slot.signature_url} alt="" className="max-h-12 max-w-full object-contain" />
                      ) : null}
                    </div>
                    <div className="border-t border-slate-400 pt-1 text-xs text-slate-700">{slot.label.trim() || `ช่องที่ ${index + 1}`}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t pt-4">
            <span className={`text-sm ${isDirty ? 'font-medium text-amber-800' : 'text-slate-500'}`} aria-live="polite">
              {isDirty ? 'มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก' : 'บันทึกแล้ว'}
            </span>
            <Button type="button" onClick={handleSave} disabled={isPending || !isDirty}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึก'}
            </Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        isOpen={pendingTab !== null}
        title="ทิ้งการเปลี่ยนแปลงที่ยังไม่ได้บันทึก?"
        message="ช่องลายเซ็นที่แก้ไขไว้ในประเภทเอกสารนี้ยังไม่ได้บันทึก ถ้าเปลี่ยนไปประเภทอื่นจะหายไป"
        confirmLabel="ทิ้งและเปลี่ยน"
        cancelLabel="อยู่ต่อ"
        tone="danger"
        onCancel={() => setPendingTab(null)}
        onConfirm={() => {
          if (pendingTab) setActiveTab(pendingTab)
          setPendingTab(null)
        }}
      />
    </PageContainer>
  )
}
