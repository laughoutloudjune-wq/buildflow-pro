'use server'

import type { BillingPayload } from '@/lib/billing'
import type { BillingApprovalPayload } from '@/lib/types/billing'
import {
  getJobProgressHistory as getJobProgressHistoryImpl,
  getBillingOptions as getBillingOptionsImpl,
  getBillableJobs as getBillableJobsImpl,
} from '@/actions/billing/lookups'
import {
  createBilling as createBillingImpl,
  createBillingRequest as createBillingRequestImpl,
  updateBillingRequest as updateBillingRequestImpl,
  deleteBilling as deleteBillingImpl,
} from '@/actions/billing/requests'
import {
  approveBilling as approveBillingImpl,
  rejectBilling as rejectBillingImpl,
  undoApproveBilling as undoApproveBillingImpl,
  markBillingsAsPaidOut as markBillingsAsPaidOutImpl,
  unmarkBillingsAsPaidOut as unmarkBillingsAsPaidOutImpl,
} from '@/actions/billing/reviews'
import {
  getBillingsByCreator as getBillingsByCreatorImpl,
  getExtraWorkReport as getExtraWorkReportImpl,
  getApprovedContractorCycleReport as getApprovedContractorCycleReportImpl,
  getPlotHistoryReport as getPlotHistoryReportImpl,
  getBillings as getBillingsImpl,
  getBillingById as getBillingByIdImpl,
} from '@/actions/billing/reports'

export async function getJobProgressHistory(jobAssignmentIds: string[]) {
  return getJobProgressHistoryImpl(jobAssignmentIds)
}

export async function getBillingOptions() {
  return getBillingOptionsImpl()
}

export async function getBillableJobs(projectId: string, contractorId: string, plotId?: string) {
  return getBillableJobsImpl(projectId, contractorId, plotId)
}

export async function createBilling(data: BillingPayload) {
  return createBillingImpl(data)
}

export async function createBillingRequest(data: BillingPayload) {
  return createBillingRequestImpl(data)
}

export async function approveBilling(id: string, data: BillingApprovalPayload) {
  return approveBillingImpl(id, data)
}

export async function rejectBilling(id: string, note?: string) {
  return rejectBillingImpl(id, note)
}

export async function undoApproveBilling(id: string) {
  return undoApproveBillingImpl(id)
}

export async function updateBillingRequest(id: string, data: BillingPayload) {
  return updateBillingRequestImpl(id, data)
}

export async function getBillingsByCreator() {
  return getBillingsByCreatorImpl()
}

export async function getExtraWorkReport(filters: {
  projectId?: string
  plotId?: string
  reason?: string
  dateFrom?: string
  dateTo?: string
} = {}) {
  return getExtraWorkReportImpl(filters)
}

export async function getApprovedContractorCycleReport(filters: {
  contractorId?: string
  projectId?: string
  dateFrom?: string
  dateTo?: string
} = {}) {
  return getApprovedContractorCycleReportImpl(filters)
}

export async function getPlotHistoryReport(filters: {
  projectId?: string
  plotId?: string
  dateFrom?: string
  dateTo?: string
} = {}) {
  return getPlotHistoryReportImpl(filters)
}

export async function getBillings() {
  return getBillingsImpl()
}

export async function getBillingById(id: string) {
  return getBillingByIdImpl(id)
}

export async function deleteBilling(id: string) {
  return deleteBillingImpl(id)
}

export async function markBillingsAsPaidOut(billingIds: string[], paidAt: string) {
  return markBillingsAsPaidOutImpl(billingIds, paidAt)
}

export async function unmarkBillingsAsPaidOut(billingIds: string[]) {
  return unmarkBillingsAsPaidOutImpl(billingIds)
}
