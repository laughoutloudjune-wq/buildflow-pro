import { getPaymentVouchers } from '@/actions/procurement-actions'
import { getDashboardSession } from '@/lib/auth/route-access'
import PaymentsPageClient from './PaymentsPageClient'

export default async function PaymentsPage() {
  const { role } = await getDashboardSession()
  // Voiding stays PM/Admin only (the action enforces it); hide the button for
  // read-only viewers such as the accountant.
  const canVoid = role === 'admin' || role === 'pm'
  let vouchers: Awaited<ReturnType<typeof getPaymentVouchers>> = []
  let initialError: string | null = null
  try {
    vouchers = await getPaymentVouchers()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดใบสำคัญจ่ายไม่สำเร็จ'
  }

  return <PaymentsPageClient vouchers={vouchers} initialError={initialError} canVoid={canVoid} />
}
