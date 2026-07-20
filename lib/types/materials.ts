export type MaterialType = {
  id: number
  name: string
  unit: string
  current_price: number
  price_updated_at: string | null
  price_updated_by: string | null
  created_at: string
}

export type BoqMaterialItem = {
  id: string
  boq_id: string
  material_type_id: number
  planned_quantity: number
  created_at: string
  material_types?: MaterialType | null
}

/** A named batch of plots built/supplied together (e.g. "98-102"). Material
 * purchases can be scoped to a whole group instead of one plot. */
export type PlotGroup = {
  id: string
  project_id: string
  name: string
  created_at: string
  member_plot_ids: string[]
  member_plot_names: string[]
}

/** The group the current job's plot belongs to, if any - used by the
 * logging UI to offer "log for the whole group" and to compute shares. */
export type PlotGroupContext = {
  group_id: string
  name: string
  member_count: number
  member_plot_names: string[]
}

export type MaterialUsageLogEntry = {
  id: string
  job_assignment_id: string
  material_type_id: number
  quantity_used: number
  unit_price_at_use: number
  purchase_date: string
  note: string | null
  photo_url: string | null
  logged_by: string | null
  created_at: string
  /** Set when this purchase covers the plot's whole group; null = this plot only. */
  plot_group_id: string | null
  material_types?: MaterialType | null
  /** Group display info, attached when plot_group_id is set. */
  plot_group?: { name: string; member_count: number } | null
  /** This plot's derived share of a group purchase (quantity / member count). */
  share_quantity?: number
}

/** Planned-vs-actual rollup for one material on one job assignment.
 * Quantities/costs are the per-plot view: solo purchases exact, plus this
 * plot's share of any group purchases (group total / member count). */
export type MaterialVariance = {
  material_type_id: number
  material_name: string
  unit: string
  planned_quantity: number
  used_quantity: number
  planned_cost: number
  actual_cost: number
  difference: number
  /** Group-level totals, present when any usage came from group purchases. */
  group?: {
    member_count: number
    total_quantity: number
    total_cost: number
    planned_quantity: number
    planned_cost: number
  }
}
