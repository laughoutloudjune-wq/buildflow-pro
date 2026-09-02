import type { MaterialType } from '@/lib/types/materials'

export type SupplierType = 'company' | 'individual'

export type SupplierInput = {
  name: string
  supplier_type?: SupplierType
  contact_name?: string
  phone?: string
  email?: string
  address?: string
  tax_id?: string
  branch_code?: string
  payment_terms?: string
}

export type Supplier = {
  id: string
  name: string
  supplier_type: SupplierType
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  tax_id: string | null
  branch_code: string | null
  payment_terms: string | null
  is_active: boolean
  created_at: string
}

export type Company = {
  id: string
  name: string
  tax_id: string | null
  address: string | null
  phone: string | null
  logo_url: string | null
  signature_url: string | null
  is_active: boolean
  created_at: string
}

export type PurchaseRequestStatus = 'pending_review' | 'approved' | 'rejected' | 'ordered' | 'received' | 'cancelled'

export type PurchaseRequestItem = {
  id: string
  purchase_request_id: string
  material_type_id: number
  quantity_requested: number
  note: string | null
  material_types?: MaterialType | null
}

export type PurchaseRequest = {
  id: string
  pr_no: number
  project_id: string
  plot_id: string | null
  status: PurchaseRequestStatus
  note: string | null
  review_note: string | null
  needed_by_date: string | null
  requested_by: string
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  projects?: { name: string } | null
  plots?: { name: string } | null
  requester?: { full_name: string | null; email: string | null } | null
  purchase_request_items?: PurchaseRequestItem[]
}

export type PurchaseOrderStatus = 'draft' | 'sent' | 'partially_received' | 'received' | 'paid' | 'cancelled'

export type DiscountType = 'none' | 'percent' | 'amount'
export type VatType = 'exclusive' | 'inclusive'

export type PurchaseOrderItem = {
  id: string
  purchase_order_id: string
  material_type_id: number
  purchase_request_item_id: string | null
  quantity_ordered: number
  unit_price: number
  quantity_received: number
  description: string | null
  discount_type: DiscountType
  discount_value: number
  discount_amount: number
  material_types?: MaterialType | null
}

export type PurchaseOrder = {
  id: string
  po_no: string
  supplier_id: string
  company_id: string
  project_id: string
  plot_id: string | null
  plot_group_id: string | null
  purchase_request_id: string | null
  status: PurchaseOrderStatus
  order_date: string
  expected_delivery_date: string | null
  delivery_address: string | null
  vat_percent: number
  vat_type: VatType
  payment_terms: string | null
  discount_type: DiscountType
  discount_value: number
  discount_amount: number
  subtotal: number
  vat_amount: number
  total_amount: number
  note: string | null
  created_by: string
  created_at: string
  confirmed_at: string | null
  received_at: string | null
  received_by: string | null
  paid_at: string | null
  paid_by: string | null
  suppliers?: Supplier | null
  companies?: Company | null
  projects?: { name: string; location: string | null } | null
  plots?: { name: string } | null
  plot_groups?: { name: string } | null
  /** Ad-hoc multi-plot selection (ordered by nothing in particular - see
   * purchase_order_plots) - populated only when neither plot_id nor
   * plot_group_id is set. */
  purchase_order_plots?: { plot_id: string; plots?: { name: string } | null }[]
  purchase_requests?: { pr_no: number } | null
  creator?: { full_name: string | null } | null
  receiver?: { full_name: string | null } | null
  payer?: { full_name: string | null } | null
  purchase_order_items?: PurchaseOrderItem[]
}

export type PurchaseOrderItemInput = {
  material_type_id: number
  purchase_request_item_id?: string | null
  quantity_ordered: number
  unit_price: number
  description?: string
  discount_type?: DiscountType
  discount_value?: number
}

export type PurchaseOrderInput = {
  supplier_id: string
  company_id: string
  project_id: string
  plot_id?: string | null
  plot_group_id?: string | null
  /** Ad-hoc multi-plot selection - when non-empty, wins over plot_id/
   * plot_group_id (both are forced null server-side). */
  plot_ids?: string[]
  purchase_request_id?: string | null
  order_date?: string
  expected_delivery_date?: string | null
  delivery_address?: string | null
  vat_percent?: number
  vat_type?: VatType
  payment_terms?: string
  discount_type?: DiscountType
  discount_value?: number
  note?: string
  items: PurchaseOrderItemInput[]
}

export type GoodsReceiptItem = {
  id: string
  goods_receipt_id: string
  purchase_order_item_id: string
  quantity_received: number
  unit_price_at_receipt: number
}

export type GoodsReceipt = {
  id: string
  purchase_order_id: string
  delivery_note_no: string | null
  received_by: string
  received_at: string
  note: string | null
  goods_receipt_items?: GoodsReceiptItem[]
}
