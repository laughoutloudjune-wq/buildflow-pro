'use client'

import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import PurchaseOrderForm from '@/components/procurement/PurchaseOrderForm'

function CreatePurchaseOrderInner() {
  const searchParams = useSearchParams()
  const fromRequestId = searchParams.get('fromRequest')
  return <PurchaseOrderForm mode="create" fromRequestId={fromRequestId} />
}

export default function CreatePurchaseOrderPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        </div>
      }
    >
      <CreatePurchaseOrderInner />
    </Suspense>
  )
}
