'use client'

import { useEffect, useState, useTransition } from 'react'
import { ArrowLeft, Users } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { ButtonLink } from '@/components/ui/Button'
import PageLoading from '@/components/ui/PageLoading'
import { useToast } from '@/components/ui/Toast'
import { getUsers, updateUserRole } from '@/actions/settings-actions'

type User = Awaited<ReturnType<typeof getUsers>>[0]

const roleSelectClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50'

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const toast = useToast()

  useEffect(() => {
    void (async () => {
      try {
        setUsers(await getUsers())
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ')
      } finally {
        setIsLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleRoleChange(userId: string, newRole: 'admin' | 'pm' | 'foreman') {
    startTransition(async () => {
      try {
        await updateUserRole(userId, newRole)
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)))
        const target = users.find((u) => u.id === userId)
        toast.success(`อัปเดตบทบาทแล้ว: ${target?.email || target?.full_name || userId}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'อัปเดตบทบาทไม่สำเร็จ')
      }
    })
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-2 sm:px-0">
        <PageLoading label="กำลังโหลดข้อมูล..." />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-indigo-600">
            <Users className="h-4 w-4" aria-hidden />
            ผู้ใช้และบทบาท
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">ผู้ใช้งานระบบ</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            บทบาทหลัก (Admin / PM / Foreman) ใช้ร่วมกับเมทริกซ์สิทธิ์ในเมนู &quot;สิทธิ์ตามบทบาท&quot;
          </p>
        </div>
        <ButtonLink href="/dashboard/settings" variant="secondary">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          กลับไปตั้งค่า
        </ButtonLink>
      </div>

      <Card className="border-slate-200 p-6 shadow-sm">
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">ชื่อ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">อีเมล</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">บทบาท</th>
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
                      <td className="whitespace-nowrap px-4 py-3.5 font-medium text-slate-900">{user.full_name || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-slate-600">{user.email || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <select
                          value={user.role || 'foreman'}
                          onChange={(e) => handleRoleChange(user.id, e.target.value as 'admin' | 'pm' | 'foreman')}
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
    </div>
  )
}
