import { getPaymentVouchers } from '@/actions/procurement-actions'
import PaymentsPageClient from './PaymentsPageClient'

export default async function PaymentsPage() {
  let vouchers: Awaited<ReturnType<typeof getPaymentVouchers>> = []
  let initialError: string | null = null
  try {
    vouchers = await getPaymentVouchers()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดใบสำคัญจ่ายไม่สำเร็จ'
  }

  return <PaymentsPageClient vouchers={vouchers} initialError={initialError} />
}
