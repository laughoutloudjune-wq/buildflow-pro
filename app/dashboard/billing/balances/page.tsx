import { redirect } from 'next/navigation'

/**
 * ยอดคงเหลือผู้รับเหมา is now each contractor's "งานที่ถือ" tab (value, paid,
 * left, per plot). The list of contractors is the way in.
 */
export default function ContractorBalancesRedirect() {
  redirect('/dashboard/contractors')
}
