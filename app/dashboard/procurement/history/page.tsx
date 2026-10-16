import { getRecentDocumentHistory } from '@/actions/procurement/history'
import HistoryPageClient from './HistoryPageClient'

export default async function ProcurementHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ only?: string }>
}) {
  const { only } = await searchParams
  const onlyDestructive = only === 'destructive'
  const result = await getRecentDocumentHistory({ onlyDestructive })

  return (
    <HistoryPageClient
      entries={'error' in result ? [] : result}
      initialError={'error' in result ? result.error : null}
      onlyDestructive={onlyDestructive}
    />
  )
}
