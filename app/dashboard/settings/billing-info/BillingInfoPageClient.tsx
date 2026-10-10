'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ImageIcon, Save } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button, ButtonLink } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { getOrganizationSettings, updateBillingInfo } from '@/actions/settings-actions'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'

type Settings = Awaited<ReturnType<typeof getOrganizationSettings>>

const inputClass =
  'mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20'

export default function BillingInfoPageClient({
  settings,
  initialError,
}: {
  settings: Settings
  initialError?: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  // Live values, so the letterhead preview and the "unsaved" state follow what is typed.
  const [companyName, setCompanyName] = useState(settings?.company_name || '')
  const [taxId, setTaxId] = useState(settings?.tax_id || '')
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const isDirty =
    companyName !== (settings?.company_name || '') || taxId !== (settings?.tax_id || '') || pickedFile !== null

  // The object URL for a freshly picked image lives only as long as the pick.
  useEffect(() => {
    if (!pickedFile) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(pickedFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pickedFile])

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await updateBillingInfo(formData)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      setPickedFile(null)
      router.refresh()
      toast.success('บันทึกข้อมูลใบเบิกเรียบร้อยแล้ว')
    })
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="ข้อมูลบริษัทสำหรับใบเบิก"
        subtitle="ชื่อบริษัทและเลขผู้เสียภาษีที่แสดงบนหัวกระดาษใบเบิกงวดงาน — ข้อมูลบริษัทที่ใช้ซื้อวัสดุ (โลโก้/ลายเซ็นรายบริษัท) อยู่ที่เมนู &quot;บริษัทในเครือ&quot;"
        actions={
          <>
        <ButtonLink href="/dashboard/settings" variant="secondary">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          กลับไปตั้งค่า
        </ButtonLink>
          </>
        }
      />

      <form onSubmit={handleSubmit}>
        <Card className="border-slate-200 p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <label htmlFor="company_name" className="text-sm font-medium text-slate-700">
                ชื่อบริษัท
              </label>
              <input
                id="company_name"
                type="text"
                name="company_name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className={inputClass}
                autoComplete="organization"
              />
            </div>
            <div>
              <label htmlFor="tax_id" className="text-sm font-medium text-slate-700">
                เลขประจำตัวผู้เสียภาษี
              </label>
              <input id="tax_id" type="text" name="tax_id" value={taxId} onChange={(e) => setTaxId(e.target.value)} className={inputClass} />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="signature_url" className="text-sm font-medium text-slate-700">
                ลายเซ็นสำรอง
              </label>
              <p className="text-xs text-slate-500">
                ใช้กับใบสั่งซื้อเฉพาะเมื่อบริษัทในเครือที่ออกใบสั่งซื้อนั้นยังไม่มีลายเซ็นของตัวเอง
              </p>
              <div className="mt-2 flex flex-col gap-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-center">
                {previewUrl || settings?.signature_url ? (
                  <div className="flex shrink-0 flex-col items-start gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl || settings?.signature_url || ''}
                      alt="ลายเซ็นสำรอง"
                      className="h-16 w-auto max-w-[200px] rounded-md border border-slate-200 bg-white object-contain p-1"
                    />
                    <span className={`text-[11px] ${previewUrl ? 'font-medium text-amber-800' : 'text-slate-500'}`}>
                      {previewUrl ? 'รูปใหม่ — ยังไม่ได้บันทึก' : 'รูปที่ใช้อยู่'}
                    </span>
                  </div>
                ) : (
                  <div className="flex h-16 w-24 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">
                    <ImageIcon className="h-8 w-8" aria-hidden />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <input
                    id="signature_url"
                    type="file"
                    name="signature_url"
                    accept="image/*"
                    onChange={(e) => setPickedFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">แนะนำไฟล์พื้นหลังโปร่งใส (PNG) ขนาดไม่ใหญ่มาก</p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">ตัวอย่างหัวกระดาษใบเบิก</p>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-base font-bold text-slate-900">{companyName.trim() || 'ชื่อบริษัท'}</p>
              <p className="text-sm text-slate-600">เลขประจำตัวผู้เสียภาษี {taxId.trim() || '—'}</p>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-6">
            <span className={`text-sm ${isDirty ? 'font-medium text-amber-800' : 'text-slate-500'}`} aria-live="polite">
              {isDirty ? 'มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก' : 'บันทึกแล้ว'}
            </span>
            <Button type="submit" disabled={isPending || !isDirty}>
              <Save className="h-4 w-4" aria-hidden />
              {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </div>
        </Card>
      </form>
    </PageContainer>
  )
}
