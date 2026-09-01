// Shared visual language for the "Modern Apple-style PO form" look, used by
// both the create/edit form and the order detail preview so the on-screen
// document and the generated PDF (lib/pdf/purchaseOrderHtml.ts, rendered via
// Puppeteer at app/api/procurement/orders/[id]/pdf) stay
// visually consistent. Kept local to procurement rather than touching the
// shared Card/Button components, which stay on BuildFlow's indigo theme
// everywhere else in the app.
export const appleBg = '#fbfbfd'
export const appleText = '#1d1d1f'
export const appleMutedHex = '#86868b'
export const appleAccentHex = '#0071e3'
export const appleBorderHex = '#f0f0f2'
export const appleDividerHex = '#e8e8ed'

export const appleCard = 'rounded-[20px] border border-[#f0f0f2] bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)]'
export const appleCardLabel = 'mb-2.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#0071e3]'
export const appleMuted = 'text-[#86868b]'
export const appleDivider = 'h-px bg-[#e8e8ed]'
export const applePill =
  'min-w-[110px] rounded-[10px] border border-[#e8e8ed] bg-white px-3 py-1.5 text-[13px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.03)]'
export const appleFieldLabel = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#86868b]'
