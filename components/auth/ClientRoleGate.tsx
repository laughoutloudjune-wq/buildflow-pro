'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { getCurrentViewerPermissions, getCurrentViewerRole } from '@/actions/auth-actions'
import type { PermissionModule } from '@/lib/permissions'
import type { UserRole } from '@/lib/types/billing'

type ClientRoleGateProps = {
  allowedRoles?: UserRole[]
  moduleKey?: PermissionModule
  fallbackHref?: string
}

export default function ClientRoleGate({
  allowedRoles,
  moduleKey,
  fallbackHref = '/dashboard',
}: ClientRoleGateProps) {
  const router = useRouter()
  const [isChecking, setIsChecking] = useState(true)

  useEffect(() => {
    let mounted = true

    const check = moduleKey ? getCurrentViewerPermissions() : getCurrentViewerRole()

    check
      .then((result) => {
        if (!mounted) return

        if (moduleKey) {
          const permissions = result as Record<PermissionModule, boolean> | null
          if (!permissions?.[moduleKey]) {
            router.replace(fallbackHref)
            return
          }
          setIsChecking(false)
          return
        }

        const role = result as UserRole | null
        if (!role || !allowedRoles?.includes(role)) {
          router.replace(fallbackHref)
          return
        }
        setIsChecking(false)
      })
      .catch(() => {
        if (!mounted) return
        router.replace(fallbackHref)
      })

    return () => {
      mounted = false
    }
  }, [allowedRoles, fallbackHref, moduleKey, router])

  if (!isChecking) return null

  return (
    <div className="flex min-h-[160px] items-center justify-center rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        กำลังตรวจสอบสิทธิ์...
      </div>
    </div>
  )
}
