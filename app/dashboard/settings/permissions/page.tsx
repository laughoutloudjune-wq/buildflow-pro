import { getRolePermissions } from '@/actions/settings-actions'
import { DEFAULT_ROLE_PERMISSIONS, type RolePermissions } from '@/lib/permissions'
import PermissionSettingsPageClient from './PermissionSettingsPageClient'

export default async function PermissionSettingsPage() {
  let permissions: RolePermissions = DEFAULT_ROLE_PERMISSIONS
  let initialError: string | null = null
  try {
    permissions = await getRolePermissions()
  } catch (error) {
    console.error('Failed to load permissions:', error)
    initialError = 'โหลดสิทธิ์การใช้งานไม่สำเร็จ ใช้ค่าเริ่มต้นชั่วคราว'
  }

  return <PermissionSettingsPageClient initialPermissions={permissions} initialError={initialError} />
}
