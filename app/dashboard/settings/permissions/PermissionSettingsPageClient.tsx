'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { ArrowLeft, Info, Save } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button, ButtonLink } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { updateRolePermissions } from '@/actions/settings-actions'
import { type PermissionModule, type RolePermissions } from '@/lib/permissions'
import type { UserRole } from '@/lib/types/billing'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { TableFrame } from '@/components/ui/TableFrame'

const roleLabels: Record<UserRole, string> = {
  admin: 'Admin',
  pm: 'Project Manager',
  foreman: 'Foreman',
  accountant: 'Accountant',
  sales: 'Sales',
  sales_exec: 'Sales Exec',
}

const moduleLabels: Record<PermissionModule, { title: string; description: string }> = {
  projects: { title: 'โครงการ / แปลง', description: 'เข้าหน้าโครงการและจัดการเลขที่แปลง' },
  boq: { title: 'แบบบ้าน & BOQ', description: 'เข้าหน้าแบบบ้านและ BOQ' },
  contractors: { title: 'ผู้รับเหมา', description: 'ดูและจัดการผู้รับเหมา' },
  foreman: { title: 'งาน Foreman', description: 'สร้างคำขอ progress และ DC' },
  billing: { title: 'เบิกจ่าย (คิว PM)', description: 'เข้าคิวตรวจสอบและอนุมัติใบเบิก' },
  reports: { title: 'รายงาน', description: 'DC, ประวัติบ้าน, รอบจ่ายผู้รับเหมา' },
  settings: { title: 'ตั้งค่าระบบ', description: 'หน้าตั้งค่าและสิทธิ์' },
  materials: { title: 'วัสดุ (Material Log)', description: 'บันทึกและดูการใช้วัสดุเทียบกับ BOQ' },
  procurement: { title: 'จัดซื้อ', description: 'คำขอซื้อ ใบสั่งซื้อ ผู้จำหน่าย และการรับของ' },
  cost_control: { title: 'ควบคุมต้นทุน', description: 'เทียบ BOQ กับของที่ซื้อจริง และรายงานต้นทุนโครงการ' },
  sales: { title: 'ฝ่ายขาย', description: 'บอร์ดขาย ลูกค้า และคำขอจากฝ่ายขายถึงหน่วยงานก่อสร้าง' },
}

const permissionModules = Object.keys(moduleLabels) as PermissionModule[]
const roles = Object.keys(roleLabels) as UserRole[]

export default function PermissionSettingsPageClient({
  initialPermissions,
  initialError,
}: {
  initialPermissions: RolePermissions
  initialError?: string | null
}) {
  const [permissions, setPermissions] = useState<RolePermissions>(initialPermissions)
  const toast = useToast()
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

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
      const result = await updateRolePermissions(permissions)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success('บันทึกสิทธิ์การใช้งานเรียบร้อยแล้ว')
    })
  }

  return (
    <PageContainer width="standard">
      <PageHeader
        title="กำหนดการเข้าถึงโมดูล"
        subtitle="เลือกว่าแต่ละตำแหน่งเปิดเมนูและหน้าไหนได้ — ใช้คู่กับบทบาทผู้ใช้ในหน้า &quot;ผู้ใช้และบทบาท&quot;"
        actions={
          <>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href="/dashboard/settings" variant="secondary">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            กลับไปตั้งค่า
          </ButtonLink>
          <Button type="button" onClick={handleSave} disabled={isPending}>
            <Save className="h-4 w-4" aria-hidden />
            {isPending ? 'กำลังบันทึก...' : 'บันทึกสิทธิ์'}
          </Button>
        </div>
          </>
        }
      />


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
            <div className="text-xs font-medium text-slate-500">
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

      {/* Header row and the module column stay in view while scrolling the matrix. */}
      <TableFrame stickyHeader maxHeight="70vh">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className="left-0 z-[2] bg-slate-50 px-4 py-3 text-left text-xs font-semibold text-slate-600">
                  โมดูล
                </th>
                {roles.map((role) => (
                  <th key={role} className="px-4 py-3 text-center text-xs font-semibold text-slate-600">
                    {roleLabels[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissionModules.map((moduleKey) => (
                <tr key={moduleKey} className="hover:bg-slate-50/60">
                  <td className="sticky left-0 z-[1] bg-white px-4 py-4">
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
      </TableFrame>
    </PageContainer>
  )
}
