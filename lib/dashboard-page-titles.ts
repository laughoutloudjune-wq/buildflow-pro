/**
 * Human-readable titles for the dashboard chrome (header), keyed by path prefix.
 * Longer paths are checked first so `/dashboard/billing/…/review` wins over `/dashboard/billing`.
 */
const PREFIX_TITLES: [string, string][] = [
  ['/dashboard/billing/request', 'สร้างใบขอเบิก'],
  ['/dashboard/billing/create', 'สร้างเบิกจ่าย'],
  ['/dashboard/foreman/create-progress', 'ตรวจหน้างาน (งวด)'],
  ['/dashboard/foreman/create-dc', 'สร้างใบเบิก DC'],
  ['/dashboard/foreman/history', 'ประวัติ Foreman'],
  ['/dashboard/foreman', 'ตรวจหน้างาน'],
  ['/dashboard/billing', 'รายการเบิกจ่าย'],
  ['/dashboard/reports/contractor-cycle/print', 'พิมพ์รอบจ่ายผู้รับเหมา'],
  ['/dashboard/reports/contractor-cycle', 'รอบจ่ายผู้รับเหมา'],
  ['/dashboard/reports/dc-history', 'รายงาน DC'],
  ['/dashboard/reports/house-history', 'ประวัติบ้านเลขที่'],
  ['/dashboard/reports', 'รายงาน'],
  ['/dashboard/settings/permissions', 'สิทธิ์ตามบทบาท'],
  ['/dashboard/settings/contractor-types', 'ประเภทผู้รับเหมา'],
  ['/dashboard/settings', 'ตั้งค่า'],
  ['/dashboard/projects', 'โครงการ'],
  ['/dashboard/boq', 'แบบบ้าน & BOQ'],
  ['/dashboard/contractors', 'ผู้รับเหมา'],
]

export function getDashboardPageTitle(pathname: string | null): string {
  if (!pathname || pathname === '/dashboard') return 'ภาพรวม'

  if (/\/dashboard\/billing\/[^/]+\/review/.test(pathname)) return 'ตรวจสอบใบขอเบิก'
  if (/\/dashboard\/billing\/[^/]+\/print/.test(pathname)) return 'พิมพ์ใบเบิก'

  const sorted = [...PREFIX_TITLES].sort((a, b) => b[0].length - a[0].length)
  for (const [prefix, title] of sorted) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return title
  }
  return 'BuildFlow'
}
