import { getSignatureSlots } from '@/actions/signature-slots-actions'
import SignatureSettingsPageClient from './SignatureSettingsPageClient'

const DEFAULT_TAB = 'purchase_request' as const

export default async function SignatureSettingsPage() {
  let initialSlots: Awaited<ReturnType<typeof getSignatureSlots>> = []
  let initialError: string | null = null
  try {
    initialSlots = await getSignatureSlots(DEFAULT_TAB)
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลลายเซ็นไม่สำเร็จ'
  }

  return <SignatureSettingsPageClient initialTab={DEFAULT_TAB} initialSlots={initialSlots} initialError={initialError} />
}
