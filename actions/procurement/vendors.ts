'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requireAuthRole } from '@/actions/_shared/user-role'
import type { Company, Supplier, SupplierBranch, SupplierBranchInput, SupplierInput } from '@/lib/types/procurement'

// ---------------------------------------------------------------------------
// Suppliers (material vendors, distinct from `contractors` which are labor
// subcontractors). Managed from Settings by admin; readable by anyone with
// procurement access so PO creation can pick from the list.
// ---------------------------------------------------------------------------

export async function getSuppliers(activeOnly = true): Promise<Supplier[]> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  let query = supabase.from('suppliers').select('*').order('name')
  if (activeOnly) query = query.eq('is_active', true)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || []
}

// Creating a supplier is allowed for admin/pm (not just admin) so a PM can
// add a new supplier inline while building a purchase order, without having
// to stop and go find an admin first. Editing/deactivating an existing
// supplier stays admin-only - see updateSupplier/deactivateSupplier below.
export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()

  const name = input.name.trim()
  if (!name) throw new Error('Supplier name is required')

  const { data, error } = await supabase
    .from('suppliers')
    .insert([
      {
        name,
        supplier_type: input.supplier_type === 'individual' ? 'individual' : 'company',
        contact_name: input.contact_name?.trim() || null,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        address: input.address?.trim() || null,
        tax_id: input.tax_id?.trim() || null,
        branch_code: input.branch_code?.trim() || null,
        payment_terms: input.payment_terms?.trim() || null,
      },
    ])
    .select()
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/suppliers')
  return data
}

export async function updateSupplier(id: string, input: SupplierInput) {
  await requireAuthRole(['admin'])
  const supabase = await createClient()

  const name = input.name.trim()
  if (!name) throw new Error('Supplier name is required')

  const { error } = await supabase
    .from('suppliers')
    .update({
      name,
      supplier_type: input.supplier_type === 'individual' ? 'individual' : 'company',
      contact_name: input.contact_name?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      address: input.address?.trim() || null,
      tax_id: input.tax_id?.trim() || null,
      branch_code: input.branch_code?.trim() || null,
      payment_terms: input.payment_terms?.trim() || null,
    })
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/suppliers')
}

export async function deactivateSupplier(id: string) {
  await requireAuthRole(['admin'])
  const supabase = await createClient()
  const { error } = await supabase.from('suppliers').update({ is_active: false }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/suppliers')
}

// ---------------------------------------------------------------------------
// Supplier branches. A vendor with several สาขา shares one tax id but each
// branch has its own branch code and address, and a Thai tax invoice must
// name the branch that actually sold the goods. Opt-in per supplier: most
// have none, and those keep behaving as plain single-location vendors.
// ---------------------------------------------------------------------------

/** Suppliers with their active branches attached, for the PO form's picker.
 * One query rather than a branch lookup per supplier selection - the whole
 * list is small and it keeps the picker instant when switching suppliers. */
export async function getSuppliersWithBranches(activeOnly = true): Promise<Supplier[]> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  let query = supabase
    .from('suppliers')
    .select('*, supplier_branches (*)')
    .order('name')
  if (activeOnly) query = query.eq('is_active', true)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  // Inactive branches stay selectable on orders that already cite them, but
  // must not be offered for new ones.
  return ((data as unknown as Supplier[]) || []).map((supplier) => ({
    ...supplier,
    supplier_branches: (supplier.supplier_branches || [])
      .filter((branch) => branch.is_active)
      .sort((a, b) => a.branch_code.localeCompare(b.branch_code)),
  }))
}

export async function getSupplierBranches(supplierId: string): Promise<SupplierBranch[]> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('supplier_branches')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('branch_code')
  if (error) throw new Error(error.message)
  return data || []
}

// Same reasoning as createSupplier: a PM adding a branch mid-order shouldn't
// have to go find an admin. Editing and deactivating stay admin-only.
export async function createSupplierBranch(input: SupplierBranchInput): Promise<SupplierBranch> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()

  const name = input.name.trim()
  const branchCode = input.branch_code.trim()
  if (!name) throw new Error('Branch name is required')
  if (!branchCode) throw new Error('Branch code is required')

  const { data, error } = await supabase
    .from('supplier_branches')
    .insert([
      {
        supplier_id: input.supplier_id,
        branch_code: branchCode,
        name,
        address: input.address?.trim() || null,
        phone: input.phone?.trim() || null,
        contact_name: input.contact_name?.trim() || null,
      },
    ])
    .select()
    .single()

  if (error) throw new Error(translateBranchError(error.message))
  revalidatePath('/dashboard/settings/suppliers')
  return data
}

