'use client'

import { useEffect, useState, useTransition } from 'react'
import { ArrowLeft, Banknote, Save } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button, ButtonLink } from '@/components/ui/Button'
import PageLoading from '@/components/ui/PageLoading'
import { useToast } from '@/components/ui/Toast'
import { getOrganizationSettings, updateFinancialDefaults } from '@/actions/settings-actions'

type Settings = Awaited<ReturnType<typeof getOrganizationSettings>>

const inputClass =
  'mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20'

export default function FinancialDefaultsPage() {
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
        await updateFinancialDefaults(formData)
        toast.success('บันทึกค่าเริ่มต้นเรียบร้อยแล้ว')
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
            <Banknote className="h-4 w-4" aria-hidden />
            ค่าเริ่มต้นทางการเงิน
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">ค่าเริ่มต้นเมื่อสร้างใบเบิก</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">ใช้เป็นค่าเริ่มต้นเมื่อสร้างหรือตรวจใบเบิก ปรับแก้รายใบได้ภายหลัง</p>
        </div>
        <ButtonLink href="/dashboard/settings" variant="secondary">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          กลับไปตั้งค่า
        </ButtonLink>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="border-slate-200 p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div>
              <label htmlFor="default_vat" className="text-sm font-medium text-slate-700">
                VAT เริ่มต้น (%)
              </label>
              <input
                id="default_vat"
                type="number"
                step="0.01"
                name="default_vat"
                defaultValue={settings?.default_vat ?? 0}
                className={inputClass}
                min={0}
              />
            </div>
            <div>
              <label htmlFor="default_wht" className="text-sm font-medium text-slate-700">
                หัก ณ ที่จ่าย เริ่มต้น (%)
              </label>
              <input
                id="default_wht"
                type="number"
                step="0.01"
                name="default_wht"
                defaultValue={settings?.default_wht ?? 0}
                className={inputClass}
                min={0}
              />
            </div>
            <div>
              <label htmlFor="default_retention" className="text-sm font-medium text-slate-700">
                เงินประกันผลงาน เริ่มต้น (%)
              </label>
              <input
                id="default_retention"
                type="number"
                step="0.01"
                name="default_retention"
                defaultValue={settings?.default_retention ?? 0}
                className={inputClass}
                min={0}
              />
            </div>
          </div>
          <div className="mt-8 flex justify-end border-t border-slate-100 pt-6">
            <Button type="submit" disabled={isPending}>
              <Save className="h-4 w-4" aria-hidden />
              {isPending ? 'กำลังบันทึก...' : 'บันทึกค่าเริ่มต้น'}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  )
}
