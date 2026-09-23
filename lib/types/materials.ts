export type MaterialType = {
  id: number
  name: string
  unit: string
  category: string | null
  current_price: number
  price_updated_at: string | null
  price_updated_by: string | null
  is_active: boolean
  created_at: string
  /** Reorder threshold for the low-stock report - null means no threshold
   * has been set yet, distinct from a threshold of 0. */
  reorder_point: number | null
  /** False for bulk consumables (e.g. อิฐมวลเบา, ปูนถุง) that get used
   * immediately on delivery rather than warehoused for a later withdrawal -
   * receiving still counts, but stock_request_create refuses to withdraw
   * these. Defaults to true; most of the catalog is discretely trackable. */
  is_requestable: boolean
  /** Days between placing an order and receiving this material - shown to
   * the PM at purchase-request approval time so they can judge whether the
   * requested need-by date is still achievable. Auto-overwritten by
   * goods_receipt_create with the actual PO order_date -> RI received_at gap
   * every time this material is received; editable in Settings > Materials
   * only to seed an estimate before it's ever been received. Null means not
   * set yet, distinct from a lead time of 0 (in-stock/immediate). */
  lead_time_days: number | null
}

/** Narrow projection of MaterialType for pickers that only display and
 * search by name/unit/category - on a 1000+ row catalog, the unused columns
 * (current_price, price_updated_at/by, is_active, created_at, reorder_point,
 * is_requestable) meaningfully bloat both the query and the server-action
 * payload for no benefit to a picker that never reads them. */
export type MaterialPickerOption = {
  id: number
  name: string
  unit: string
  category: string | null
}

/** Narrow projection of MaterialType for the materials settings page table -
 * drops created_at and price_updated_by, which that table never renders. On
 * a 1000+ row catalog this meaningfully shrinks the query and payload. */
export type MaterialCatalogRow = Omit<MaterialType, 'created_at' | 'price_updated_by'>

export type BoqMaterialItem = {
  id: string
  boq_id: string
  material_type_id: number
  planned_quantity: number
  /** Allowed cut-waste on top of planned_quantity, as a percent (e.g. 5 =
   * 5%). 0 (the column default) means "use the org-wide default" wherever
   * the BOQ control ceiling is computed - see organization_settings.default_waste_percent
   * and boq_control_rollup(). */
  waste_percent: number
  created_at: string
  material_types?: MaterialType | null
}

/** One row of a house-model-level material grid: every material across one
 * BOQ job (boq_master row), so a whole house's materials can be entered
 * without opening a separate modal per job - see BOQ_CONTROL_PLAN.md 7.2. */
export type BoqMaterialsForHouseModelJob = {
  boqId: string
  boqItemName: string
  items: BoqMaterialItem[]
}

/** One resolved row of a BOQ material Excel import - see
 * BOQ_CONTROL_PLAN.md 7.1. Resolution is exact-match-first with a
 * normalized-name fallback, never a blanket normalize-then-join. */
export type BoqMaterialImportRow = {
  line: number
  houseModelName: string
  boqJobName: string
  materialName: string
  quantity: number
  wastePercent: number
  boqId: string
  materialTypeId: number
  status: 'insert' | 'update'
  previousQuantity?: number
}

export type BoqMaterialImportSkippedRow = {
  line: number
  houseModelName: string
  boqJobName: string
  materialName: string
  reason: string
}

export type BoqMaterialImportPreview = {
  rows: BoqMaterialImportRow[]
  skipped: BoqMaterialImportSkippedRow[]
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

