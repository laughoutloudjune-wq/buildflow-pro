/** Categories offered in the sale-request form. */
export const NEW_REQUEST_CATEGORIES = [
  { value: 'repair', label: 'แจ้งซ่อม' },
  { value: 'common_area', label: 'ส่วนกลาง' },
  { value: 'punch_list', label: 'เก็บงาน' },
  { value: 'house_transfer', label: 'โอนบ้าน' },
] as const

/** Every category a row can carry, including the legacy ones that old
 * requests still use but the form no longer offers. */
export const WORK_REQUEST_CATEGORY_LABEL: Record<string, string> = {
  ...Object.fromEntries(NEW_REQUEST_CATEGORIES.map((c) => [c.value, c.label])),
  extra_work: 'งานเพิ่มลูกค้า',
  defect: 'แก้ Defect',
  expedite: 'เร่งงาน',
  handover_prep: 'เตรียมส่งมอบ',
  other: 'อื่นๆ',
}
