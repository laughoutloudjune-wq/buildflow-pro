// Same reasoning as PO_ERROR_TRANSLATIONS in actions/procurement/orders.ts -
// Next.js strips a thrown error's message in production, so the billing
// approve/reject/undo/delete/payout RPCs return `{ error }` instead, and
// their raw (English) exception text is mapped to Thai here before it
// reaches the toast.
const BILLING_ERROR_TRANSLATIONS: [string, string][] = [
  ['Not authenticated', 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง'],
  ['Billing not found', 'ไม่พบใบเบิกนี้'],
  ['Only PM/Admin can approve billing', 'เฉพาะ PM/Admin เท่านั้นที่สามารถอนุมัติใบเบิกได้'],
  ['Only PM/Admin can reject billing', 'เฉพาะ PM/Admin เท่านั้นที่สามารถปฏิเสธใบเบิกได้'],
  ['Only PM/Admin can undo approve', 'เฉพาะ PM/Admin เท่านั้นที่สามารถย้อนสถานะอนุมัติได้'],
  ['Only a billing pending review can be approved', 'อนุมัติได้เฉพาะใบเบิกที่อยู่ในสถานะรอตรวจสอบเท่านั้น'],
  ['Only a billing pending review can be rejected', 'ปฏิเสธได้เฉพาะใบเบิกที่อยู่ในสถานะรอตรวจสอบเท่านั้น'],
  ['Only approved billing can be reverted', 'ย้อนสถานะอนุมัติได้เฉพาะใบเบิกที่อนุมัติแล้วเท่านั้น'],
  [
    'Cannot undo approval - this billing has already been paid out, unmark the payout first',
    'ย้อนสถานะอนุมัติไม่ได้ เนื่องจากจ่ายเงินให้ผู้รับเหมาแล้ว กรุณายกเลิกการจ่ายเงินก่อน',
  ],
  [
    'Cannot delete - this billing has already been paid out, unmark the payout first',
    'ลบไม่ได้ เนื่องจากจ่ายเงินให้ผู้รับเหมาแล้ว กรุณายกเลิกการจ่ายเงินก่อน',
  ],
  ['Only PM/Admin can delete approved billing', 'เฉพาะ PM/Admin เท่านั้นที่สามารถลบใบเบิกที่อนุมัติแล้วได้'],
  ['No permission to delete this billing', 'คุณไม่มีสิทธิ์ลบใบเบิกนี้'],
  ['Only PM/Admin/Accountant can mark billings as paid out', 'เฉพาะ PM/Admin/บัญชีเท่านั้นที่สามารถบันทึกการจ่ายเงินได้'],
  ['Only PM/Admin/Accountant can unmark paid out', 'เฉพาะ PM/Admin/บัญชีเท่านั้นที่สามารถยกเลิกการจ่ายเงินได้'],
  ['One or more billings are not approved or are already paid out', 'มีรายการที่ยังไม่อนุมัติหรือจ่ายเงินไปแล้ว กรุณาโหลดรายการใหม่'],
  ['No billing IDs provided', 'กรุณาเลือกรายการ'],
]

export function translateBillingError(message: string): string {
  return BILLING_ERROR_TRANSLATIONS.find(([needle]) => message.includes(needle))?.[1] || message
}
