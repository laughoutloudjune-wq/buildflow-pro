'use client'

import { createContext, useContext, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { DEFAULT_THEME, getDepartmentForViewer, type DepartmentTheme } from '@/lib/navigation'
import type { PermissionModule } from '@/lib/permissions'

type Permissions = Record<PermissionModule, boolean>

const PermissionsContext = createContext<Permissions | null>(null)

/** Lets any component under the dashboard shell resolve the current route's
 * department (and accent theme) without prop drilling. */
export function DepartmentProvider({ permissions, children }: { permissions: Permissions; children: React.ReactNode }) {
  return <PermissionsContext.Provider value={permissions}>{children}</PermissionsContext.Provider>
}

export type CurrentDepartment = { label: string | null; theme: DepartmentTheme }

/** The department that owns the current route, for the current viewer. The
 * overview and any route outside the dashboard resolve to the indigo default. */
export function useDepartment(): CurrentDepartment {
  const pathname = usePathname()
  const permissions = useContext(PermissionsContext)
  return useMemo(() => {
    const dept = permissions ? getDepartmentForViewer(pathname, permissions) : null
    return { label: dept?.label ?? null, theme: dept?.theme ?? DEFAULT_THEME }
  }, [pathname, permissions])
}
