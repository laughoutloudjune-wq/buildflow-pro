import type { UserRole } from '@/lib/types/billing'

export type PermissionModule = 'projects' | 'boq' | 'contractors' | 'foreman' | 'billing' | 'reports' | 'settings' | 'materials' | 'procurement' | 'cost_control' | 'sales'

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
    materials: true,
    procurement: true,
    cost_control: true,
    sales: true,
  },
  pm: {
    projects: true,
    boq: true,
    contractors: true,
    foreman: false,
    billing: true,
    reports: true,
    settings: false,
    materials: true,
    procurement: true,
    cost_control: true,
    sales: true,
  },
  foreman: {
    projects: true,
    boq: true,
    contractors: false,
    foreman: true,
    billing: false,
    reports: false,
    settings: false,
    materials: true,
    procurement: false,
    cost_control: false,
    sales: false,
  },
  // Bookkeeping/finance - sees the billing queue, cost reports and
  // procurement (POs/payments), not construction ops. No profile carries
  // this role yet (checked 2026-09-18); adjust freely from Settings once one
  // does, this is just a starting default rather than a fixed requirement.
  accountant: {
    projects: false,
    boq: false,
    contractors: false,
    foreman: false,
    billing: true,
    reports: true,
    settings: false,
    materials: false,
    procurement: true,
    cost_control: true,
    sales: false,
  },
  // Locked scope, SALES_MODULE_PLAN.md §6/§11 (D2): price, never build cost -
  // reaches the plot page through the 'sales' module instead of 'projects',
  // and gets none of the cost-bearing modules.
  sales: {
    projects: false,
    boq: false,
    contractors: false,
    foreman: false,
    billing: false,
    reports: false,
    settings: false,
    materials: false,
    procurement: false,
    cost_control: false,
    sales: true,
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
