export type SignatureDocumentType = 'purchase_request' | 'purchase_order' | 'billing'

/** A slot tagged with one of these is auto-filled by the document renderer
 * with a real name/date from the document itself, on top of whatever label
 * and image the slot is configured with. Untagged (null) slots are pure
 * custom lines - just a label, an optional stored image, and a blank line
 * for a physical signature. */
export type SignatureSystemKey = 'requester' | 'reviewer' | 'preparer' | 'supplier'

export type SignatureSlot = {
  id: string
  document_type: SignatureDocumentType
  position: number
  label: string
  system_key: SignatureSystemKey | null
  signature_url: string | null
  created_at: string
}

export type SignatureSlotInput = {
  label: string
  system_key: SignatureSystemKey | null
  signature_url: string | null
}
