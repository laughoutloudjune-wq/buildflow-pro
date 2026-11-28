import { redirect } from 'next/navigation'

/**
 * The payout cycle now lives in the bills inbox (รอจ่าย / จ่ายแล้ว tabs).
 * Old links, bookmarks and the dashboard's shortcuts keep working: this keeps
 * the same filters and lands on the matching tab. The printable summary route
 * (./print) is unchanged.
 */
export default async function ContractorCycleRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const params = new URLSearchParams()
  for (const key of ['projectId', 'contractorId', 'month']) {
    const v = sp[key]
    if (typeof v === 'string' && v) params.set(key, v)
  }
  params.set('tab', sp.tab === 'paid' ? 'paid' : 'pay')
  redirect(`/dashboard/billing?${params.toString()}`)
}
