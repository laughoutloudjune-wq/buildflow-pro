'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center text-slate-500">
      <AlertTriangle className="h-8 w-8 text-red-500" />
      <p className="text-sm font-medium text-slate-700">เกิดข้อผิดพลาดในการโหลดข้อมูล</p>
      <Button type="button" onClick={() => reset()}>
        <RefreshCw className="h-4 w-4" /> ลองใหม่
      </Button>
    </div>
  )
}
