'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAuthRole } from '@/actions/_shared/user-role'
import type { SignatureDocumentType, SignatureSlot, SignatureSlotInput } from '@/lib/types/signatures'

const REVALIDATE_PATHS: Record<SignatureDocumentType, string[]> = {
  purchase_request: ['/dashboard/procurement/requests'],
  purchase_order: ['/dashboard/procurement/orders'],
  billing: ['/dashboard/billing'],
}

/** No permission gate here - this only returns label/image metadata (no
 * document contents), and every caller is already inside a page or print
 * route that has its own access check on the underlying document. */
export async function getSignatureSlots(documentType: SignatureDocumentType): Promise<SignatureSlot[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('document_signature_slots')
    .select('*')
    .eq('document_type', documentType)
    .order('position')

  if (error) throw new Error(error.message)
  return data || []
}

/** Replaces the whole ordered list for one document type in a single
 * delete-then-insert - simpler and safe enough for a low-frequency admin
 * settings screen than diffing individual id-matched rows. Position is
 * derived from array order, so callers just pass the list in the order they
 * want it printed. */
export async function replaceSignatureSlots(
  documentType: SignatureDocumentType,
  slots: SignatureSlotInput[]
): Promise<SignatureSlot[]> {
  await requireAuthRole(['admin'])
  const supabase = await createClient()

  const trimmed = slots.map((s) => ({ ...s, label: s.label.trim() })).filter((s) => s.label)

  const { error: deleteError } = await supabase.from('document_signature_slots').delete().eq('document_type', documentType)
  if (deleteError) throw new Error(deleteError.message)

  let result: SignatureSlot[] = []
  if (trimmed.length > 0) {
    const rows = trimmed.map((slot, index) => ({
      document_type: documentType,
      position: index + 1,
      label: slot.label,
      system_key: slot.system_key,
      signature_url: slot.signature_url || null,
    }))
    const { data, error } = await supabase.from('document_signature_slots').insert(rows).select().order('position')
    if (error) throw new Error(error.message)
    result = data || []
  }

  revalidatePath('/dashboard/settings/signatures')
  for (const path of REVALIDATE_PATHS[documentType]) revalidatePath(path)
  return result
}

export async function uploadSignatureSlotAsset(formData: FormData): Promise<string> {
  await requireAuthRole(['admin'])
  const supabase = await createClient()

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) throw new Error('No file provided')
  if (!file.type.startsWith('image/')) throw new Error('ไฟล์ต้องเป็นรูปภาพเท่านั้น')
  if (file.size > 2 * 1024 * 1024) throw new Error('ขนาดไฟล์ต้องไม่เกิน 2MB')

  const extension = file.name.split('.').pop() || 'png'
  const filePath = `public/signature-slot-${Date.now()}.${extension}`

  const { error: uploadError } = await supabase.storage.from('assets').upload(filePath, file)
  if (uploadError) throw new Error(`อัปโหลดไม่สำเร็จ: ${uploadError.message}`)

  const { data } = supabase.storage.from('assets').getPublicUrl(filePath)
  return data.publicUrl
}
