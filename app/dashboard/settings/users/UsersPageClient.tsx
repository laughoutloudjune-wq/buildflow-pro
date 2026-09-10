'use client'

import { useEffect, useState, useTransition } from 'react'
import { ArrowLeft, Users } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button, ButtonLink } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { updateUserRole, updateUserFullName } from '@/actions/settings-actions'
import type { getUsers } from '@/actions/settings-actions'
import { generateInviteLink } from '@/actions/invite-actions'

type User = Awaited<ReturnType<typeof getUsers>>[0]

const roleSelectClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50'

const nameInputClass =
  'w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-medium text-slate-900 hover:border-slate-200 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50'

export default function UsersPageClient({
  initialUsers,
  initialError,
}: {
  initialUsers: User[]
  initialError?: string | null
}) {
  const [users, setUsers] = useState<User[]>(initialUsers)
  const [isPending, startTransition] = useTransition()
  // Local text while a name is being typed, keyed by user id - lets the
  // input hold an in-progress edit without touching `users` (and thus the
  // rest of the row) until the blur-triggered save actually lands.
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({})
  const [savingNameFor, setSavingNameFor] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [generatingLink, setGeneratingLink] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

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

  function handleNameBlur(user: User) {
    const draft = nameDrafts[user.id]
    if (draft === undefined) return
    const trimmed = draft.trim()
    setNameDrafts((prev) => {
      const next = { ...prev }
      delete next[user.id]
      return next
    })
    if (!trimmed || trimmed === (user.full_name || '')) return

    setSavingNameFor(user.id)
    updateUserFullName(user.id, trimmed)
      .then(() => {
        setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, full_name: trimmed } : u)))
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'เปลี่ยนชื่อไม่สำเร็จ'))
      .finally(() => setSavingNameFor(null))
  }

  async function handleGenerateLink() {
    if (!inviteEmail.trim()) {
      toast.error('กรุณาใส่อีเมล')
      return
    }
    setGeneratingLink(true)
    setInviteLink('')
    try {
      setInviteLink(await generateInviteLink(inviteEmail.trim()))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'สร้างลิงก์ไม่สำเร็จ')
    } finally {
      setGeneratingLink(false)
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink)
      toast.success('คัดลอกลิงก์แล้ว')
    } catch {
      toast.error('คัดลอกไม่สำเร็จ ลองเลือกข้อความแล้วคัดลอกเอง')
    }
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
        <h2 className="text-sm font-semibold text-slate-900">เชิญผู้ใช้ใหม่</h2>
        <p className="mt-1 text-sm text-slate-500">
          สร้างลิงก์แล้วส่งเองผ่านแชท (Line, WhatsApp ฯลฯ) แทนอีเมล ใช้เมื่ออีเมลเชิญของระบบถูกจำกัดโควต้า
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="email@example.com"
            className="w-full flex-1"
          />
          <Button type="button" onClick={handleGenerateLink} disabled={generatingLink} className="shrink-0">
            {generatingLink ? 'กำลังสร้างลิงก์...' : 'สร้างลิงก์เชิญ'}
          </Button>
        </div>
        {inviteLink ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              readOnly
              value={inviteLink}
              onFocus={(e) => e.target.select()}
              className="w-full flex-1 text-xs text-slate-500"
            />
            <Button type="button" variant="secondary" onClick={handleCopyLink} className="shrink-0">
              คัดลอกลิงก์
            </Button>
          </div>
        ) : null}
      </Card>

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
                      <td className="px-2 py-1.5">
                        <input
                          value={nameDrafts[user.id] ?? user.full_name ?? ''}
                          onChange={(e) => setNameDrafts((prev) => ({ ...prev, [user.id]: e.target.value }))}
                          onBlur={() => handleNameBlur(user)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur()
                          }}
                          disabled={savingNameFor === user.id}
                          placeholder="ระบุชื่อ"
                          className={nameInputClass}
                          aria-label={`ชื่อของ ${user.email || user.id}`}
                        />
                      </td>
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
