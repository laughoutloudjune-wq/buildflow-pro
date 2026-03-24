import type { UserRole } from '@/lib/types/billing'

export type PermissionModule = 'projects' | 'boq' | 'contractors' | 'foreman' | 'billing' | 'reports' | 'settings'

export type RolePermissions = Record<UserRole, Record<PermissionModule, boolean>>

export const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  admin: {
    projects: true,
    boq: true,
    contractors: true,
    foreman: true,
    billing: true,
    reports: true,
    settings: true,
  },
  pm: {
    projects: true,
    boq: true,
    contractors: true,
    foreman: false,
    billing: true,
    reports: true,
    settings: false,
  },
  foreman: {
    projects: true,
    boq: true,
    contractors: false,
    foreman: true,
    billing: false,
    reports: false,
    settings: false,
  },
}

const permissionModules = Object.keys(DEFAULT_ROLE_PERMISSIONS.admin) as PermissionModule[]
const userRoles = Object.keys(DEFAULT_ROLE_PERMISSIONS) as UserRole[]

export function normalizeRolePermissions(input: unknown): RolePermissions {
  const parsed = typeof input === 'object' && input !== null ? input as Partial<RolePermissions> : {}

  return userRoles.reduce((rolesAcc, role) => {
    const nextRolePermissions = (parsed[role] || {}) as Partial<Record<PermissionModule, boolean>>
    rolesAcc[role] = permissionModules.reduce((moduleAcc, moduleKey) => {
      moduleAcc[moduleKey] =
        typeof nextRolePermissions[moduleKey] === 'boolean'
          ? nextRolePermissions[moduleKey] as boolean
          : DEFAULT_ROLE_PERMISSIONS[role][moduleKey]
      return moduleAcc
    }, {} as Record<PermissionModule, boolean>)
    return rolesAcc
  }, {} as RolePermissions)
}

export function getPermissionsForRole(role: UserRole, permissions: RolePermissions) {
  return permissions[role] || DEFAULT_ROLE_PERMISSIONS[role]
}

export function canRoleAccessModule(role: UserRole, moduleKey: PermissionModule, permissions: RolePermissions) {
  return Boolean(getPermissionsForRole(role, permissions)[moduleKey])
}
