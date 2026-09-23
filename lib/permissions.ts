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
  // Contractor payments only (W-02/M-02, June's answer 2026-09-23): the
  // payment cycle page (reads/pays via `billing`) and the billing list
  // read-only. No procurement, no cost control, no other reports - `reports`
  // stays false so dc-history/house-history/labor-budget don't open for
  // this role; the reports layout also allows `billing` through so
  // contractor-cycle specifically still does. Adjust freely from Settings if
  // a real accountant profile needs something different.
  accountant: {
    projects: false,
    boq: false,
    contractors: false,
    foreman: false,
    billing: true,
    reports: false,
    settings: false,
    materials: false,
    procurement: false,
    cost_control: false,
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
