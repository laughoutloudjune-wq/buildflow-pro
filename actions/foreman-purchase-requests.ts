'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { getCurrentUser } from '@/actions/_shared/user-role'
import { translateError } from '@/lib/errors'

// W-01: foreman raises the request, purchasing (admin) raises the PO - this
// file exists so the foreman side never needs the 'procurement' module
// (which would also expose supplier/PO screens it has no business seeing).
// pr_create already allows the foreman role; this just gates the same RPC
// call behind 'foreman' instead of 'procurement'.

export async function createForemanPurchaseRequest(input: {
  project_id: string
  plot_id?: string | null
  plot_group_id?: string | null
  plot_ids?: string[]
  note?: string
  needed_by_date?: string
  items: { material_type_id: number; quantity_requested: number; note?: string; boq_id?: string | null; unit?: string | null }[]
}): Promise<{ id: string; pr_no: string } | { error: string }> {
  try {
    await requireModuleAccess('foreman')
    const supabase = await createClient()

    if (!input.project_id) return { error: 'กรุณาเลือกโครงการ' }
    const items = input.items.filter((i) => i.material_type_id && Number(i.quantity_requested) > 0)
    if (items.length === 0) return { error: 'กรุณาเพิ่มรายการวัสดุอย่างน้อย 1 รายการ' }

    const { data, error } = await supabase.rpc('pr_create', {
      p_payload: {
        project_id: input.project_id,
        plot_id: input.plot_id || null,
        plot_group_id: input.plot_group_id || null,
        plot_ids: input.plot_ids && input.plot_ids.length > 0 ? input.plot_ids : [],
        note: input.note?.trim() || null,
        needed_by_date: input.needed_by_date || null,
        items,
      },
    })

    if (error) return { error: translateError(error.message) }
    revalidatePath('/dashboard/foreman/purchase-request')
    return data as { id: string; pr_no: string }
  } catch (error) {
    return { error: translateError(error instanceof Error ? error.message : 'ส่งคำขอซื้อไม่สำเร็จ') }
  }
}

export type ForemanPurchaseRequestItemRow = {
  material_name: string
  unit: string | null
  quantity_requested: number
}

export type ForemanPurchaseRequestRow = {
  id: string
  pr_no: string | number | null
  status: string
  review_note: string | null
  needed_by_date: string | null
  created_at: string
  project_name: string | null
  plot_name: string | null
  plot_group_name: string | null
  items: ForemanPurchaseRequestItemRow[]
}

/** "คำขอของฉัน" - only this foreman's own requests, no prices/suppliers/POs
 * anywhere in the shape (matches what the audit decided foreman may see). */
export async function getMyPurchaseRequests(): Promise<ForemanPurchaseRequestRow[]> {
  await requireModuleAccess('foreman')
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('purchase_requests')
    .select(`
      id, pr_no, status, review_note, needed_by_date, created_at,
      projects (name),
      plots!purchase_requests_plot_id_fkey (name),
      plot_groups (name),
      purchase_request_items ( quantity_requested, unit, material_types (name, unit) )
    `)
    .eq('requested_by', user.id)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  type Row = {
    id: string
    pr_no: string | number | null
    status: string
    review_note: string | null
    needed_by_date: string | null
    created_at: string
    projects: { name: string | null } | { name: string | null }[] | null
    plots: { name: string | null } | { name: string | null }[] | null
    plot_groups: { name: string | null } | { name: string | null }[] | null
    purchase_request_items: Array<{
      quantity_requested: number
      unit: string | null
      material_types: { name: string; unit: string } | { name: string; unit: string }[] | null
    }> | null
  }

  const asSingle = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] || null : v)

  return ((data || []) as unknown as Row[]).map((row) => ({
    id: row.id,
    pr_no: row.pr_no,
    status: row.status,
    review_note: row.review_note,
    needed_by_date: row.needed_by_date,
    created_at: row.created_at,
    project_name: asSingle(row.projects)?.name ?? null,
    plot_name: asSingle(row.plots)?.name ?? null,
    plot_group_name: asSingle(row.plot_groups)?.name ?? null,
    items: (row.purchase_request_items || []).map((i) => {
      const material = asSingle(i.material_types)
      return {
        material_name: material?.name || '-',
        unit: i.unit || material?.unit || null,
        quantity_requested: Number(i.quantity_requested) || 0,
      }
    }),
  }))
}
