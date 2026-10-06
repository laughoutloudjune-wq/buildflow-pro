import type { TransferRequestStatus } from '@/actions/transfer-requests'

export const TR_STATUS_LABEL: Record<TransferRequestStatus, string> = {
  draft: 'ร่าง',
  submitted: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  done: 'โอนเสร็จสิ้น',
  rejected: 'ไม่อนุมัติ',
}

export const TR_STATUS_TONE: Record<TransferRequestStatus, 'neutral' | 'warning' | 'success' | 'danger' | 'info'> = {
  draft: 'neutral',
  submitted: 'warning',
  approved: 'info',
  done: 'success',
  rejected: 'danger',
}
