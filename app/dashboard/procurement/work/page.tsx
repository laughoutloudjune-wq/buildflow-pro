import { redirect } from 'next/navigation'

// งานจัดซื้อ now lives on คำขอซื้อ (PR). Old links and bookmarks keep working.
export default async function ProcurementWorkRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') query.set(key, value)
  }
  const qs = query.toString()
  redirect(`/dashboard/procurement/requests${qs ? `?${qs}` : ''}`)
}