export async function updateSupplierBranch(id: string, input: Omit<SupplierBranchInput, 'supplier_id'>) {
  await requireAuthRole(['admin'])
  const supabase = await createClient()

  const name = input.name.trim()
  const branchCode = input.branch_code.trim()
  if (!name) throw new Error('Branch name is required')
  if (!branchCode) throw new Error('Branch code is required')

  const { error } = await supabase
    .from('supplier_branches')
    .update({
      branch_code: branchCode,
      name,
      address: input.address?.trim() || null,
      phone: input.phone?.trim() || null,
      contact_name: input.contact_name?.trim() || null,
    })
    .eq('id', id)

  if (error) throw new Error(translateBranchError(error.message))
  revalidatePath('/dashboard/settings/suppliers')
}

/** Deactivate rather than delete: orders already issued against this branch
 * keep pointing at it, and the FK has no ON DELETE action precisely so a
 * cited branch cannot be removed out from under them. */
export async function deactivateSupplierBranch(id: string) {
  await requireAuthRole(['admin'])
  const supabase = await createClient()
  const { error } = await supabase.from('supplier_branches').update({ is_active: false }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/suppliers')
}

function translateBranchError(message: string): string {
  if (message.includes('supplier_branches_supplier_id_branch_code_key')) {
    return 'รหัสสาขานี้มีอยู่แล้วสำหรับผู้จำหน่ายรายนี้'
  }
  return message
}

// ---------------------------------------------------------------------------
// Companies (the user's umbrella of legal entities). A PO is always issued
// from exactly one of these.
// ---------------------------------------------------------------------------

export async function getCompanies(activeOnly = true): Promise<Company[]> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  let query = supabase.from('companies').select('*').order('name')
  if (activeOnly) query = query.eq('is_active', true)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || []
}

// Same admin/pm allowance as createSupplier - a PM can add a new buyer
// company inline while building a purchase order.
export async function createCompany(input: {
  name: string
  tax_id?: string
  address?: string
  phone?: string
  logo_url?: string
  signature_url?: string
}): Promise<Company> {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()

  const name = input.name.trim()
  if (!name) throw new Error('Company name is required')

  const { data, error } = await supabase
    .from('companies')
    .insert([
      {
        name,
        tax_id: input.tax_id?.trim() || null,
        address: input.address?.trim() || null,
        phone: input.phone?.trim() || null,
        logo_url: input.logo_url?.trim() || null,
        signature_url: input.signature_url?.trim() || null,
      },
    ])
    .select()
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/companies')
  return data
}

export async function updateCompany(
  id: string,
  input: {
    name: string
    tax_id?: string
    address?: string
    phone?: string
    logo_url?: string
    signature_url?: string
  }
) {
  await requireAuthRole(['admin'])
  const supabase = await createClient()

  const name = input.name.trim()
  if (!name) throw new Error('Company name is required')

  const { error } = await supabase
    .from('companies')
    .update({
      name,
      tax_id: input.tax_id?.trim() || null,
      address: input.address?.trim() || null,
      phone: input.phone?.trim() || null,
      logo_url: input.logo_url?.trim() || null,
      signature_url: input.signature_url?.trim() || null,
    })
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/companies')
}

// Uploads a company logo or signature and returns its public URL.
//
// Kept separate from createCompany/updateCompany rather than switching those
// to FormData, because the purchase order form's inline "add company" modal
// calls them with plain fields and has no file picker. The settings page
// uploads first, then saves the returned URL like any other string field.
export async function uploadCompanyAsset(kind: 'logo' | 'signature', formData: FormData): Promise<string> {
  await requireAuthRole(['admin'])
  const supabase = await createClient()

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) throw new Error('No file provided')
  if (!file.type.startsWith('image/')) throw new Error('ไฟล์ต้องเป็นรูปภาพเท่านั้น')
  if (file.size > 2 * 1024 * 1024) throw new Error('ขนาดไฟล์ต้องไม่เกิน 2MB')

  const extension = file.name.split('.').pop() || 'png'
  const filePath = `public/company-${kind}-${Date.now()}.${extension}`

  const { error: uploadError } = await supabase.storage.from('assets').upload(filePath, file)
  if (uploadError) throw new Error(`อัปโหลดไม่สำเร็จ: ${uploadError.message}`)

  const { data } = supabase.storage.from('assets').getPublicUrl(filePath)
  return data.publicUrl
}

export async function deactivateCompany(id: string) {
  await requireAuthRole(['admin'])
  const supabase = await createClient()
  const { error } = await supabase.from('companies').update({ is_active: false }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/companies')
}
