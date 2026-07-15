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
  material_types?: MaterialType | null
}

/** Planned-vs-actual rollup for one material on one job assignment. */
export type MaterialVariance = {
  material_type_id: number
  material_name: string
  unit: string
  planned_quantity: number
  used_quantity: number
  planned_cost: number
  actual_cost: number
  difference: number
}
