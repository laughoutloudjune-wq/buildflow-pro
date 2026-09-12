'use server'

import {
  getSuppliers as getSuppliersImpl,
  createSupplier as createSupplierImpl,
  updateSupplier as updateSupplierImpl,
  deactivateSupplier as deactivateSupplierImpl,
  getCompanies as getCompaniesImpl,
  createCompany as createCompanyImpl,
  updateCompany as updateCompanyImpl,
  deactivateCompany as deactivateCompanyImpl,
  uploadCompanyAsset as uploadCompanyAssetImpl,
  getSuppliersWithBranches as getSuppliersWithBranchesImpl,
  getSupplierBranches as getSupplierBranchesImpl,
  createSupplierBranch as createSupplierBranchImpl,
  updateSupplierBranch as updateSupplierBranchImpl,
  deactivateSupplierBranch as deactivateSupplierBranchImpl,
} from '@/actions/procurement/vendors'
import {
  getPurchaseRequests as getPurchaseRequestsImpl,
  getPurchaseRequestById as getPurchaseRequestByIdImpl,
  createPurchaseRequest as createPurchaseRequestImpl,
  updatePurchaseRequest as updatePurchaseRequestImpl,
  approvePurchaseRequest as approvePurchaseRequestImpl,
  rejectPurchaseRequest as rejectPurchaseRequestImpl,
  settlePurchaseRequestItems as settlePurchaseRequestItemsImpl,
  undoPurchaseRequestItemSettlement as undoPurchaseRequestItemSettlementImpl,
  getApprovedRequestsForOrder as getApprovedRequestsForOrderImpl,
  getCurrentRequesterId as getCurrentRequesterIdImpl,
  type PurchaseRequestFilters,
} from '@/actions/procurement/requests'
import {
  getPurchaseOrders as getPurchaseOrdersImpl,
  getPurchaseOrderById as getPurchaseOrderByIdImpl,
  getLastMaterialOrderPrice as getLastMaterialOrderPriceImpl,
  createPurchaseOrder as createPurchaseOrderImpl,
  updatePurchaseOrder as updatePurchaseOrderImpl,
  setPurchaseOrderStatus as setPurchaseOrderStatusImpl,
  cancelPurchaseOrder as cancelPurchaseOrderImpl,
  markPurchaseOrderReceived as markPurchaseOrderReceivedImpl,
  unmarkPurchaseOrderReceived as unmarkPurchaseOrderReceivedImpl,
  deletePurchaseOrder as deletePurchaseOrderImpl,
  deletePurchaseOrders as deletePurchaseOrdersImpl,
  duplicatePurchaseOrder as duplicatePurchaseOrderImpl,
  duplicatePurchaseOrders as duplicatePurchaseOrdersImpl,
  type PurchaseOrderFilters,
} from '@/actions/procurement/orders'
import {
  getGoodsReceipts as getGoodsReceiptsImpl,
  getGoodsReceiptsForOrder as getGoodsReceiptsForOrderImpl,
  createGoodsReceipt as createGoodsReceiptImpl,
} from '@/actions/procurement/receipts'
import {
  getPaymentVouchers as getPaymentVouchersImpl,
  getPaymentVoucherById as getPaymentVoucherByIdImpl,
  createPaymentVoucher as createPaymentVoucherImpl,
  voidPaymentVoucher as voidPaymentVoucherImpl,
} from '@/actions/procurement/payments'
import { getMaterialsSummaryForProject as getMaterialsSummaryForProjectImpl } from '@/actions/procurement/materials-summary'

// ---------------------------------------------------------------------------
// Suppliers / Companies
// ---------------------------------------------------------------------------

export async function getSuppliers(activeOnly = true) {
  return getSuppliersImpl(activeOnly)
}

export async function createSupplier(input: Parameters<typeof createSupplierImpl>[0]) {
  return createSupplierImpl(input)
}

export async function updateSupplier(id: string, input: Parameters<typeof updateSupplierImpl>[1]) {
  return updateSupplierImpl(id, input)
}

export async function deactivateSupplier(id: string) {
  return deactivateSupplierImpl(id)
}

export async function getSuppliersWithBranches(activeOnly = true) {
  return getSuppliersWithBranchesImpl(activeOnly)
}

export async function getSupplierBranches(supplierId: string) {
  return getSupplierBranchesImpl(supplierId)
}

export async function createSupplierBranch(input: Parameters<typeof createSupplierBranchImpl>[0]) {
  return createSupplierBranchImpl(input)
}

export async function updateSupplierBranch(id: string, input: Parameters<typeof updateSupplierBranchImpl>[1]) {
  return updateSupplierBranchImpl(id, input)
}

export async function deactivateSupplierBranch(id: string) {
  return deactivateSupplierBranchImpl(id)
}

export async function getCompanies(activeOnly = true) {
  return getCompaniesImpl(activeOnly)
}

export async function createCompany(input: Parameters<typeof createCompanyImpl>[0]) {
  return createCompanyImpl(input)
}

export async function updateCompany(id: string, input: Parameters<typeof updateCompanyImpl>[1]) {
  return updateCompanyImpl(id, input)
}

