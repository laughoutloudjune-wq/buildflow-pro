'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ForemanHomePage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/dashboard/foreman/create-progress')
  }, [router])

  return null
}
