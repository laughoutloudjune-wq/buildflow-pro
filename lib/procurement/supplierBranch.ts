/** A supplier that has active branches must name the branch on every PO
 * (the Thai tax invoice carries the branch that sold the goods). Suppliers
 * with no branches are unaffected. Shared by the PO form (inline message)
 * and the server actions (so the rule holds for every caller, not just the
 * form). */
export const BRANCH_REQUIRED_MESSAGE = 'ผู้จำหน่ายรายนี้มีสาขา กรุณาเลือกสาขาที่ออกบิลก่อนบันทึกใบสั่งซื้อ'
