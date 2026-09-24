// Billing's own error messages are now part of the one shared list in
// lib/errors.ts (Phase 5.1/H-09) - this re-export just keeps every existing
// `import { translateBillingError } from '@/actions/_shared/billing-errors'`
// call site working unchanged.
export { translateError as translateBillingError } from '@/lib/errors'
