/**
 * Handover plan Phase 5.2 (L-17): one shared status label/color map for PO,
 * PR and billing status, replacing the copies that had drifted apart across
 * PurchaseOrdersPageClient/PurchaseOrderDetailPageClient (list showed PO
 * "sent" as green and "received" as indigo, the detail page had them
 * swapped), PurchaseRequestDetail/PurchaseRequestsPageClient (plain
 * duplication, values already agreed), and BillingPageClient/
 * ForemanHistoryPageClient (three different Thai words for "rejected":
 * "ไม่อนุมัติ", "ปฏิเสธ", "ถูกปฏิเสธ"). This file is now the one place those
 * labels/colors are decided - PR/PO/billing detail all import from here.
 */
import type { PurchaseOrderStatus, PurchaseRequestStatus } from '@/lib/types/procurement'
import type { BillingStatus } from '@/lib/types/billing'

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'ร่าง',
  sent: 'ยืนยันสั่งซื้อ',
  partially_received: 'รับของบางส่วน',
  received: 'รับของแล้ว',
  paid: 'ชำระแล้ว',
  cancelled: 'ยกเลิก',
}

/** Single bg+text pill class, for a status rendered as its own colored span. */
export const PO_STATUS_TONE: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-slate-100 text-slate-500',
  sent: 'bg-indigo-50 text-indigo-700',
  partially_received: 'bg-amber-50 text-amber-700',
  received: 'bg-emerald-50 text-emerald-700',
  paid: 'bg-violet-50 text-violet-700',
  cancelled: 'bg-red-50 text-red-700',
}

/** Small solid dot color, for the list page's compact status indicator. */
export const PO_STATUS_DOT: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-slate-400',
  sent: 'bg-indigo-500',
  partially_received: 'bg-amber-500',
  received: 'bg-emerald-500',
  paid: 'bg-violet-500',
  cancelled: 'bg-red-500',
}

/** Text color paired with PO_STATUS_DOT - same family, on-white shade. */
export const PO_STATUS_TEXT: Record<PurchaseOrderStatus, string> = {
  draft: 'text-slate-500',
  sent: 'text-indigo-700',
  partially_received: 'text-amber-700',
  received: 'text-emerald-700',
  paid: 'text-violet-700',
  cancelled: 'text-red-600',
}

export const PR_STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  pending_review: 'รอตรวจสอบ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ปฏิเสธ',
  ordered: 'สั่งซื้อแล้ว',
  received: 'รับของครบ',
  cancelled: 'ยกเลิก',
}

export const PR_STATUS_TONE: Record<PurchaseRequestStatus, string> = {
  pending_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-indigo-50 text-indigo-700',
  rejected: 'bg-red-50 text-red-700',
  ordered: 'bg-violet-50 text-violet-700',
  received: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
}

export const BILLING_STATUS_LABEL: Record<BillingStatus, string> = {
  draft: 'ฉบับร่าง',
  pending_review: 'รอตรวจสอบ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ปฏิเสธ',
}

/** Semantic Badge tone names (components/ui/Badge.tsx), not raw classes -
 * billing statuses render through <Badge tone=...> everywhere, unlike PO/PR
 * which use their own custom pill spans. */
export const BILLING_STATUS_TONE: Record<BillingStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  draft: 'neutral',
  pending_review: 'warning',
  approved: 'success',
  rejected: 'danger',
}
