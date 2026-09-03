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
} from '@/actions/procurement/vendors'
import {
  getPurchaseRequests as getPurchaseRequestsImpl,
  getPurchaseRequestById as getPurchaseRequestByIdImpl,
  createPurchaseRequest as createPurchaseRequestImpl,
  approvePurchaseRequest as approvePurchaseRequestImpl,
  rejectPurchaseRequest as rejectPurchaseRequestImpl,
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
  markPurchaseOrdersAsPaid as markPurchaseOrdersAsPaidImpl,
  unmarkPurchaseOrderPaid as unmarkPurchaseOrderPaidImpl,
  deletePurchaseOrder as deletePurchaseOrderImpl,
  deletePurchaseOrders as deletePurchaseOrdersImpl,
  duplicatePurchaseOrder as duplicatePurchaseOrderImpl,
  duplicatePurchaseOrders as duplicatePurchaseOrdersImpl,
  type PurchaseOrderFilters,
} from '@/actions/procurement/orders'
import { getGoodsReceiptsForOrder as getGoodsReceiptsForOrderImpl, createGoodsReceipt as createGoodsReceiptImpl } from '@/actions/procurement/receipts'

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

export async function approvePurchaseRequest(id: string) {
  return approvePurchaseRequestImpl(id)
}

export async function rejectPurchaseRequest(id: string, note?: string) {
  return rejectPurchaseRequestImpl(id, note)
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

export async function markPurchaseOrdersAsPaid(ids: string[], paidAt: string) {
  return markPurchaseOrdersAsPaidImpl(ids, paidAt)
}

export async function unmarkPurchaseOrderPaid(id: string) {
  return unmarkPurchaseOrderPaidImpl(id)
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

export async function getGoodsReceiptsForOrder(purchaseOrderId: string) {
  return getGoodsReceiptsForOrderImpl(purchaseOrderId)
}

export async function createGoodsReceipt(input: Parameters<typeof createGoodsReceiptImpl>[0]) {
  return createGoodsReceiptImpl(input)
}
