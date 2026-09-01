'use client'

import { useEffect, useState, useTransition } from 'react'
import { ArrowLeft, Building2, ImageIcon, Save } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button, ButtonLink } from '@/components/ui/Button'
import PageLoading from '@/components/ui/PageLoading'
import { useToast } from '@/components/ui/Toast'
import { getOrganizationSettings, updateBillingInfo } from '@/actions/settings-actions'

type Settings = Awaited<ReturnType<typeof getOrganizationSettings>>

const inputClass =
  'mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20'

export default function BillingInfoPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const toast = useToast()

  useEffect(() => {
    void (async () => {
      try {
        setSettings(await getOrganizationSettings())
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ')
      } finally {
        setIsLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      try {
        await updateBillingInfo(formData)
        setSettings(await getOrganizationSettings())
        toast.success('บันทึกข้อมูลใบเบิกเรียบร้อยแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ')
      }
    })
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-2 sm:px-0">
        <PageLoading label="กำลังโหลดข้อมูล..." />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-indigo-600">
            <Building2 className="h-4 w-4" aria-hidden />
            ข้อมูลใบเบิก
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">ข้อมูลบริษัทสำหรับใบเบิก</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            ชื่อบริษัทและเลขผู้เสียภาษีที่แสดงบนหัวกระดาษใบเบิกงวดงาน — ข้อมูลบริษัทที่ใช้ซื้อวัสดุ (โลโก้/ลายเซ็นรายบริษัท) อยู่ที่เมนู
            &quot;บริษัทในเครือ&quot;
          </p>
        </div>
        <ButtonLink href="/dashboard/settings" variant="secondary">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          กลับไปตั้งค่า
        </ButtonLink>
      </div>

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
                defaultValue={settings?.company_name || ''}
                className={inputClass}
                autoComplete="organization"
              />
            </div>
            <div>
              <label htmlFor="tax_id" className="text-sm font-medium text-slate-700">
                เลขประจำตัวผู้เสียภาษี
              </label>
              <input id="tax_id" type="text" name="tax_id" defaultValue={settings?.tax_id || ''} className={inputClass} />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="signature_url" className="text-sm font-medium text-slate-700">
                ลายเซ็นสำรอง
              </label>
              <p className="text-xs text-slate-400">
                ใช้กับใบสั่งซื้อเฉพาะเมื่อบริษัทในเครือที่ออกใบสั่งซื้อนั้นยังไม่มีลายเซ็นของตัวเอง
              </p>
              <div className="mt-2 flex flex-col gap-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-center">
                {settings?.signature_url ? (
                  <div className="flex shrink-0 items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={settings.signature_url}
                      alt="ลายเซ็นสำรอง"
                      className="h-16 w-auto max-w-[200px] rounded-md border border-slate-200 bg-white object-contain p-1"
                    />
                  </div>
                ) : (
                  <div className="flex h-16 w-24 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400">
                    <ImageIcon className="h-8 w-8" aria-hidden />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <input
                    id="signature_url"
                    type="file"
                    name="signature_url"
                    accept="image/*"
                    className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">แนะนำไฟล์พื้นหลังโปร่งใส (PNG) ขนาดไม่ใหญ่มาก</p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-8 flex justify-end border-t border-slate-100 pt-6">
            <Button type="submit" disabled={isPending}>
              <Save className="h-4 w-4" aria-hidden />
              {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  )
}
