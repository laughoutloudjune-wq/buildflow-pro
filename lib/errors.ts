// Handover plan Phase 5.1 (H-09): Next.js strips a thrown error's message
// across the server-action boundary in production, replacing it with a
// generic "An error occurred in the Server Components render" - which is
// why every server action that can be refused for an expected, meaningful
// reason (already paid, wrong status, missing permission, ...) needs to
// return `{ error }` as normal data instead of throwing. This is the one
// shared English-to-Thai map for those refusal messages, merging what used
// to be separate PO_/PR_/PP_/BILLING_ERROR_TRANSLATIONS arrays scattered
// across actions/procurement/*.ts and actions/billing/*.ts.
//
// Message text is matched by substring (`includes`), not exact equality -
// the raw exception text a Postgres RPC raises often carries extra context
// (a detail suffix, a quoted value) around the fixed part translated here.
const ERROR_TRANSLATIONS: [string, string][] = [
  // Cross-cutting
  ['Not authenticated', 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง'],

  // Purchase orders
  ['Cannot edit a purchase order that has already been paid or cancelled', 'ไม่สามารถแก้ไขใบสั่งซื้อนี้ได้ เนื่องจากชำระเงินแล้วหรือถูกยกเลิกไปแล้ว'],
  ['Cannot remove a line that already has goods received - reduce its quantity instead', 'ลบรายการนี้ไม่ได้ เนื่องจากมีการรับของแล้ว กรุณาลดจำนวนแทนการลบ'],
  ['Cannot set ordered quantity below the quantity already received', 'ระบุจำนวนสั่งซื้อน้อยกว่าจำนวนที่รับแล้วไม่ได้'],
  ['Branch does not belong to this supplier', 'สาขาที่เลือกไม่ได้อยู่กับผู้จำหน่ายรายนี้ กรุณาเลือกสาขาใหม่'],
  ['Choose either a single plot or a plot group, not both', 'กรุณาเลือกแปลงเดียวหรือกลุ่มแปลงอย่างใดอย่างหนึ่งเท่านั้น'],
  ['A reason is required when marking a purchase order outside BOQ', 'กรุณาระบุเหตุผลเมื่อทำเครื่องหมายว่าเป็นการซื้อนอก BOQ'],
  ['Purchase order not found', 'ไม่พบใบสั่งซื้อนี้'],
  ['Only PM/Admin can edit a purchase order', 'เฉพาะ PM/Admin เท่านั้นที่สามารถแก้ไขใบสั่งซื้อได้'],
  ['Only PM/Admin can create a purchase order', 'เฉพาะ PM/Admin เท่านั้นที่สามารถสร้างใบสั่งซื้อได้'],
  ['Only PM/Admin can change purchase order status', 'เฉพาะ PM/Admin เท่านั้นที่สามารถเปลี่ยนสถานะใบสั่งซื้อได้'],
  ['Only PM/Admin can cancel a purchase order', 'เฉพาะ PM/Admin เท่านั้นที่สามารถยกเลิกใบสั่งซื้อได้'],
  ['Only PM/Admin can mark a purchase order as received', 'เฉพาะ PM/Admin เท่านั้นที่สามารถทำเครื่องหมายว่ารับของแล้วได้'],
  ['Only PM/Admin can unmark a purchase order as received', 'เฉพาะ PM/Admin เท่านั้นที่สามารถยกเลิกการรับของได้'],
  ['Only PM/Admin can delete a purchase order', 'เฉพาะ PM/Admin เท่านั้นที่สามารถลบใบสั่งซื้อได้'],
  ['Only PM/Admin can duplicate a purchase order', 'เฉพาะ PM/Admin เท่านั้นที่สามารถคัดลอกใบสั่งซื้อได้'],
  ['Cannot cancel a purchase order that already has goods received', 'ยกเลิกใบสั่งซื้อนี้ไม่ได้ เนื่องจากมีการรับของแล้ว'],
  ['Cannot delete a purchase order that has already been received or paid', 'ลบใบสั่งซื้อนี้ไม่ได้ เนื่องจากรับของหรือชำระเงินไปแล้ว'],
  ['Cannot delete a purchase order that already has goods received', 'ลบใบสั่งซื้อนี้ไม่ได้ เนื่องจากมีการรับของแล้ว'],
  ['Only a purchase order that has already received something can have its receiving undone', 'ยกเลิกการรับของได้เฉพาะใบสั่งซื้อที่มีการรับของแล้วเท่านั้น'],
  [
    "Cannot undo receiving - a payment has already been recorded against one of this order's receipts",
    'ยกเลิกการรับของไม่ได้ เนื่องจากมีการบันทึกจ่ายเงินสำหรับใบรับสินค้านี้แล้ว กรุณายกเลิกใบสำคัญจ่ายก่อน',
  ],
  [
    'Cannot undo receiving - some of the received material has already been withdrawn or used elsewhere',
    'ยกเลิกการรับของไม่ได้ เนื่องจากวัสดุบางส่วนถูกเบิกใช้ไปแล้ว กรุณายกเลิกการเบิกนั้นก่อน',
  ],
  ['Only PM/Admin can close a purchase order', 'เฉพาะ PM/Admin เท่านั้นที่สามารถปิดใบสั่งซื้อได้'],
  ['A reason is required to close a purchase order short', 'กรุณาระบุเหตุผลที่ปิดใบสั่งซื้อ'],
  ['Can only close short a partially received purchase order', 'ปิดใบสั่งซื้อแบบส่งไม่ครบได้เฉพาะใบสั่งซื้อที่มีสถานะรับของบางส่วนเท่านั้น'],
  ['Supplier is required', 'กรุณาเลือกผู้จำหน่าย'],
  ['Company is required', 'กรุณาเลือกบริษัท'],
  ['Project is required', 'กรุณาเลือกโครงการ'],
  ['At least one material line is required', 'กรุณาเพิ่มรายการวัสดุอย่างน้อย 1 รายการ'],

  // Goods receipts
  ['Only PM/Admin can record a goods receipt', 'เฉพาะ PM/Admin เท่านั้นที่สามารถบันทึกการรับของได้'],
  ['Can only receive against a purchase order that is sent or partially received', 'รับของได้เฉพาะใบสั่งซื้อที่อยู่ในสถานะส่งแล้วหรือรับของบางส่วนเท่านั้น'],
  ['One or more receipt lines do not belong to this purchase order', 'มีรายการที่ไม่ได้อยู่ในใบสั่งซื้อนี้'],

  // Payment vouchers
  [
    'One or more selected receipts are invalid, belong to a different supplier, or are already paid',
    'ใบรับสินค้าที่เลือกบางรายการไม่ถูกต้อง เป็นของผู้จำหน่ายอื่น หรือถูกจ่ายไปแล้ว กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง',
  ],
  ['Select at least one receipt to pay', 'กรุณาเลือกใบรับสินค้าอย่างน้อย 1 รายการ'],
  ['Only PM/Admin can create a payment voucher', 'เฉพาะ PM/Admin เท่านั้นที่สามารถสร้างใบสำคัญจ่ายได้'],
  ['Only PM/Admin can void a payment voucher', 'เฉพาะ PM/Admin เท่านั้นที่สามารถยกเลิกใบสำคัญจ่ายได้'],
  ['Payment voucher not found', 'ไม่พบใบสำคัญจ่ายนี้'],
  ['Total paid on this purchase order would exceed its total amount', 'ยอดจ่ายรวมของใบสั่งซื้อนี้จะเกินยอดรวมของใบสั่งซื้อ'],

  // Purchase requests
  ['Cannot edit a purchase request that has already been reviewed', 'ไม่สามารถแก้ไขคำขอซื้อนี้ได้ เนื่องจากถูกตรวจสอบไปแล้ว กรุณาโหลดหน้าใหม่เพื่อดูข้อมูลล่าสุด'],
  ['Purchase request not found', 'ไม่พบคำขอซื้อนี้'],
  ['No permission to edit this purchase request', 'ไม่มีสิทธิ์แก้ไขคำขอซื้อนี้'],
  ['No permission to create purchase request', 'คุณไม่มีสิทธิ์สร้างคำขอซื้อ'],
  ['Only an approved purchase request can be settled by hand', 'ปิดรายการด้วยตนเองได้เฉพาะคำขอซื้อที่อนุมัติแล้วเท่านั้น กรุณาโหลดหน้าใหม่เพื่อดูข้อมูลล่าสุด'],
  ['Settled quantity exceeds what is still outstanding', 'จำนวนที่ระบุมากกว่าจำนวนคงเหลือของรายการ'],
  ['Select at least one line to settle', 'กรุณาเลือกอย่างน้อย 1 รายการ'],
  ['Only PM/Admin can settle a purchase request line', 'เฉพาะ PM/Admin เท่านั้นที่ปิดรายการได้'],
  ['Only PM/Admin can undo a settlement', 'เฉพาะ PM/Admin เท่านั้นที่ยกเลิกการปิดรายการได้'],
  ['Settlement not found', 'ไม่พบรายการที่ปิดไว้ อาจถูกยกเลิกไปแล้ว'],
  ['Cannot undo a settlement once the request has been received or closed', 'ยกเลิกไม่ได้ เนื่องจากคำขอซื้อนี้รับของหรือปิดไปแล้ว'],
  ['Only a pending request can be approved', 'อนุมัติได้เฉพาะคำขอที่รอตรวจสอบเท่านั้น'],
  ['Only a pending request can be rejected', 'ปฏิเสธได้เฉพาะคำขอที่รอตรวจสอบเท่านั้น'],
  ['Only PM/Admin can approve a purchase request', 'เฉพาะ PM/Admin เท่านั้นที่สามารถอนุมัติคำขอซื้อได้'],
  ['Only PM/Admin can reject a purchase request', 'เฉพาะ PM/Admin เท่านั้นที่สามารถปฏิเสธคำขอซื้อได้'],

  // Billing (contractor bills) - see actions/_shared/billing-errors.ts,
  // which re-exports translateError from here.
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
  ['Can edit pending review or rejected billing only', 'แก้ไขได้เฉพาะใบเบิกที่รอตรวจสอบหรือถูกปฏิเสธเท่านั้น'],

  // Stock
  ['Material not found', 'ไม่พบวัสดุนี้'],
  ['Not enough stock on hand to withdraw', 'สต็อกไม่เพียงพอสำหรับการเบิกนี้'],
  ['No permission to adjust stock', 'คุณไม่มีสิทธิ์ปรับยอดสต็อก'],
  ['Counted quantity must be zero or more', 'จำนวนที่นับได้ต้องไม่ติดลบ'],
  ['No permission to withdraw stock', 'คุณไม่มีสิทธิ์เบิกวัสดุ'],
  ['project_id is required', 'กรุณาเลือกโครงการ'],
  ['contractor_id is required', 'กรุณาเลือกผู้รับเหมา'],
  ['is set to receive-only and cannot be withdrawn via a material request', 'วัสดุนี้ถูกตั้งค่าให้รับเข้าอย่างเดียว ไม่สามารถเบิกผ่านคำขอวัสดุได้'],
  ['No valid items to withdraw', 'กรุณาเพิ่มรายการวัสดุอย่างน้อย 1 รายการ'],
  ['A movement cannot be scoped to both a plot and a plot group', 'กรุณาเลือกแปลงเดียวหรือกลุ่มแปลงอย่างใดอย่างหนึ่งเท่านั้น'],

  // Settings / users
  ['Only admin can update permissions', 'เฉพาะ Admin เท่านั้นที่สามารถแก้ไขสิทธิ์ได้'],
  ['Only admin can update user roles', 'เฉพาะ Admin เท่านั้นที่สามารถเปลี่ยนบทบาทผู้ใช้ได้'],
  ['You can only change your own name', 'คุณสามารถเปลี่ยนได้เฉพาะชื่อของตัวเองเท่านั้น'],

  // BOQ / house models
  ['House model is missing project. Please set project on this house model first.', 'แบบบ้านนี้ยังไม่ได้ระบุโครงการ กรุณาตั้งค่าโครงการของแบบบ้านนี้ก่อน'],
  ['Missing source or target model', 'กรุณาเลือกแบบบ้านต้นทางและปลายทาง'],
  ['Source and target house model must be different', 'แบบบ้านต้นทางและปลายทางต้องไม่ใช่แบบเดียวกัน'],
  ['Target house model is missing project. Please set project first.', 'แบบบ้านปลายทางยังไม่ได้ระบุโครงการ กรุณาตั้งค่าโครงการก่อน'],

  // Jobs / plots
  ['Invalid agreed price per unit', 'ราคาต่อหน่วยที่ตกลงไม่ถูกต้อง'],
]

export function translateError(message: string): string {
  return ERROR_TRANSLATIONS.find(([needle]) => message.includes(needle))?.[1] || message
}
