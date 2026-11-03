import type { CombineDraft } from '@/lib/procurement/combineDraft'
import type { DocRef, WorkData, WorkIndex } from '@/lib/procurement/workQueue'
import type { DocPosition } from './docUi'

/** What each document window gets from the งานจัดซื้อ page. */
export type DocCtx = {
  data: WorkData
  ix: WorkIndex
  today: string
  /** Open a related document on top of this one ("‹ กลับ" returns). */
  go: (ref: DocRef) => void
  back: (() => void) | null
  backLabel: string | null
  close: () => void
  /** Reload the lists after something changed. */
  refresh: () => void
  position: DocPosition | null
  /** Move to the next waiting document of the same stage (after an approval). */
  advance: () => boolean
  /** Open the "new order" window, from a prepared draft of request lines. */
  startPo: (draft: CombineDraft) => void
  receive: (poId: string) => void
  pay: (receiptIds: string[]) => void
  editPo: (poId: string) => void
  /** A row's "ออกใบสั่งซื้อ" button opens the request and goes straight to the order. */
  autoOrderId: string | null
  clearAutoOrder: () => void
}
