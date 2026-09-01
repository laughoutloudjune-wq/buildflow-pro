export type StockMovementType = 'in' | 'out'
export type StockSourceType = 'goods_receipt' | 'manual_request' | 'opening_balance' | 'count_adjustment'

/** One row of the Stock Overview table. `tracked` is false when the
 * material has never had a stock_balances row written for it (no receipt,
 * withdrawal, or migrated opening balance yet) - distinct from a real,
 * confirmed zero, which only happens once something actually draws a
 * balance down to exactly 0. */
export type StockOverviewRow = {
  material_type_id: number
  name: string
  unit: string
  category: string | null
  quantity_on_hand: number
  tracked: boolean
  /** False for bulk consumables that only get received, never withdrawn -
   * see material_types.is_requestable. */
  is_requestable: boolean
}

export type StockMovement = {
  id: string
  material_type_id: number
  project_id: string | null
  plot_id: string | null
  /** A batch of plots built/supplied together (e.g. "98-102") - mutually
   * exclusive with plot_id. Same concept material_usage_log already uses;
   * see 202608310005_stock_movements_plot_group.sql. */
  plot_group_id: string | null
  contractor_id: string | null
  type: StockMovementType
  source_type: StockSourceType
  source_id: string | null
  quantity: number
  prev_qty: number
  new_qty: number
  requested_by: string | null
  approved_by: string | null
  note: string | null
  created_at: string
  material_types?: { id: number; name: string; unit: string } | null
  projects?: { id: string; name: string } | null
  contractors?: { id: string; name: string } | null
  plots?: { id: string; name: string } | null
  plot_groups?: { id: string; name: string } | null
  requested_by_profile?: { id: string; full_name: string | null } | null
}

/** A tracked material whose on-hand quantity has fallen to or below its own
 * reorder_point - only includes materials where a threshold was actually
 * set (see material_types.reorder_point). */
export type LowStockRow = {
  material_type_id: number
  name: string
  unit: string
  category: string | null
  quantity_on_hand: number
  reorder_point: number
}

export type ConsumptionRow = { name: string; quantity: number; movement_count: number }

export type ActiveMaterialRow = {
  material_type_id: number
  name: string
  unit: string
  movement_count: number
  total_quantity: number
}

export type ConsumptionReport = {
  byProject: ConsumptionRow[]
  byContractor: ConsumptionRow[]
  mostActiveMaterials: ActiveMaterialRow[]
}
