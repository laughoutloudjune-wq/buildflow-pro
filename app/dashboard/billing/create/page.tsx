import { redirect } from 'next/navigation'

export default function LegacyBillingCreateRedirect() {
  redirect('/dashboard/billing/request')
}
