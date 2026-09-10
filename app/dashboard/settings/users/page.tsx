import { getUsers } from '@/actions/settings-actions'
import UsersPageClient from './UsersPageClient'

export default async function UsersPage() {
  let users: Awaited<ReturnType<typeof getUsers>> = []
  let initialError: string | null = null
  try {
    users = await getUsers()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ'
  }

  return <UsersPageClient initialUsers={users} initialError={initialError} />
}
