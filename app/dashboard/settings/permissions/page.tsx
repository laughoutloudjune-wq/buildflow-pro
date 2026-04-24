'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { ArrowLeft, Info, Save, ShieldCheck } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import PageLoading from '@/components/ui/PageLoading'
import NoticeBanner from '@/components/ui/NoticeBanner'
import { getRolePermissions, updateRolePermissions } from '@/actions/settings-actions'
import { DEFAULT_ROLE_PERMISSIONS, type PermissionModule, type RolePermissions } from '@/lib/permissions'
import type { UserRole } from '@/lib/types/billing'

const roleLabels: Record<UserRole, string> = {
  admin: 'Admin',
  pm: 'Project Manager',
  foreman: 'Foreman',
}

const moduleLabels: Record<PermissionModule, { title: string; description: string }> = {
  projects: { title: 'โครงการ / แปลง', description: 'เข้าหน้าโครงการและจัดการเลขที่แปลง' },
  boq: { title: 'แบบบ้าน & BOQ', description: 'เข้าหน้าแบบบ้านและ BOQ' },
  contractors: { title: 'ผู้รับเหมา', description: 'ดูและจัดการผู้รับเหมา' },
  foreman: { title: 'งาน Foreman', description: 'สร้างคำขอ progress และ DC' },
  billing: { title: 'เบิกจ่าย (คิว PM)', description: 'เข้าคิวตรวจสอบและอนุมัติใบเบิก' },
  reports: { title: 'รายงาน', description: 'DC, ประวัติบ้าน, รอบจ่ายผู้รับเหมา' },
  settings: { title: 'ตั้งค่าระบบ', description: 'หน้าตั้งค่าและสิทธิ์' },
}

const permissionModules = Object.keys(moduleLabels) as PermissionModule[]
const roles = Object.keys(roleLabels) as UserRole[]

export default function PermissionSettingsPage() {
  const [permissions, setPermissions] = useState<RolePermissions>(DEFAULT_ROLE_PERMISSIONS)
  const [isLoading, setIsLoading] = useState(true)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    async function loadPermissions() {
      try {
        setPermissions(await getRolePermissions())
      } catch (error) {
        console.error('Failed to load permissions:', error)
        setNotice({ tone: 'error', message: 'โหลดสิทธิ์การใช้งานไม่สำเร็จ ใช้ค่าเริ่มต้นชั่วคราว' })
      } finally {
        setIsLoading(false)
      }
    }
    void loadPermissions()
  }, [])

  const summary = useMemo(() => {
    return roles.map((role) => ({
      role,
      count: permissionModules.filter((moduleKey) => permissions[role][moduleKey]).length,
      total: permissionModules.length,
    }))
  }, [permissions])

  const togglePermission = (role: UserRole, moduleKey: PermissionModule) => {
    setPermissions((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [moduleKey]: !prev[role][moduleKey],
      },
    }))
  }

  const handleSave = () => {
    startTransition(async () => {
      setNotice(null)
      try {
        await updateRolePermissions(permissions)
        setNotice({ tone: 'success', message: 'บันทึกสิทธิ์การใช้งานเรียบร้อยแล้ว' })
      } catch (error) {
        setNotice({
          tone: 'error',
          message: error instanceof Error ? error.message : 'บันทึกสิทธิ์การใช้งานไม่สำเร็จ',
        })
      }
    })
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-2 sm:px-0">
        <PageLoading label="กำลังโหลดสิทธิ์การใช้งาน..." />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-indigo-600">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            สิทธิ์ตามบทบาท
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">กำหนดการเข้าถึงโมดูล</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            เลือกว่าแต่ละตำแหน่งเปิดเมนูและหน้าไหนได้ — ใช้คู่กับบทบาทผู้ใช้ในหน้า &quot;ผู้ใช้และบทบาท&quot;
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/dashboard/settings"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            กลับไปตั้งค่า
          </Link>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
          >
            <Save className="h-4 w-4" aria-hidden />
            {isPending ? 'กำลังบันทึก...' : 'บันทึกสิทธิ์'}
          </button>
        </div>
      </div>

      {notice ? <NoticeBanner tone={notice.tone} message={notice.message} onClose={() => setNotice(null)} /> : null}

      <Card className="flex gap-3 border-sky-100 bg-sky-50/80 p-4 shadow-sm">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
          <Info className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 text-sm text-sky-950">
          <p className="font-semibold">เกี่ยวกับการอนุมัติใบเบิก</p>
          <p className="mt-1 text-sky-900/90">
            การเปิดโมดูล &quot;เบิกจ่าย&quot; ให้ผู้ใช้เท่ากับให้เข้าหน้าคิวได้ — การอนุมัติ / ปฏิเสธ / ทำเครื่องหมายจ่ายแล้วยังถูกจำกัดที่บทบาท PM หรือ Admin ในโค้ดระบบ
          </p>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {summary.map((item) => (
          <Card key={item.role} className="border-slate-200 p-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {roleLabels[item.role]}
            </div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-2xl font-bold text-slate-900">{item.count}</span>
              <span className="text-sm text-slate-500">/ {item.total} โมดูล</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">เปิดใช้งานในเมนูหลัก</div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  โมดูล
                </th>
                {roles.map((role) => (
                  <th key={role} className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {roleLabels[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {permissionModules.map((moduleKey) => (
                <tr key={moduleKey} className="hover:bg-slate-50/60">
                  <td className="px-4 py-4">
                    <div className="font-medium text-slate-900">{moduleLabels[moduleKey].title}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{moduleLabels[moduleKey].description}</div>
                  </td>
                  {roles.map((role) => (
                    <td key={`${moduleKey}-${role}`} className="px-4 py-4 text-center">
                      <label className="inline-flex cursor-pointer items-center justify-center rounded-lg p-1 hover:bg-slate-100">
                        <input
                          type="checkbox"
                          checked={permissions[role][moduleKey]}
                          onChange={() => togglePermission(role, moduleKey)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          aria-label={`${roleLabels[role]} — ${moduleLabels[moduleKey].title}`}
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
