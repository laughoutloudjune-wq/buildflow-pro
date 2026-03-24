'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { ArrowLeft, Save, ShieldCheck } from 'lucide-react'
import { Card } from '@/components/ui/Card'
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
  projects: { title: 'Projects / Plots', description: 'เข้าหน้าโครงการและจัดการเลขที่แปลง' },
  boq: { title: 'House Types / BOQ', description: 'เข้าหน้าแบบบ้านและ BOQ' },
  contractors: { title: 'Contractors', description: 'ดูและจัดการผู้รับเหมา' },
  foreman: { title: 'Foreman Workflow', description: 'สร้างคำขอ progress และ DC' },
  billing: { title: 'Billing Review', description: 'เข้าคิวตรวจสอบและอนุมัติใบเบิก' },
  reports: { title: 'Reports', description: 'ดูรายงาน DC, house history และ contractor cycle' },
  settings: { title: 'Settings', description: 'เข้าหน้าตั้งค่าระบบ' },
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
    return <div className="p-6 text-slate-500">กำลังโหลดสิทธิ์การใช้งาน...</div>
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <ShieldCheck className="h-4 w-4" />
            Role Permissions
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Permission Settings</h1>
          <p className="text-sm text-slate-500">กำหนดว่าแต่ละตำแหน่งเข้าหน้าไหนได้บ้างในระบบ</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/settings" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
            กลับไปหน้าตั้งค่า
          </Link>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {isPending ? 'กำลังบันทึก...' : 'บันทึกสิทธิ์'}
          </button>
        </div>
      </div>

      {notice ? <NoticeBanner tone={notice.tone} message={notice.message} onClose={() => setNotice(null)} /> : null}

      <div className="grid gap-4 md:grid-cols-3">
        {summary.map((item) => (
          <Card key={item.role} className="p-4">
            <div className="text-sm text-slate-500">{roleLabels[item.role]}</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{item.count}</div>
            <div className="text-sm text-slate-500">modules enabled</div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Module</th>
                {roles.map((role) => (
                  <th key={role} className="px-4 py-3 text-center font-semibold text-slate-700">
                    {roleLabels[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {permissionModules.map((moduleKey) => (
                <tr key={moduleKey}>
                  <td className="px-4 py-4">
                    <div className="font-medium text-slate-900">{moduleLabels[moduleKey].title}</div>
                    <div className="text-xs text-slate-500">{moduleLabels[moduleKey].description}</div>
                  </td>
                  {roles.map((role) => (
                    <td key={`${moduleKey}-${role}`} className="px-4 py-4 text-center">
                      <label className="inline-flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={permissions[role][moduleKey]}
                          onChange={() => togglePermission(role, moduleKey)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
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
