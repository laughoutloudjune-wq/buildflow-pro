'use client'

import Link from 'next/link'
import { useState, useEffect, useTransition, useCallback } from 'react'
import { Card } from '@/components/ui/Card'
import PageLoading from '@/components/ui/PageLoading'
import NoticeBanner from '@/components/ui/NoticeBanner'
import {
  getOrganizationSettings,
  updateOrganizationSettings,
  getUsers,
  updateUserRole,
} from '@/actions/settings-actions'
import {
  Building2,
  Banknote,
  Users,
  Hammer,
  ShieldCheck,
  ChevronRight,
  ImageIcon,
} from 'lucide-react'

type Settings = Awaited<ReturnType<typeof getOrganizationSettings>>
type User = Awaited<ReturnType<typeof getUsers>>[0]
type TabKey = 'company' | 'financial' | 'users'

const inputClass =
  'mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20'

const TabButton = ({
  label,
  icon,
  isActive,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  isActive: boolean
  onClick: () => void
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
      isActive
        ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200/80'
        : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
    }`}
  >
    {icon}
    {label}
  </button>
)

const roleSelectClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('company')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const [settingsData, usersData] = await Promise.all([getOrganizationSettings(), getUsers()])
      setSettings(settingsData)
      setUsers(usersData)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleSettingsUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    startTransition(async () => {
      setNotice(null)
      try {
        await updateOrganizationSettings(formData)
        setNotice({ tone: 'success', message: 'บันทึกการตั้งค่าเรียบร้อยแล้ว' })
      } catch (e) {
        setNotice({ tone: 'error', message: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' })
      }
    })
  }

  const handleRoleChange = (userId: string, newRole: 'admin' | 'pm' | 'foreman') => {
    startTransition(async () => {
      setNotice(null)
      try {
        await updateUserRole(userId, newRole)
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)))
        const target = users.find((u) => u.id === userId)
        setNotice({
          tone: 'success',
          message: `อัปเดตบทบาทแล้ว: ${target?.email || target?.full_name || userId}`,
        })
      } catch (e) {
        setNotice({ tone: 'error', message: e instanceof Error ? e.message : 'อัปเดตบทบาทไม่สำเร็จ' })
      }
    })
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-2 sm:px-0">
        <PageLoading label="กำลังโหลดการตั้งค่า..." />
      </div>
    )
  }

  if (loadError && !settings) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-2 sm:px-0">
        <NoticeBanner tone="error" message={loadError} />
        <button
          type="button"
          onClick={() => void loadData()}
          className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          ลองโหลดใหม่
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">ตั้งค่าระบบ</h1>
        <p className="mt-1 text-sm text-slate-500">
          ข้อมูลบริษัท ค่าเริ่มต้นทางบัญชี การจัดการผู้ใช้ และลิงก์ไปยังตั้งค่าเพิ่มเติม
        </p>
      </div>

      {notice ? (
        <NoticeBanner tone={notice.tone} message={notice.message} onClose={() => setNotice(null)} />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/dashboard/settings/contractor-types"
          className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-amber-200 hover:bg-amber-50/50"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <Hammer className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <div className="font-semibold text-slate-900">ประเภทผู้รับเหมา</div>
              <div className="text-xs text-slate-500">จัดการประเภทช่างที่ใช้ในระบบ</div>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-slate-400 transition group-hover:text-amber-600" aria-hidden />
        </Link>
        <Link
          href="/dashboard/settings/permissions"
          className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/50"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <div className="font-semibold text-slate-900">สิทธิ์ตามบทบาท</div>
              <div className="text-xs text-slate-500">กำหนดว่าแต่ละตำแหน่งเข้าโมดูลไหนได้</div>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-slate-400 transition group-hover:text-indigo-600" aria-hidden />
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-1.5">
        <div className="flex gap-1 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible">
          <TabButton
            label="ข้อมูลบริษัท"
            icon={<Building2 className="h-4 w-4" aria-hidden />}
            isActive={activeTab === 'company'}
            onClick={() => setActiveTab('company')}
          />
          <TabButton
            label="ค่าเริ่มต้นทางการเงิน"
            icon={<Banknote className="h-4 w-4" aria-hidden />}
            isActive={activeTab === 'financial'}
            onClick={() => setActiveTab('financial')}
          />
          <TabButton
            label="ผู้ใช้และบทบาท"
            icon={<Users className="h-4 w-4" aria-hidden />}
            isActive={activeTab === 'users'}
            onClick={() => setActiveTab('users')}
          />
        </div>
      </div>

      <form onSubmit={handleSettingsUpdate}>
        {activeTab === 'company' && (
          <Card className="border-slate-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">ข้อมูลบริษัท</h2>
            <p className="mt-1 text-sm text-slate-500">ใช้แสดงในเอกสารและหัวกระดาษเมื่อพิมพ์</p>
            <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
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
                <input
                  id="tax_id"
                  type="text"
                  name="tax_id"
                  defaultValue={settings?.tax_id || ''}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="phone" className="text-sm font-medium text-slate-700">
                  โทรศัพท์
                </label>
                <input
                  id="phone"
                  type="text"
                  name="phone"
                  defaultValue={settings?.phone || ''}
                  className={inputClass}
                  autoComplete="tel"
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="address" className="text-sm font-medium text-slate-700">
                  ที่อยู่
                </label>
                <textarea
                  id="address"
                  name="address"
                  defaultValue={settings?.address || ''}
                  rows={3}
                  className={inputClass}
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="logo_url" className="text-sm font-medium text-slate-700">
                  โลโก้บริษัท
                </label>
                <div className="mt-2 flex flex-col gap-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-center">
                  {settings?.logo_url ? (
                    <div className="flex shrink-0 items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={settings.logo_url}
                        alt="โลโก้บริษัท"
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
                      id="logo_url"
                      type="file"
                      name="logo_url"
                      accept="image/*"
                      className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
                    />
                    <p className="mt-1.5 text-xs text-slate-500">รองรับไฟล์ภาพทั่วไป (ขึ้นกับการตั้งค่าเก็บไฟล์ของระบบ)</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-8 flex justify-end border-t border-slate-100 pt-6">
              <button
                type="submit"
                disabled={isPending}
                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {isPending ? 'กำลังบันทึก...' : 'บันทึกข้อมูลบริษัท'}
              </button>
            </div>
          </Card>
        )}

        {activeTab === 'financial' && (
          <Card className="border-slate-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">ค่าเริ่มต้นทางการเงิน</h2>
            <p className="mt-1 text-sm text-slate-500">
              ใช้เป็นค่าเริ่มต้นเมื่อสร้างหรือตรวจใบเบิก (ปรับรายใบได้ภายหลัง)
            </p>
            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
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
              <button
                type="submit"
                disabled={isPending}
                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {isPending ? 'กำลังบันทึก...' : 'บันทึกค่าเริ่มต้น'}
              </button>
            </div>
          </Card>
        )}
      </form>

      {activeTab === 'users' && (
        <Card className="border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">ผู้ใช้และบทบาท</h2>
          <p className="mt-1 text-sm text-slate-500">
            บทบาทหลัก (Admin / PM / Foreman) ใช้ร่วมกับเมทริกซ์สิทธิ์ในเมนู &quot;สิทธิ์ตามบทบาท&quot;
          </p>
          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      ชื่อ
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      อีเมล
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      บทบาท
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-12 text-center text-slate-500">
                        ยังไม่พบผู้ใช้ในระบบ
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr key={user.id} className="transition hover:bg-slate-50/80">
                        <td className="whitespace-nowrap px-4 py-3.5 font-medium text-slate-900">
                          {user.full_name || '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-slate-600">{user.email || '—'}</td>
                        <td className="whitespace-nowrap px-4 py-3.5">
                          <select
                            value={user.role || 'foreman'}
                            onChange={(e) =>
                              handleRoleChange(user.id, e.target.value as 'admin' | 'pm' | 'foreman')
                            }
                            disabled={isPending}
                            className={roleSelectClass}
                            aria-label={`บทบาทของ ${user.email || user.full_name || user.id}`}
                          >
                            <option value="admin">Admin</option>
                            <option value="pm">Project Manager</option>
                            <option value="foreman">Foreman</option>
                          </select>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