export async function deactivateCompany(id: string) {
  return deactivateCompanyImpl(id)
}

export async function uploadCompanyAsset(kind: 'logo' | 'signature', formData: FormData) {
  return uploadCompanyAssetImpl(kind, formData)
}

// ---------------------------------------------------------------------------
// Purchase Requests
// ---------------------------------------------------------------------------

export async function getPurchaseRequests(filters: PurchaseRequestFilters = {}) {
  return getPurchaseRequestsImpl(filters)
}

export async function getPurchaseRequestById(id: string) {
  return getPurchaseRequestByIdImpl(id)
}

export async function createPurchaseRequest(input: Parameters<typeof createPurchaseRequestImpl>[0]) {
  return createPurchaseRequestImpl(input)
}

export async function updatePurchaseRequest(id: string, input: Parameters<typeof updatePurchaseRequestImpl>[1]) {
  return updatePurchaseRequestImpl(id, input)
}

export async function approvePurchaseRequest(id: string) {
  return approvePurchaseRequestImpl(id)
}

export async function rejectPurchaseRequest(id: string, note?: string) {
  return rejectPurchaseRequestImpl(id, note)
}

export async function settlePurchaseRequestItems(input: Parameters<typeof settlePurchaseRequestItemsImpl>[0]) {
  return settlePurchaseRequestItemsImpl(input)
}

export async function undoPurchaseRequestItemSettlement(settlementId: string, requestId: string) {
  return undoPurchaseRequestItemSettlementImpl(settlementId, requestId)
}

export async function getApprovedRequestsForOrder(projectId?: string) {
  return getApprovedRequestsForOrderImpl(projectId)
}

export async function getCurrentRequesterId() {
  return getCurrentRequesterIdImpl()
}

// ---------------------------------------------------------------------------
// Purchase Orders
// ---------------------------------------------------------------------------

export async function getPurchaseOrders(filters: PurchaseOrderFilters = {}) {
  return getPurchaseOrdersImpl(filters)
}

export async function getPurchaseOrderById(id: string) {
  return getPurchaseOrderByIdImpl(id)
}

export async function getLastMaterialOrderPrice(materialTypeId: number, excludeOrderId?: string) {
  return getLastMaterialOrderPriceImpl(materialTypeId, excludeOrderId)
}

export async function createPurchaseOrder(input: Parameters<typeof createPurchaseOrderImpl>[0]) {
  return createPurchaseOrderImpl(input)
}

export async function updatePurchaseOrder(id: string, input: Parameters<typeof updatePurchaseOrderImpl>[1]) {
  return updatePurchaseOrderImpl(id, input)
}

export async function setPurchaseOrderStatus(id: string, status: 'draft' | 'sent') {
  return setPurchaseOrderStatusImpl(id, status)
}

export async function cancelPurchaseOrder(id: string, reason?: string) {
  return cancelPurchaseOrderImpl(id, reason)
}

export async function markPurchaseOrderReceived(id: string, receivedAt: string) {
  return markPurchaseOrderReceivedImpl(id, receivedAt)
}

export async function unmarkPurchaseOrderReceived(id: string) {
  return unmarkPurchaseOrderReceivedImpl(id)
}

export async function deletePurchaseOrder(id: string) {
  return deletePurchaseOrderImpl(id)
}

export async function deletePurchaseOrders(ids: string[]) {
  return deletePurchaseOrdersImpl(ids)
}

export async function duplicatePurchaseOrder(id: string) {
  return duplicatePurchaseOrderImpl(id)
}

export async function duplicatePurchaseOrders(ids: string[]) {
  return duplicatePurchaseOrdersImpl(ids)
}

// ---------------------------------------------------------------------------
// Goods Receipts
// ---------------------------------------------------------------------------

export async function getGoodsReceipts() {
  return getGoodsReceiptsImpl()
}

export async function getGoodsReceiptsForOrder(purchaseOrderId: string) {
  return getGoodsReceiptsForOrderImpl(purchaseOrderId)
}

export async function createGoodsReceipt(input: Parameters<typeof createGoodsReceiptImpl>[0]) {
  return createGoodsReceiptImpl(input)
}

// ---------------------------------------------------------------------------
// Payment Vouchers
// ---------------------------------------------------------------------------

export async function getPaymentVouchers() {
  return getPaymentVouchersImpl()
}

export async function getPaymentVoucherById(id: string) {
  return getPaymentVoucherByIdImpl(id)
}

export async function createPaymentVoucher(input: Parameters<typeof createPaymentVoucherImpl>[0]) {
  return createPaymentVoucherImpl(input)
}

export async function voidPaymentVoucher(id: string) {
  return voidPaymentVoucherImpl(id)
}

// ---------------------------------------------------------------------------
// Materials summary (which materials are tagged to a project/plot group)
// ---------------------------------------------------------------------------

export async function getMaterialsSummaryForProject(
  projectId: string,
  opts?: Parameters<typeof getMaterialsSummaryForProjectImpl>[1]
) {
  return getMaterialsSummaryForProjectImpl(projectId, opts)
}
