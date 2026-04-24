// The human-readable Thai note we attach to `payments` rows created from a
// billing approval. We keep this in one place (a) so callers can't drift in
// spelling and (b) so we can match both the current correct text and the
// legacy mojibake that earlier builds wrote into the database.

export const BILLING_PAYMENT_NOTE_PREFIX = 'เบิกตามใบขอเบิก'

// Previous builds saved this string with a broken encoding (Windows-874 bytes
// interpreted as Latin-1, re-encoded as UTF-8). Old rows still exist in the
// database, so we must still be able to find them when reverting or deleting
// an approval. Do NOT add any new mojibake variants here.
const LEGACY_BILLING_PAYMENT_NOTE_PREFIX = 'เน€เธเธดเธเธ•เธฒเธกเนเธเธงเธฒเธเธเธดเธฅ'

function formatDocNo(docNo: string | number | null | undefined) {
  return docNo == null || docNo === '' ? '-' : String(docNo)
}

export function buildBillingPaymentNote(docNo: string | number | null | undefined) {
  return `${BILLING_PAYMENT_NOTE_PREFIX} #${formatDocNo(docNo)}`
}

/**
 * Returns both the current-format note and the legacy mojibake note for the
 * given doc number so callers can locate every historical `payments` row tied
 * to the billing. Use with `supabase.from('payments').delete().in('note', ...)`.
 */
export function billingPaymentNoteVariants(docNo: string | number | null | undefined) {
  const doc = formatDocNo(docNo)
  return [
    `${BILLING_PAYMENT_NOTE_PREFIX} #${doc}`,
    `${LEGACY_BILLING_PAYMENT_NOTE_PREFIX} #${doc}`,
  ]
}
