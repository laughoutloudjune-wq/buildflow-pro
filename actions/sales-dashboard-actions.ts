'use server'

import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'

export type SalesDashboardData = {
  totals: {
    total_plots: number
    available_count: number
    in_progress_count: number
    sold_count: number
    lost_count: number
    total_inventory_value: number
    total_deal_value: number
  }
  byStatus: {
    status_code: string | null
    status_label: string
    status_color: string
    sort_order: number
    n: number
    value: number
  }[]
  byProject: { project_name: string; total: number; sold: number; value: number }[]
  byModel: { house_model_name: string; total: number; sold: number }[]
  byRep: { rep_name: string; deals: number; value: number }[]
  payments: {
    collected: number
    outstanding: number
    overdue_amount: number
    overdue_count: number
  }
}

const EMPTY: SalesDashboardData = {
  totals: {
    total_plots: 0,
    available_count: 0,
    in_progress_count: 0,
    sold_count: 0,
    lost_count: 0,
    total_inventory_value: 0,
    total_deal_value: 0,
  },
  byStatus: [],
  byProject: [],
  byModel: [],
  byRep: [],
  payments: { collected: 0, outstanding: 0, overdue_amount: 0, overdue_count: 0 },
}

/** One aggregate RPC (get_sales_dashboard) instead of several small
 * fetches - same reasoning as getSalesBoard, just worse here since a
 * dashboard is several distinct widgets that would each want their own
 * round trip otherwise. null projectId means every project combined. */
export async function getSalesDashboard(projectId: string | null): Promise<SalesDashboardData> {
  await requireModuleAccess('sales')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_sales_dashboard', { p_project_id: projectId })
  if (error) throw new Error(error.message)
  return (data as SalesDashboardData) || EMPTY
}
