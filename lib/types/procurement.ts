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

/** Why a quantity was closed out by hand rather than by a PO raised from the
 * request: 'ordered' - it was bought, just not through a linked PO (different
 * brand, or a standalone PO); 'cancelled' - it isn't being bought at all. */
export type SettlementReason = 'ordered' | 'cancelled'

/** One human decision that some quantity on a request line is handled, so it
 * should stop counting as outstanding. Kept as its own row (rather than only
 * decrementing quantity_requested, the way po_create does) so it can be undone
 * and shows who closed it and why. */
export type PurchaseRequestItemSettlement = {
  id: string
  purchase_request_item_id: string
  quantity: number
  reason: SettlementReason
  /** Free text - may be one of our PO numbers, a supplier's own reference, or
   * nothing at all. */
  po_ref: string | null
  note: string | null
  settled_by: string
  settled_at: string
  settler?: { full_name: string | null; email: string | null } | null
}

export type PurchaseRequestItem = {
  id: string
  purchase_request_id: string
  material_type_id: number
  /** What's still OUTSTANDING, not the original ask - both POs raised from the
   * request and manual settlements subtract from it. */
  quantity_requested: number
  note: string | null
  material_types?: MaterialType | null
  purchase_request_item_settlements?: PurchaseRequestItemSettlement[]
}

export type PurchaseRequest = {
  id: string
  pr_no: number
  project_id: string
  plot_id: string | null
  plot_group_id: string | null
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
  plot_groups?: { name: string } | null
  /** Ad-hoc multi-plot selection - populated only when neither plot_id nor
   * plot_group_id is set. */
  purchase_request_plots?: { plot_id: string; plots?: { name: string } | null }[]
  requester?: { full_name: string | null; email: string | null } | null
  reviewer?: { full_name: string | null; email: string | null } | null
  purchase_request_items?: PurchaseRequestItem[]
  /** POs already placed against this request, if any - lets the UI flag an
   * 'approved' request that's actually been partially ordered already
   * (some lines settled at 0 remaining, others still outstanding) rather
   * than never touched at all. Empty/absent for a request no PO has ever
   * referenced. */
  purchase_orders?: { po_no: string; status: PurchaseOrderStatus }[] | null
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
  /** Existing purchase_order_item id when editing a line that's already on
   * the order - lets po_update preserve quantity_received and the
   * goods_receipt_items FK by updating that row in place instead of
   * recreating it. Omit/null for a brand-new line. */
  id?: string | null
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

export type LastMaterialOrderPrice = {
  unitPrice: number
  orderDate: string
  poNo: number
  purchaseOrderId: string
}

export type GoodsReceiptItem = {
  id: string
  goods_receipt_id: string
  purchase_order_item_id: string
  quantity_received: number
  unit_price_at_receipt: number
  purchase_order_items?: { material_types?: { name: string } | null } | null
}

export type GoodsReceipt = {
  id: string
  ri_no: string
  purchase_order_id: string
  delivery_note_no: string | null
  received_by: string
  received_at: string
  note: string | null
  goods_receipt_items?: GoodsReceiptItem[]
  purchase_orders?: {
    po_no: string
    supplier_id: string
    company_id: string
    suppliers?: { name: string } | null
    companies?: { name: string } | null
  } | null
  payment_voucher_receipts?: { payment_voucher_id: string; amount: number; payment_vouchers?: { pp_no: string } | null }[]
}

export type PaymentMethod = 'cash' | 'bank_transfer' | 'director_loan'

export type PaymentVoucherReceipt = {
  id: string
  payment_voucher_id: string
  goods_receipt_id: string
  subtotal: number
  vat_amount: number
  amount: number
  goods_receipts?: { ri_no: string; purchase_orders?: { po_no: string } | null } | null
}

export type PaymentVoucher = {
  id: string
  pp_no: string
  supplier_id: string
  company_id: string
  payment_date: string
  payment_method: PaymentMethod
  subtotal: number
  vat_amount: number
  total_amount: number
  note: string | null
  created_by: string
  created_at: string
  suppliers?: Supplier | null
  companies?: Company | null
  payment_voucher_receipts?: PaymentVoucherReceipt[]
}
