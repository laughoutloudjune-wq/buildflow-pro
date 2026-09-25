'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Link2, Loader2, MapPin, Plus, Repeat2, Trash2, X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { todayInBangkok } from '@/lib/utils'
import SearchableSelect from '@/components/ui/SearchableSelect'
import InlineMaterialCreate from '@/components/procurement/InlineMaterialCreate'
import SupplierFormFields from '@/components/procurement/SupplierFormFields'
import { appleCard, appleCardLabel, appleDivider } from '@/components/procurement/appleTheme'
import { getProjects } from '@/actions/project-actions'
import { getPlotsByProjectId } from '@/actions/plot-actions'
import { getMaterialPickerOptions, getPlotGroups, createMaterialType } from '@/actions/material-actions'
import {
  getSuppliersWithBranches,
  getCompanies,
  createSupplier,
  createCompany,
  createPurchaseOrder,
  updatePurchaseOrder,
  getPurchaseRequestById,
  getLastMaterialOrderPrice,
} from '@/actions/procurement-actions'
import { getBoqCheckForDraft } from '@/actions/procurement/boq-control'
import BoqCheckPanel, { type BoqCheckLine } from '@/components/procurement/BoqCheckPanel'
import type { ControlScope } from '@/lib/procurement/boqControl'
import type { MaterialPickerOption, PlotGroup } from '@/lib/types/materials'
import type {
  Supplier,
  Company,
  SupplierInput,
  VatType,
  DiscountType,
  PurchaseOrder,
  PurchaseRequest,
  LastMaterialOrderPrice,
} from '@/lib/types/procurement'

type PlotScope = 'none' | 'plot' | 'group' | 'multi'

// Combined rate+type in one control (no second dropdown) - each option
// carries both the percent and whether it's added on top or already baked
// into the entered prices. No custom % - only these three fixed choices.
const VAT_OPTIONS: { value: string; percent: number; type: VatType; label: string }[] = [
  { value: 'none', percent: 0, type: 'exclusive', label: 'ไม่มี VAT' },
  { value: 'vat7_exclusive', percent: 7, type: 'exclusive', label: 'VAT 7% (แยกภาษี)' },
  { value: 'vat7_inclusive', percent: 7, type: 'inclusive', label: 'VAT 7% (รวมภาษี)' },
]

const PAYMENT_TERM_PRESETS = ['เงินสด (COD)', 'เครดิต 7 วัน', 'เครดิต 15 วัน', 'เครดิต 30 วัน', 'เครดิต 45 วัน', 'เครดิต 60 วัน']
const CUSTOM_TERM = 'อื่นๆ...'
const CUSTOM_MATERIAL_CATEGORY = 'อื่นๆ (ระบุใหม่)...'

// One mode drives discounting for the whole order - either a single
// whole-order discount (percent/amount) or a per-line amount typed on each
// product row. Never both at once.
type DiscountMode = 'none' | 'percent' | 'amount' | 'individual'

const DISCOUNT_MODE_LABEL: Record<DiscountMode, string> = {
  none: 'ไม่มีส่วนลด',
  percent: 'ส่วนลด (%)',
  amount: 'ส่วนลด (บาท)',
  individual: 'ส่วนลดรายรายการ',
}

const emptySupplierDraft: SupplierInput = {
  name: '',
  supplier_type: 'company',
  contact_name: '',
  phone: '',
  email: '',
  address: '',
  tax_id: '',
  branch_code: '',
  payment_terms: '',
}
const emptyCompanyDraft = { name: '', tax_id: '', address: '', phone: '' }
const emptyMaterialDraft = { name: '', unit: '', category: '', price: '' }

type Line = {
  /** Existing purchase_order_item id when this line already exists on the
   * order (null for a freshly-added line) - carried through to po_update so
   * it can preserve quantity_received / the goods_receipt_items FK instead
   * of recreating the row. */
  id: string | null
  quantity_received: number
  material_type_id: number
  /** Name/unit carried straight from this line's own joined material_types
   * row (unfiltered by is_active), so a material deactivated after this
   * order was placed still shows its real name here instead of falling back
   * to the picker's active-only list and rendering blank - see M-0x. Null
   * for a freshly-added line, which always has an active material anyway
   * (the picker itself only offers active ones). */
  material_name: string | null
  material_unit: string | null
  purchase_request_item_id: string | null
  quantity_ordered: string
  /** Purchasing's answer: this order covers the request line this came from.
   * When the order's unit and the request's differ nothing can be
   * subtracted, so this is the only thing that closes the line. */
  closes_request_line: boolean
  unit_price: string
  description: string
  discountValue: string
  /** This line's own project/plot, when it's for something other than the
   * order's own scope (e.g. a low-stock top-up for a different job, thrown
   * in with the main order to the same supplier). Null on all three means
   * "use the order's own project_id/plot_id/plot_group_id" - the default
   * for every line nobody has overridden. */
  project_id: string | null
  plot_id: string | null
  plot_group_id: string | null
  /** Order-time guess at where this line will physically unload - pre-fills
   * the goods receipt's destination toggle later, nothing more. Null means
   * "not decided yet". */
  intended_destination: 'store' | 'site' | null
}

const fieldLabel = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#86868b]'
const readOnlyBox = 'rounded-[10px] border border-[#e8e8ed] bg-[#f5f5f7] px-3 py-2 text-[13px] text-[#1d1d1f]'
const readOnlyRow = 'flex items-center justify-between gap-3'

function lineDiscountAmount(line: Line, gross: number, mode: DiscountMode): number {
  if (mode !== 'individual') return 0
  return Math.min(Math.max(Number(line.discountValue) || 0, 0), gross)
}

function formatMoney(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function vatOptionFor(percent: number, type: VatType): string {
  if (percent === 0) return 'none'
  return type === 'inclusive' ? 'vat7_inclusive' : 'vat7_exclusive'
}

/** Says which purchase request line this order line settles - and, more
 * usefully, when it settles nothing. Only a line carrying a
 * purchase_request_item_id decrements the request; changing the material on
 * a prefilled row keeps that link (so a brand substitution still settles the
 * line it replaced), but deleting the row and adding a fresh one drops it,
 * leaving the request outstanding forever with no sign on screen. Rendered
 * only for orders raised from a request. */
function RequestLinkNote({
  line,
  requestLines,
}: {
  line: Line
  requestLines: Record<string, { name: string; materialTypeId: number }>
}) {
  if (!line.purchase_request_item_id) {
    return (
      <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-tight text-amber-700">
        <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
        <span>ไม่ได้ตัดยอดจากคำขอซื้อ - รายการนี้จะไม่ลดจำนวนคงเหลือในคำขอ</span>
      </p>
    )
  }

  const source = requestLines[line.purchase_request_item_id]
  if (!source) return null

  const substituted = line.material_type_id > 0 && line.material_type_id !== source.materialTypeId
  return (
    <p
      className={`mt-1.5 flex items-start gap-1 text-[11px] leading-tight ${
        substituted ? 'text-indigo-600' : 'text-[#86868b]'
      }`}
    >
      {substituted ? (
        <Repeat2 className="mt-px h-3 w-3 shrink-0" />
      ) : (
        <Link2 className="mt-px h-3 w-3 shrink-0" />
      )}
      <span>
        {substituted ? 'ตัดยอดแทน: ' : 'ตัดยอดจากคำขอ: '}
        {source.name}
      </span>
    </p>
  )
}

/** The three small lookups the form needs before it can render anything.
 * Supplied by the server component that renders the form so the first paint
 * already has them - fetching these after hydration meant the whole form sat
 * behind a spinner (see the `isLoading` gate below) until a round trip
 * completed, which is what made /dashboard/procurement/orders/create the
 * worst Largest Contentful Paint in the app. The material catalog is
 * deliberately NOT part of this: it is ~1000 rows / ~200KB and isn't needed
 * until the user opens a line-item picker, so it stays a client fetch. */
export type PurchaseOrderFormOptions = {
  projects: { id: string; name: string; location: string | null; delivery_address: string | null }[]
  suppliers: Supplier[]
  companies: Company[]
}

export type PurchaseOrderFormHandle = { submit: () => void }

const PurchaseOrderForm = forwardRef<PurchaseOrderFormHandle, {
  mode: 'create' | 'edit'
  orderId?: string
  fromRequestId?: string | null
  initialOrder?: PurchaseOrder | null
  initialOptions?: PurchaseOrderFormOptions
  readOnly?: boolean
  /** Edit mode only: when set (the orders-list quick-view modal), a save
   * calls this instead of navigating to the order's own page - there's
   * nowhere to navigate to from inside a dialog that's already showing it. */
  onSaved?: () => void
  /** Same modal case: suppresses this form's own bottom action bar (fixed
   * to the viewport, which escapes the modal's bounds entirely) - the modal
   * renders its own footer instead, driven by `ref` and `onStateChange`. */
  onClose?: () => void
  /** Modal case: reports the live total and pending state up to the modal's
   * own footer on every change, since that footer is rendered outside this
   * component (in Modal's `footer` slot) and has no other way to know them. */
  onStateChange?: (state: { total: number; isPending: boolean }) => void
}>(function PurchaseOrderForm({
  mode,
  orderId,
  fromRequestId,
  initialOrder,
  initialOptions,
  readOnly = false,
  onSaved,
  onClose,
  onStateChange,
}, ref) {
  const router = useRouter()

  // With options in hand there is nothing left to await before the form can
  // paint - unless this is a create-from-request, which still has to load the
  // source PR to prefill its lines.
  const [isLoading, setIsLoading] = useState(!initialOptions || Boolean(fromRequestId))
  // Flips true exactly once, after bootstrap()'s fields are fully settled -
  // including the awaited purchase-request lookup for a PR-linked order - so
  // the unsaved-changes snapshot below captures real loaded values instead of
  // the empty pre-load state.
  const [hasLoadedFields, setHasLoadedFields] = useState(false)
  const [isPending, startTransition] = useTransition()
  const toast = useToast()

  const [projects, setProjects] = useState<
    { id: string; name: string; location: string | null; delivery_address: string | null }[]
  >(initialOptions?.projects ?? [])
  const [plots, setPlots] = useState<{ id: string; name: string }[]>([])
  const [plotGroups, setPlotGroups] = useState<PlotGroup[]>([])
  const [isPlotsLoading, setIsPlotsLoading] = useState(false)
  // Per-line scope override picker: plots/groups for whichever OTHER
  // project a line points at, fetched on demand and cached by project id so
  // picking the same alternate project on several lines only fetches once.
  // Keyed separately from `plots`/`plotGroups` above (the main order's own
  // project) since a line's override project is usually not that one.
  const [altScopes, setAltScopes] = useState<Record<string, { plots: { id: string; name: string }[]; plotGroups: PlotGroup[] }>>({})
  const [loadingAltScopes, setLoadingAltScopes] = useState<Record<string, boolean>>({})

  async function loadAltScope(projectIdForLine: string) {
    if (!projectIdForLine || altScopes[projectIdForLine] || loadingAltScopes[projectIdForLine]) return
    setLoadingAltScopes((prev) => ({ ...prev, [projectIdForLine]: true }))
    try {
      const [p, g] = await Promise.all([getPlotsByProjectId(projectIdForLine), getPlotGroups(projectIdForLine)])
      setAltScopes((prev) => ({
        ...prev,
        [projectIdForLine]: { plots: (p as { id: string; name: string }[]) || [], plotGroups: g || [] },
      }))
    } catch {
      // Best-effort - the picker just shows no options for this project if it fails.
    } finally {
      setLoadingAltScopes((prev) => ({ ...prev, [projectIdForLine]: false }))
    }
  }
  // Fetched separately from bootstrap() and not gating isLoading: the
  // material catalog is 1000+ rows and was blocking the whole form behind a
  // spinner while everything else (projects/suppliers/companies - a handful
  // of rows each) was long since ready. The line-item material picker shows
  // its own loading state instead.
  const [materials, setMaterials] = useState<MaterialPickerOption[]>([])
  const [isMaterialsLoading, setIsMaterialsLoading] = useState(true)
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialOptions?.suppliers ?? [])
  const [companies, setCompanies] = useState<Company[]>(initialOptions?.companies ?? [])

  const [projectId, setProjectId] = useState('')
  const [plotScope, setPlotScope] = useState<PlotScope>('none')
  const [plotId, setPlotId] = useState('')
  const [plotGroupId, setPlotGroupId] = useState('')
  // Ad-hoc multi-plot selection ('multi' scope) - any combination of the
  // project's plots, not limited to a pre-saved plot_groups batch.
  const [plotIds, setPlotIds] = useState<string[]>([])
  const [supplierId, setSupplierId] = useState('')
  /** Which สาขา of the supplier is billing this order. Only ever set for
   * suppliers that actually have branches; '' means the supplier's own
   * record supplies the branch code and address, exactly as before. */
  const [supplierBranchId, setSupplierBranchId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [vatOption, setVatOption] = useState('vat7_exclusive')
  const [orderDate, setOrderDate] = useState(() => todayInBangkok())
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('')
  // Free-form delivery note, typed per order - not derived from the
  // project's address.
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [status, setStatus] = useState<'draft' | 'sent'>('sent')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [discountMode, setDiscountMode] = useState<DiscountMode>('none')
  const [discountValue, setDiscountValue] = useState('')
  const [note, setNote] = useState('')
  // Common area, office supplies, machinery - purchases with no BOQ line at
  // all. Flagged explicitly so they're excluded from the BOQ control
  // rollup instead of quietly inflating every material's variance.
  const [isOutsideBoq, setIsOutsideBoq] = useState(false)
  const [outsideBoqReason, setOutsideBoqReason] = useState('')
  const [draftBoqLines, setDraftBoqLines] = useState<BoqCheckLine[]>([])
  const [lines, setLines] = useState<Line[]>([])
  // Keyed by material_type_id (not line index) so materials repeated across
  // lines share one fetch. A missing key means "not fetched yet"; an
  // explicit null means "fetched, no prior order found" - both read as
  // falsy, so the effect below only checks key presence via `in`.
  const [lastPrices, setLastPrices] = useState<Record<number, LastMaterialOrderPrice | null>>({})

  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false)
  const [supplierDraft, setSupplierDraft] = useState(emptySupplierDraft)
  const [isSavingSupplier, setIsSavingSupplier] = useState(false)

  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false)
  const [companyDraft, setCompanyDraft] = useState(emptyCompanyDraft)
  const [isSavingCompany, setIsSavingCompany] = useState(false)

  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false)
  const [materialDraft, setMaterialDraft] = useState(emptyMaterialDraft)
  const [isCustomMaterialCategory, setIsCustomMaterialCategory] = useState(false)
  const [isSavingMaterial, setIsSavingMaterial] = useState(false)
  const [materialModalLineIndex, setMaterialModalLineIndex] = useState<number | null>(null)
  /** The source request's lines, keyed by purchase_request_item_id, so each
   * PO line can say which request line it settles. Only a line carrying that
   * id decrements the request - swapping the material on a prefilled row
   * keeps it, but deleting the row and adding a fresh one silently drops it,
   * which used to be invisible until the request sat at 'approved' forever.
   * Empty for an order not raised from a request. */
  const [requestLines, setRequestLines] = useState<Record<string, { name: string; materialTypeId: number; unit: string }>>({})
  /** Set only when this order is tied to a request, so the "not settling
   * anything" hint stays quiet on ordinary standalone orders where an
   * unlinked line is simply normal. */
  const [sourceRequestNo, setSourceRequestNo] = useState<number | null>(null)

  useEffect(() => {
    void bootstrap()
    void loadMaterials()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadMaterials() {
    setIsMaterialsLoading(true)
    try {
      setMaterials(await getMaterialPickerOptions())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดรายการวัสดุไม่สำเร็จ')
    } finally {
      setIsMaterialsLoading(false)
    }
  }

  /** Remember which request line each id refers to, and what material was
   * asked for on it - the PO line may well have been swapped to a different
   * brand, which is exactly the case worth showing. */
  function indexRequestLines(request: PurchaseRequest) {
    setSourceRequestNo(request.pr_no)
    setRequestLines(
      Object.fromEntries(
        (request.purchase_request_items || []).map((item) => [
          item.id,
          {
            name: item.material_types?.name || '-',
            materialTypeId: item.material_type_id,
            unit: item.unit || item.material_types?.unit || '',
          },
        ])
      )
    )
  }

  async function bootstrap() {
    setIsLoading(true)
    try {
      // Already seeded from server props - skip the round trip entirely.
      if (!initialOptions) {
        const [p, s, c] = await Promise.all([getProjects({ includeOverhead: true }), getSuppliersWithBranches(), getCompanies()])
        setProjects(p as PurchaseOrderFormOptions['projects'])
        setSuppliers(s)
        setCompanies(c)
      }

      if (mode === 'edit' && initialOrder) {
        setProjectId(initialOrder.project_id)
        if (initialOrder.plot_group_id) {
          setPlotScope('group')
          setPlotGroupId(initialOrder.plot_group_id)
        } else if (initialOrder.plot_id) {
          setPlotScope('plot')
          setPlotId(initialOrder.plot_id)
        } else if (initialOrder.purchase_order_plots && initialOrder.purchase_order_plots.length > 0) {
          setPlotScope('multi')
          setPlotIds(initialOrder.purchase_order_plots.map((p) => p.plot_id))
        }
        setSupplierId(initialOrder.supplier_id)
        setSupplierBranchId(initialOrder.supplier_branch_id || '')
        setCompanyId(initialOrder.company_id)
        setOrderDate(initialOrder.order_date)
        setExpectedDeliveryDate(initialOrder.expected_delivery_date || '')
        setDeliveryAddress(initialOrder.delivery_address || '')
        setStatus(initialOrder.status === 'draft' ? 'draft' : 'sent')
        setPaymentTerms(initialOrder.payment_terms || '')
        setVatOption(vatOptionFor(initialOrder.vat_percent, initialOrder.vat_type))

        const items = initialOrder.purchase_order_items || []
        const hasIndividualDiscounts = items.some((item) => item.discount_amount > 0)
        if (hasIndividualDiscounts) {
          setDiscountMode('individual')
        } else if (initialOrder.discount_type !== 'none') {
          setDiscountMode(initialOrder.discount_type as DiscountMode)
          setDiscountValue(initialOrder.discount_value ? String(initialOrder.discount_value) : '')
        }

        setNote(initialOrder.note || '')
        setIsOutsideBoq(initialOrder.is_outside_boq || false)
        setOutsideBoqReason(initialOrder.outside_boq_reason || '')
        setLines(
          items.map((item) => ({
            id: item.id,
            quantity_received: item.quantity_received,
            material_type_id: item.material_type_id,
            material_name: item.material_types?.name || null,
            material_unit: item.material_types?.unit || null,
            purchase_request_item_id: item.purchase_request_item_id,
            quantity_ordered: String(item.quantity_ordered),
            closes_request_line: item.closes_request_line,
            unit_price: String(item.unit_price),
            description: item.description || '',
            discountValue: item.discount_amount ? String(item.discount_amount) : '',
            project_id: item.project_id,
            plot_id: item.plot_id,
            plot_group_id: item.plot_group_id,
            intended_destination: item.intended_destination,
          }))
        )
        // Pre-warm the alt-scope cache with each overridden line's own
        // project so its picker doesn't show a blank plot list on first
        // render (see loadAltScope below).
        for (const item of items) {
          if (item.project_id) void loadAltScope(item.project_id)
        }

        // Only for an order raised from a request - otherwise there is no
        // request line for anything here to settle.
        if (initialOrder.purchase_request_id) {
          const pr = await getPurchaseRequestById(initialOrder.purchase_request_id)
          if (pr) indexRequestLines(pr)
        }
      } else if (mode === 'create' && fromRequestId) {
        const pr = await getPurchaseRequestById(fromRequestId)
        if (pr) {
          indexRequestLines(pr)
          setProjectId(pr.project_id)
          // Same prefill as picking the site by hand - this path sets the
          // project directly, so it would otherwise skip it. Nothing has been
          // typed yet on a fresh create-from-request, so there's nothing to
          // preserve here.
          const requestProject = (initialOptions?.projects ?? []).find((p) => p.id === pr.project_id)
          if (requestProject?.delivery_address) setDeliveryAddress(requestProject.delivery_address)
          if (pr.plot_group_id) {
            setPlotScope('group')
            setPlotGroupId(pr.plot_group_id)
          } else if (pr.plot_id) {
            setPlotScope('plot')
            setPlotId(pr.plot_id)
          } else if (pr.purchase_request_plots && pr.purchase_request_plots.length > 0) {
            setPlotScope('multi')
            setPlotIds(pr.purchase_request_plots.map((p) => p.plot_id))
          }
          setNote(pr.note || '')
          setLines(
            // quantity_requested tracks what's still outstanding, not the
            // original ask - a line a prior PO already fully covered sits
            // at 0 and has nothing left to prefill here.
            (pr.purchase_request_items || [])
              .filter((item) => item.quantity_requested > 0)
              .map((item) => ({
                id: null,
                quantity_received: 0,
                material_type_id: item.material_type_id,
                material_name: item.material_types?.name || null,
                material_unit: item.material_types?.unit || null,
                purchase_request_item_id: item.id,
                quantity_ordered: String(item.quantity_requested),
                // Pre-answered when the request asked in a unit this order
                // can't be placed in - the supplier sells by the material's
                // own unit, so nothing can be subtracted and only this
                // closes the line.
                closes_request_line: Boolean(
                  item.unit && item.material_types?.unit && item.unit !== item.material_types.unit
                ),
                unit_price: String(item.material_types?.current_price ?? 0),
                description: '',
                discountValue: '',
                project_id: null,
                plot_id: null,
                plot_group_id: null,
                intended_destination: null,
              }))
          )
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setIsLoading(false)
      setHasLoadedFields(true)
    }
  }

  useEffect(() => {
    if (!projectId) {
      setPlots([])
      setPlotGroups([])
      return
    }
    setIsPlotsLoading(true)
    Promise.all([getPlotsByProjectId(projectId), getPlotGroups(projectId)])
      .then(([p, g]) => {
        setPlots((p as { id: string; name: string }[]) || [])
        setPlotGroups(g)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลแปลงไม่สำเร็จ'))
      .finally(() => setIsPlotsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Derived to a stable, sorted string so the effect below only re-runs when
  // the actual set of materials on the order changes - not on every
  // keystroke in an unrelated field, which would otherwise re-create the
  // `lines` array reference on each render.
  const materialIdsKey = useMemo(
    () =>
      Array.from(new Set(lines.map((l) => l.material_type_id).filter((id) => id > 0)))
        .sort((a, b) => a - b)
        .join(','),
    [lines]
  )

  useEffect(() => {
    if (!materialIdsKey) return
    const ids = materialIdsKey.split(',').map(Number)
    const toFetch = ids.filter((id) => !(id in lastPrices))
    if (toFetch.length === 0) return
    // Mark as in-flight immediately so a re-render before the fetches
    // resolve doesn't re-trigger the same requests.
    setLastPrices((prev) => {
      const next = { ...prev }
      toFetch.forEach((id) => {
        next[id] = null
      })
      return next
    })
    toFetch.forEach((id) => {
      getLastMaterialOrderPrice(id, mode === 'edit' ? orderId : undefined)
        .then((result) => setLastPrices((prev) => ({ ...prev, [id]: result })))
        .catch(() => {
          /* comparison is a convenience, not worth surfacing an error toast for */
        })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialIdsKey])

  // Same stability trick as materialIdsKey - only re-run the BOQ draft
  // check when a material, its quantity, or its own scope override changes.
  const draftLinesKey = useMemo(
    () =>
      lines
        .filter((l) => l.material_type_id > 0 && Number(l.quantity_ordered) > 0)
        .map(
          (l) =>
            `${l.material_type_id}:${Number(l.quantity_ordered)}:${l.project_id || ''}:${l.plot_id || ''}:${l.plot_group_id || ''}`
        )
        .sort()
        .join(','),
    [lines]
  )
  // What this same PO already contributes today, per material - subtracted
  // back out server-side so editing an existing PO doesn't double-count the
  // portion that hasn't changed (BOQ_CONTROL_PLAN.md 10).
  const excludeQuantitiesByMaterial = useMemo(() => {
    if (mode !== 'edit' || !initialOrder) return undefined
    const map: Record<number, number> = {}
    for (const item of initialOrder.purchase_order_items || []) {
      map[item.material_type_id] = (map[item.material_type_id] || 0) + Number(item.quantity_ordered || 0)
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, initialOrder?.id])

  const draftScope: ControlScope | null = !projectId
    ? null
    : plotScope === 'plot' && plotId
      ? { projectId, plotIds: [plotId] }
      : plotScope === 'group' && plotGroupId
        ? { projectId, plotGroupId }
        : plotScope === 'multi' && plotIds.length > 0
          ? { projectId, plotIds }
          : null

  useEffect(() => {
    if (readOnly || isOutsideBoq || !draftScope || !draftLinesKey) {
      setDraftBoqLines([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      const items = draftLinesKey.split(',').map((pair) => {
        const [materialTypeId, quantity, lineProjectId, linePlotId, linePlotGroupId] = pair.split(':')
        const override = lineProjectId
          ? { project_id: lineProjectId, plot_id: linePlotId || null, plot_group_id: linePlotGroupId || null }
          : null
        return {
          materialTypeId: Number(materialTypeId),
          quantity: Number(quantity),
          scope: override
            ? { projectId: lineProjectId, plotGroupId: linePlotGroupId || null, plotIds: linePlotId ? [linePlotId] : [] }
            : undefined,
          scopeLabel: override ? overrideSummary(override) : undefined,
        }
      })
      getBoqCheckForDraft(draftScope, items, excludeQuantitiesByMaterial)
        .then((result) => {
          if (!cancelled) setDraftBoqLines(result.lines)
        })
        .catch(() => {
          // Best-effort early warning - never blocks the form.
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, isOutsideBoq, draftScope?.projectId, draftScope?.plotGroupId, (draftScope?.plotIds || []).join(','), draftLinesKey])

  const selectedSupplier = useMemo(() => suppliers.find((s) => s.id === supplierId) || null, [suppliers, supplierId])
  const supplierBranches = useMemo(
    () => selectedSupplier?.supplier_branches || [],
    [selectedSupplier]
  )
  const selectedBranch = useMemo(
    () => supplierBranches.find((b) => b.id === supplierBranchId) || null,
    [supplierBranches, supplierBranchId]
  )
  const selectedCompany = useMemo(() => companies.find((c) => c.id === companyId) || null, [companies, companyId])
  // Picking from what's already in the catalog (instead of free text) keeps
  // it from accumulating near-duplicate spellings of the same category.
  const existingMaterialCategories = useMemo(() => {
    const set = new Set(materials.map((m) => m.category).filter((c): c is string => !!c && c.trim() !== ''))
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'))
  }, [materials])

  // Snapshot of every field that ends up in the save payload. Compared on
  // every render against the value captured just after load (see
  // hasLoadedFields) to drive the unsaved-changes warning below - a ref, not
  // state, since taking the snapshot must never itself trigger a re-render.
  const dirtySnapshot = useMemo(
    () =>
      JSON.stringify({
        projectId,
        plotScope,
        plotId,
        plotGroupId,
        plotIds,
        supplierId,
        supplierBranchId,
        companyId,
        vatOption,
        orderDate,
        expectedDeliveryDate,
        deliveryAddress,
        paymentTerms,
        discountMode,
        discountValue,
        note,
        isOutsideBoq,
        outsideBoqReason,
        lines,
      }),
    [
      projectId,
      plotScope,
      plotId,
      plotGroupId,
      plotIds,
      supplierId,
      supplierBranchId,
      companyId,
      vatOption,
      orderDate,
      expectedDeliveryDate,
      deliveryAddress,
      paymentTerms,
      discountMode,
      discountValue,
      note,
      isOutsideBoq,
      outsideBoqReason,
      lines,
    ]
  )
  const initialSnapshotRef = useRef<string | null>(null)
  useEffect(() => {
    if (hasLoadedFields && initialSnapshotRef.current === null) {
      initialSnapshotRef.current = dirtySnapshot
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLoadedFields])
  const isDirty = mode === 'edit' && !readOnly && initialSnapshotRef.current !== null && dirtySnapshot !== initialSnapshotRef.current

  // Editing a PO takes real effort (line items, prices, BOQ scope) that a
  // stray sidebar click or "กลับ" tap would throw away silently. Native
  // confirmation for a full unload, and the same question before any in-app
  // link navigates away, since Next's router has no built-in nav guard. Does
  // not catch the browser back/forward button - popstate-based traps are
  // unreliable enough (double-press, corrupted forward history) that they
  // cost more than the edge case they'd cover.
  //
  // The click has to be preventDefault'd synchronously (that's the only way
  // to actually stop the navigation), so the in-app dialog below can't ask
  // first the way every other confirm() in this app does - it holds the
  // target URL and navigates to it itself once confirmed.
  const [pendingNavUrl, setPendingNavUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!isDirty) return
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    function handleDocumentClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      // Opens a new tab or triggers a file download rather than navigating
      // this one away - print/download PO links live on this same page.
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      e.preventDefault()
      e.stopPropagation()
      setPendingNavUrl(anchor.href)
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleDocumentClick, true)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [isDirty])

  function handleSelectSupplier(id: string) {
    setSupplierId(id)
    const supplier = suppliers.find((s) => s.id === id)
    setPaymentTerms(supplier?.payment_terms || '')
    // A branch belongs to exactly one supplier, and po_create rejects a
    // mismatch - so changing supplier has to clear it rather than carry a
    // now-invalid id into the payload. Auto-select when there's only one
    // real choice, since leaving it blank would just be a required click.
    const branches = supplier?.supplier_branches || []
    setSupplierBranchId(branches.length === 1 ? branches[0].id : '')
  }

  function handleStatusPillClick(next: 'draft' | 'sent') {
    setStatus(next)
  }

  async function handleCreateSupplier() {
    if (!supplierDraft.name.trim()) {
      toast.error('กรุณาใส่ชื่อผู้จำหน่าย')
      return
    }
    setIsSavingSupplier(true)
    const created = await createSupplier(supplierDraft)
    if ('error' in created) {
      toast.error(created.error)
    } else {
      setSuppliers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'th')))
      setSupplierId(created.id)
      setPaymentTerms(created.payment_terms || '')
      setIsSupplierModalOpen(false)
      setSupplierDraft(emptySupplierDraft)
    }
    setIsSavingSupplier(false)
  }

  async function handleCreateCompany() {
    if (!companyDraft.name.trim()) {
      toast.error('กรุณาใส่ชื่อบริษัท')
      return
    }
    setIsSavingCompany(true)
    const created = await createCompany(companyDraft)
    if ('error' in created) {
      toast.error(created.error)
    } else {
      setCompanies((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'th')))
      setCompanyId(created.id)
      setIsCompanyModalOpen(false)
      setCompanyDraft(emptyCompanyDraft)
    }
    setIsSavingCompany(false)
  }

  function openMaterialModal(lineIndex: number) {
    setMaterialModalLineIndex(lineIndex)
    setMaterialDraft(emptyMaterialDraft)
    setIsCustomMaterialCategory(false)
    setIsMaterialModalOpen(true)
  }

  async function handleCreateMaterial() {
    if (!materialDraft.name.trim()) {
      toast.error('กรุณาใส่ชื่อวัสดุ')
      return
    }
    if (!materialDraft.unit.trim()) {
      toast.error('กรุณาใส่หน่วยนับ')
      return
    }
    const price = parseFloat(materialDraft.price)
    if (materialDraft.price.trim() !== '' && (!Number.isFinite(price) || price < 0)) {
      toast.error('กรุณาใส่ราคาที่ถูกต้อง')
      return
    }
    setIsSavingMaterial(true)
    try {
      const created = await createMaterialType(
        materialDraft.name,
        materialDraft.unit,
        Number.isFinite(price) ? price : 0,
        materialDraft.category
      )
      setMaterials((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'th')))
      if (materialModalLineIndex !== null) {
        updateLine(materialModalLineIndex, { material_type_id: created.id })
      }
      setIsMaterialModalOpen(false)
      setMaterialDraft(emptyMaterialDraft)
      setMaterialModalLineIndex(null)
      toast.success('เพิ่มวัสดุใหม่แล้ว')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'เพิ่มวัสดุไม่สำเร็จ')
    } finally {
      setIsSavingMaterial(false)
    }
  }

  /** A material created from inside a line's picker: fold it into the loaded
   * catalog so the option exists, and select it on that line straight away -
   * the whole point is not having to go back and find it. */
  function handleInlineMaterialCreated(lineIndex: number, created: MaterialPickerOption) {
    setMaterials((prev) =>
      [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'th'))
    )
    updateLine(lineIndex, { material_type_id: created.id })
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        id: null,
        quantity_received: 0,
        material_type_id: 0,
        material_name: null,
        material_unit: null,
        purchase_request_item_id: null,
        quantity_ordered: '',
        closes_request_line: false,
        unit_price: '',
        description: '',
        discountValue: '',
        project_id: null,
        plot_id: null,
        plot_group_id: null,
        intended_destination: null,
      },
    ])
  }

  /** The unit this order line transacts in. Always the material's own unit -
   * a PO goes to a supplier, who sells in exactly one unit, so there is
   * nothing here for purchasing to choose. */
  // Falls back to the line's own embedded material_unit (from the order's
  // joined material_types row, unfiltered by is_active) when the material
  // isn't in the active-only picker list anymore - otherwise a deactivated
  // material's unit silently renders as "-" on an order that already used it.
  function materialUnit(line: Line): string {
    return materials.find((m) => m.id === line.material_type_id)?.unit || line.material_unit || ''
  }

  /** True when the request asked in a different unit than this order can be
   * placed in - the case where nothing can be subtracted and the tick box is
   * the only thing that can close the line. False for a standalone line. */
  function differsFromRequestUnit(line: Line): boolean {
    if (!line.purchase_request_item_id) return false
    const source = requestLines[line.purchase_request_item_id]
    if (!source?.unit) return false
    const thisUnit = materialUnit(line)
    return Boolean(thisUnit) && thisUnit !== source.unit
  }

  /** Swapping the material can change whether the arithmetic is even capable
   * of closing the line, so the default answer moves with it. Only called
   * from the material picker, never on every render, so an answer the user
   * has already given by hand is never overwritten. */
  function withDefaultAnswer(line: Line, patch: Partial<Line>): Partial<Line> {
    const next = { ...line, ...patch }
    return { ...patch, closes_request_line: differsFromRequestUnit(next) }
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function removeLine(index: number) {
    if (lines[index]?.quantity_received > 0) {
      toast.error('ลบรายการนี้ไม่ได้ เนื่องจากมีการรับของแล้ว ลดจำนวนแทนได้')
      return
    }
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  const selectedVat = VAT_OPTIONS.find((o) => o.value === vatOption) || VAT_OPTIONS[0]
  const vatPercent = selectedVat.percent
  const vatType = selectedVat.type

  const isPresetTerm = !paymentTerms || PAYMENT_TERM_PRESETS.includes(paymentTerms)

  const grossSubtotal = lines.reduce((sum, l) => sum + (Number(l.quantity_ordered) || 0) * (Number(l.unit_price) || 0), 0)
  const lineDiscountTotal = lines.reduce((sum, l) => {
    const gross = (Number(l.quantity_ordered) || 0) * (Number(l.unit_price) || 0)
    return sum + lineDiscountAmount(l, gross, discountMode)
  }, 0)
  const afterLineDiscounts = grossSubtotal - lineDiscountTotal
  const poDiscountAmount =
    discountMode === 'percent'
      ? (afterLineDiscounts * Math.min(Math.max(Number(discountValue) || 0, 0), 100)) / 100
      : discountMode === 'amount'
        ? Math.min(Math.max(Number(discountValue) || 0, 0), afterLineDiscounts)
        : 0
  const netOfDiscounts = afterLineDiscounts - poDiscountAmount

  let taxable: number
  let vatAmount: number
  let total: number
  if (vatType === 'inclusive' && vatPercent > 0) {
    taxable = netOfDiscounts / (1 + vatPercent / 100)
    vatAmount = netOfDiscounts - taxable
    total = netOfDiscounts
  } else {
    taxable = netOfDiscounts
    vatAmount = taxable * (vatPercent / 100)
    total = taxable + vatAmount
  }

  function handleSubmit() {
    if (!projectId) return toast.error('กรุณาเลือกโครงการ')
    if (!supplierId) return toast.error('กรุณาเลือกผู้จำหน่าย')
    if (!companyId) return toast.error('กรุณาเลือกบริษัทผู้ซื้อ')
    if (plotScope === 'plot' && !plotId) return toast.error('กรุณาเลือกแปลง')
    if (plotScope === 'group' && !plotGroupId) return toast.error('กรุณาเลือกกลุ่มแปลง')
    if (plotScope === 'multi' && plotIds.length === 0) return toast.error('กรุณาเลือกแปลงอย่างน้อย 1 แปลง')
    const validLines = lines.filter((l) => l.material_type_id && Number(l.quantity_ordered) > 0)
    if (validLines.length === 0) return toast.error('กรุณาเพิ่มรายการวัสดุอย่างน้อย 1 รายการ')
    const droppedReceivedLine = lines.some((l) => l.quantity_received > 0 && !(l.material_type_id && Number(l.quantity_ordered) >= l.quantity_received))
    if (droppedReceivedLine) return toast.error('มีรายการที่รับของแล้วแต่จำนวนสั่งซื้อน้อยกว่าจำนวนที่รับ กรุณาแก้ไขก่อนบันทึก')
    if (isOutsideBoq && !outsideBoqReason.trim()) return toast.error('กรุณาระบุเหตุผลที่ซื้อนอก BOQ')

    const payload = {
      supplier_id: supplierId,
      supplier_branch_id: supplierBranchId || null,
      company_id: companyId,
      project_id: projectId,
      plot_id: plotScope === 'plot' ? plotId : null,
      plot_group_id: plotScope === 'group' ? plotGroupId : null,
      plot_ids: plotScope === 'multi' ? plotIds : [],
      purchase_request_id: fromRequestId || null,
      order_date: orderDate,
      expected_delivery_date: expectedDeliveryDate || null,
      delivery_address: deliveryAddress,
      vat_percent: vatPercent,
      vat_type: vatType,
      payment_terms: paymentTerms,
      discount_type: (discountMode === 'individual' ? 'none' : discountMode) as DiscountType,
      discount_value: discountMode === 'individual' ? 0 : Number(discountValue) || 0,
      note,
      is_outside_boq: isOutsideBoq,
      outside_boq_reason: isOutsideBoq ? outsideBoqReason.trim() : null,
      items: validLines.map((l) => ({
        id: l.id,
        material_type_id: l.material_type_id,
        purchase_request_item_id: l.purchase_request_item_id,
        quantity_ordered: Number(l.quantity_ordered),
        closes_request_line: Boolean(l.purchase_request_item_id) && l.closes_request_line,
        unit_price: Number(l.unit_price) || 0,
        description: l.description,
        discount_type: (discountMode === 'individual' && Number(l.discountValue) > 0 ? 'amount' : 'none') as DiscountType,
        discount_value: discountMode === 'individual' ? Number(l.discountValue) || 0 : 0,
        project_id: l.project_id,
        plot_id: l.plot_id,
        plot_group_id: l.plot_group_id,
        intended_destination: l.intended_destination,
      })),
    }

    startTransition(async () => {
      try {
        if (mode === 'create') {
          const result = await createPurchaseOrder({ ...payload, status })
          if ('error' in result) {
            toast.error(result.error)
            return
          }
          router.push(`/dashboard/procurement/orders/${result.id}`)
        } else if (orderId) {
          const result = await updatePurchaseOrder(orderId, payload)
          if ('error' in result) {
            toast.error(result.error)
            return
          }
          // Marks the just-saved state clean so the nav guard doesn't fire on
          // this same redirect (or, in modal mode, on the refetch below).
          initialSnapshotRef.current = dirtySnapshot
          if (onSaved) {
            toast.success('บันทึกใบสั่งซื้อแล้ว')
            onSaved()
          } else {
            router.push(`/dashboard/procurement/orders/${orderId}`)
          }
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'บันทึกใบสั่งซื้อไม่สำเร็จ')
      }
    })
  }

  useImperativeHandle(ref, () => ({ submit: handleSubmit }), [handleSubmit])

  useEffect(() => {
    onStateChange?.({ total, isPending })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, isPending])

  /** Picking a job site fills in the delivery note saved on that site
   * (projects.delivery_address), so the same drop-off point / site contact
   * doesn't get retyped on every order. Anything typed by hand is left alone:
   * only an empty box, or one still holding the previously selected site's
   * preset, gets replaced - which also means editing an existing PO keeps its
   * own saved instructions when the site is changed. */
  function handleProjectChange(nextProjectId: string) {
    const presetFor = (id: string) => projects.find((p) => p.id === id)?.delivery_address || ''
    const previousPreset = presetFor(projectId)
    const nextPreset = presetFor(nextProjectId)
    setProjectId(nextProjectId)
    setDeliveryAddress((current) => (current.trim() === '' || current === previousPreset ? nextPreset : current))
  }

  const materialOptions = materials.map((m) => ({ value: String(m.id), label: `${m.name} (${m.unit})` }))
  const projectOptions = projects.map((p) => ({ value: p.id, label: p.name, sublabel: p.location || undefined }))
  const plotOptions = plots.map((p) => ({ value: p.id, label: p.name }))
  const plotGroupOptions = plotGroups.map((g) => ({
    value: g.id,
    label: g.name,
    sublabel: g.member_plot_names.length === 0 ? 'ยังไม่มีแปลงในกลุ่ม' : `${g.member_plot_names.length} แปลง: ${g.member_plot_names.join(', ')}`,
  }))
  const supplierOptions = suppliers.map((s) => ({ value: s.id, label: s.name }))
  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name }))

  /** Plot + plot-group options for a LINE's own scope override, flattened
   * into one searchable list ('plot:<id>' / 'group:<id>') so a single
   * control covers both - reuses the main scope's already-loaded plots/
   * groups when the override happens to name the same project as the order
   * itself (the common "different plot, same project" case needs no extra
   * fetch at all), falling back to the on-demand altScopes cache otherwise. */
  function plotOrGroupOptionsFor(projectIdForLine: string): { value: string; label: string }[] {
    const source = projectIdForLine === projectId ? { plots, plotGroups } : altScopes[projectIdForLine]
    if (!source) return []
    return [
      ...source.plots.map((p) => ({ value: `plot:${p.id}`, label: p.name })),
      ...source.plotGroups.map((g) => ({ value: `group:${g.id}`, label: `กลุ่ม ${g.name}` })),
    ]
  }

  /** The collapsed one-line summary for a line's own override, once set. */
  function overrideSummary(line: Pick<Line, 'project_id' | 'plot_id' | 'plot_group_id'>): string {
    const projectLabel = projects.find((p) => p.id === line.project_id)?.name || ''
    const source = line.project_id === projectId ? { plots, plotGroups } : altScopes[line.project_id || '']
    if (line.plot_id) return `${projectLabel} · แปลง ${source?.plots.find((p) => p.id === line.plot_id)?.name || ''}`
    if (line.plot_group_id) return `${projectLabel} · กลุ่ม ${source?.plotGroups.find((g) => g.id === line.plot_group_id)?.name || ''}`
    return projectLabel
  }

  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดข้อมูล...</p>
      </div>
    )
  }

  const backHref = mode === 'edit' && orderId ? `/dashboard/procurement/orders/${orderId}` : '/dashboard/procurement/orders'

  return (
    <div className={`mx-auto max-w-5xl ${readOnly || onClose ? 'pb-10' : 'pb-24'}`}>
      {mode === 'create' && (
        <div className="mb-5">
          <Link href={backHref} className="mb-2 flex w-fit items-center gap-1 text-sm text-slate-500 transition hover:text-indigo-600">
            <ArrowLeft className="h-4 w-4" /> กลับไปใบสั่งซื้อ
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">สร้างใบสั่งซื้อใหม่</h1>
            {fromRequestId && (
              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">สร้างจากคำขอซื้อที่อนุมัติแล้ว</span>
            )}
          </div>
        </div>
      )}


      <div className={`mt-5 ${appleDivider}`} />

      {/* Top section: order date (+ status, create mode only - in edit mode
          the merged detail page owns the status pill/history/actions). */}
      <Card className={`mt-5 p-5 ${appleCard}`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <label className={fieldLabel}>วันที่สั่งซื้อ</label>
            <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} disabled={readOnly} />
          </div>
          {mode === 'create' && (
            <div>
              <label className={fieldLabel}>สถานะ</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleStatusPillClick('sent')}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    status === 'sent' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  ยืนยันสั่งซื้อ
                </button>
                <button
                  type="button"
                  onClick={() => handleStatusPillClick('draft')}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    status === 'draft' ? 'bg-slate-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  บันทึกเป็นร่าง
                </button>
              </div>
            </div>
          )}
          {readOnly && (
            <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700">ยืนยันสั่งซื้อแล้ว (ล็อก)</span>
          )}
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* Vendor card */}
        <Card className={`p-5 ${appleCard}`}>
          <div className={appleCardLabel}>ผู้จำหน่าย</div>
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className={fieldLabel + ' mb-0'}>ชื่อผู้จำหน่าย</label>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setIsSupplierModalOpen(true)}
                    className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    <Plus className="h-3 w-3" /> เพิ่มผู้จำหน่ายใหม่
                  </button>
                )}
              </div>
              <SearchableSelect
                options={supplierOptions}
                value={supplierId}
                onChange={handleSelectSupplier}
                placeholder="เลือกผู้จำหน่าย"
                disabled={readOnly}
              />
            </div>
            {/* Only vendors that actually have branches get a picker - for the
              * single-location majority this row never appears. */}
            {selectedSupplier && supplierBranches.length > 0 && (
              <div>
                <label className={fieldLabel}>สาขาที่ออกบิล</label>
                <SearchableSelect
                  options={supplierBranches.map((branch) => ({
                    value: branch.id,
                    label:
                      branch.branch_code === '00000'
                        ? `${branch.name} (สำนักงานใหญ่)`
                        : `${branch.name} (สาขา ${branch.branch_code})`,
                  }))}
                  value={supplierBranchId}
                  onChange={setSupplierBranchId}
                  placeholder="เลือกสาขา"
                  disabled={readOnly}
                />
              </div>
            )}
            {selectedSupplier ? (
              <div className="space-y-1.5 rounded-[14px] border border-[#f0f0f2] bg-[#f5f5f7] p-3 text-sm">
                <div className={readOnlyRow}>
                  <span className="text-[#86868b]">ที่อยู่</span>
                  {/* The branch's address is the one the tax invoice carries,
                    * so show that rather than the parent's when one is picked. */}
                  <span className="text-right text-[#1d1d1f]">
                    {selectedBranch?.address || selectedSupplier.address || '-'}
                  </span>
                </div>
                <div className={readOnlyRow}>
                  <span className="text-[#86868b]">เลขผู้เสียภาษี</span>
                  <span className="text-[#1d1d1f]">{selectedSupplier.tax_id || '-'}</span>
                </div>
                {(selectedBranch?.branch_code || selectedSupplier.branch_code) && (
                  <div className={readOnlyRow}>
                    <span className="text-[#86868b]">สาขาเลขที่</span>
                    <span className="text-[#1d1d1f]">
                      {selectedBranch?.branch_code || selectedSupplier.branch_code}
                    </span>
                  </div>
                )}
                <div className={readOnlyRow}>
                  <span className="text-[#86868b]">ผู้ติดต่อ</span>
                  <span className="text-[#1d1d1f]">
                    {[
                      selectedBranch?.contact_name || selectedSupplier.contact_name,
                      selectedBranch?.phone || selectedSupplier.phone,
                    ]
                      .filter(Boolean)
                      .join(' • ') || '-'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
                เลือกผู้จำหน่ายเพื่อแสดงข้อมูลที่อยู่และเลขผู้เสียภาษี
              </p>
            )}
          </div>
        </Card>

        {/* Buyer company card */}
        <Card className={`p-5 ${appleCard}`}>
          <div className={appleCardLabel}>บริษัทผู้ซื้อ</div>
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className={fieldLabel + ' mb-0'}>สั่งซื้อในนามบริษัท</label>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setIsCompanyModalOpen(true)}
                    className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    <Plus className="h-3 w-3" /> เพิ่มบริษัทใหม่
                  </button>
                )}
              </div>
              <SearchableSelect
                options={companyOptions}
                value={companyId}
                onChange={setCompanyId}
                placeholder="เลือกบริษัทในเครือ"
                disabled={readOnly}
              />
            </div>
            {selectedCompany ? (
              <div className="space-y-1.5 rounded-[14px] border border-[#f0f0f2] bg-[#f5f5f7] p-3 text-sm">
                <div className={readOnlyRow}>
                  <span className="text-[#86868b]">ที่อยู่</span>
                  <span className="text-right text-[#1d1d1f]">{selectedCompany.address || '-'}</span>
                </div>
                <div className={readOnlyRow}>
                  <span className="text-[#86868b]">เลขผู้เสียภาษี</span>
                  <span className="text-[#1d1d1f]">{selectedCompany.tax_id || '-'}</span>
                </div>
                <div className={readOnlyRow}>
                  <span className="text-[#86868b]">โทรศัพท์</span>
                  <span className="text-[#1d1d1f]">{selectedCompany.phone || '-'}</span>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
                เลือกบริษัทที่จะใช้ซื้อวัสดุครั้งนี้
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Terms card */}
      <Card className={`mt-5 p-5 ${appleCard}`}>
        <div className={appleCardLabel}>เงื่อนไขใบสั่งซื้อ</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={fieldLabel}>โครงการ</label>
            <SearchableSelect options={projectOptions} value={projectId} onChange={handleProjectChange} placeholder="เลือกโครงการ" disabled={readOnly} />
          </div>
          <div>
            <label className={fieldLabel}>โครงการย่อย / แปลง</label>
            <select
              value={plotScope}
              onChange={(e) => setPlotScope(e.target.value as PlotScope)}
              className="w-full"
              disabled={readOnly || !projectId}
            >
              <option value="none">ไม่ระบุ</option>
              <option value="plot" disabled={plots.length === 0}>
                แปลงเดียว
              </option>
              <option value="multi" disabled={plots.length === 0}>
                หลายแปลง (เลือกเอง)
              </option>
              <option value="group" disabled={plotGroups.length === 0}>
                กลุ่มที่บันทึกไว้
              </option>
            </select>
          </div>

          {plotScope !== 'none' && (
            <div className="col-span-2">
              <div className={plotScope === 'multi' ? 'w-full' : 'w-full sm:max-w-xs'}>
                {isPlotsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-[#86868b]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังโหลดข้อมูลแปลง...
                  </div>
                ) : plotScope === 'plot' ? (
                  <>
                    <label className={fieldLabel}>เลือกแปลง</label>
                    <SearchableSelect options={plotOptions} value={plotId} onChange={setPlotId} placeholder="เลือกแปลง" disabled={readOnly} />
                  </>
                ) : plotScope === 'multi' ? (
                  <>
                    <label className={fieldLabel}>เลือกแปลง (เลือกได้หลายแปลง)</label>
                    <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-[10px] border border-[#e8e8ed] p-2">
                      {plots.map((p) => {
                        const checked = plotIds.includes(p.id)
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() =>
                              setPlotIds((prev) => (prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]))
                            }
                            disabled={readOnly}
                            className={`rounded-full px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                              checked ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            {p.name}
                          </button>
                        )
                      })}
                    </div>
                    {plotIds.length > 0 && <p className="mt-1 text-xs text-[#86868b]">เลือกแล้ว {plotIds.length} แปลง</p>}
                  </>
                ) : (
                  <>
                    <label className={fieldLabel}>เลือกกลุ่มแปลง</label>
                    <SearchableSelect
                      options={plotGroupOptions}
                      value={plotGroupId}
                      onChange={setPlotGroupId}
                      placeholder="เลือกกลุ่มแปลง"
                      disabled={readOnly}
                    />
                  </>
                )}
              </div>
            </div>
          )}

          <div className="col-span-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={isOutsideBoq}
                onChange={(e) => setIsOutsideBoq(e.target.checked)}
                disabled={readOnly}
              />
              ซื้อนอก BOQ (พื้นที่ส่วนกลาง / ของใช้สำนักงาน / เครื่องจักร ฯลฯ)
            </label>
            <p className="mt-0.5 text-xs text-[#86868b]">รายการนี้จะไม่ถูกนำไปเทียบกับ BOQ ในหน้าควบคุมต้นทุน</p>
            {isOutsideBoq && (
              <textarea
                value={outsideBoqReason}
                onChange={(e) => setOutsideBoqReason(e.target.value)}
                className="mt-2 w-full"
                rows={2}
                placeholder="เหตุผลที่ซื้อนอก BOQ (จำเป็นต้องระบุ)"
                disabled={readOnly}
              />
            )}
          </div>

          <div className="col-span-2">
            <label className={fieldLabel}>หมายเหตุการจัดส่ง</label>
            <textarea
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              className="w-full"
              rows={2}
              placeholder="ระบุหมายเหตุการจัดส่ง เช่น จุดส่งของ ผู้ติดต่อหน้างาน เวลาที่สะดวก (ถ้ามี)"
              disabled={readOnly}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className={fieldLabel}>หมายเหตุ / เงื่อนไขเพิ่มเติม</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full"
            rows={2}
            placeholder="ระบุเงื่อนไขหรือหมายเหตุเพิ่มเติมสำหรับใบสั่งซื้อนี้ (ถ้ามี)"
            disabled={readOnly}
          />
        </div>
      </Card>

      {/* Payment conditions card */}
      <Card className={`mt-5 p-5 ${appleCard}`}>
        <div className={appleCardLabel}>เงื่อนไขการชำระเงิน</div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <label className={fieldLabel}>สกุลเงิน</label>
            <div className={readOnlyBox}>THB - บาท</div>
          </div>
          <div>
            <label className={fieldLabel}>ภาษีมูลค่าเพิ่ม</label>
            <select value={vatOption} onChange={(e) => setVatOption(e.target.value)} className="w-full" disabled={readOnly}>
              {VAT_OPTIONS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={fieldLabel}>เครดิต / เงื่อนไขชำระเงิน</label>
            <select
              value={isPresetTerm ? paymentTerms || '' : CUSTOM_TERM}
              onChange={(e) => setPaymentTerms(e.target.value === CUSTOM_TERM ? '' : e.target.value)}
              className="w-full"
              disabled={readOnly}
            >
              <option value="">ไม่ระบุ</option>
              {PAYMENT_TERM_PRESETS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value={CUSTOM_TERM}>{CUSTOM_TERM}</option>
            </select>
            {!isPresetTerm && (
              <input
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="mt-2 w-full"
                placeholder="ระบุเงื่อนไขชำระเงิน"
                disabled={readOnly}
              />
            )}
          </div>
          <div>
            <label className={fieldLabel}>ส่วนลด</label>
            <div className="flex gap-2">
              <select
                value={discountMode}
                onChange={(e) => setDiscountMode(e.target.value as DiscountMode)}
                className="w-full"
                disabled={readOnly}
              >
                {(Object.keys(DISCOUNT_MODE_LABEL) as DiscountMode[]).map((key) => (
                  <option key={key} value={key}>
                    {DISCOUNT_MODE_LABEL[key]}
                  </option>
                ))}
              </select>
              {(discountMode === 'percent' || discountMode === 'amount') && (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  className="w-28 shrink-0"
                  placeholder={discountMode === 'percent' ? '%' : 'บาท'}
                  disabled={readOnly}
                />
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Products card */}
      <Card className={`mt-5 p-5 ${appleCard}`}>
        <div className={appleCardLabel}>รายการสินค้า</div>

        {!readOnly && lines.some((l) => l.quantity_received > 0) && (
          <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            มีรายการที่รับของแล้วบางส่วน - แก้ไขราคา/รายละเอียดได้ และเพิ่มจำนวนสั่งซื้อได้ แต่ลดจำนวนต่ำกว่าที่รับแล้วหรือลบรายการนั้นไม่ได้
          </p>
        )}

        {lines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
            ยังไม่มีรายการ กดเพิ่มรายการสินค้าเพื่อเริ่มต้น
          </p>
        ) : (
          <div className={`overflow-hidden ${appleCard}`}>
            <table className="w-full table-fixed text-left text-sm">
              <thead style={{ backgroundColor: '#f5f5f7' }}>
                <tr>
                  <th className="w-10 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#86868b]">#</th>
                  <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#86868b]">สินค้า</th>
                  <th className="w-36 px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-[#86868b]">จำนวน</th>
                  <th className="w-32 px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-[#86868b]">ราคาต่อหน่วย</th>
                  <th className="w-32 px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-[#86868b]">ราคารวม</th>
                  {!readOnly && <th className="w-10 px-2 py-2.5" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f2] bg-white">
                {lines.map((line, i) => {
                  const gross = (Number(line.quantity_ordered) || 0) * (Number(line.unit_price) || 0)
                  const netLineTotal = gross - lineDiscountAmount(line, gross, discountMode)
                  // materialOptions only lists active materials (the picker
                  // shouldn't offer a deactivated one for a NEW selection) -
                  // but a line already pointing at one (placed before it was
                  // deactivated) needs its own option added back in, using
                  // the name/unit embedded on the line itself, or the picker
                  // shows a blank/placeholder box instead of the real name.
                  const lineMaterialOptions =
                    line.material_type_id && !materialOptions.some((o) => o.value === String(line.material_type_id))
                      ? [
                          ...materialOptions,
                          {
                            value: String(line.material_type_id),
                            label: `${line.material_name || 'วัสดุที่ปิดใช้งานแล้ว'} (${line.material_unit || '-'}) - ปิดใช้งานแล้ว`,
                          },
                        ]
                      : materialOptions
                  return (
                    <tr key={i} className="align-top">
                      <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <SearchableSelect
                            className="min-w-0 flex-1"
                            options={lineMaterialOptions}
                            value={line.material_type_id ? String(line.material_type_id) : ''}
                            onChange={(v) => {
                              updateLine(i, withDefaultAnswer(line, { material_type_id: Number(v) }))
                            }}
                            placeholder={isMaterialsLoading ? 'กำลังโหลดรายการวัสดุ...' : 'เลือกวัสดุ'}
                            disabled={readOnly || isMaterialsLoading}
                            renderCreate={
                              readOnly
                                ? undefined
                                : ({ query, close }) => (
                                    <InlineMaterialCreate
                                      query={query}
                                      categories={existingMaterialCategories}
                                      close={close}
                                      onCreated={(created) => handleInlineMaterialCreated(i, created)}
                                    />
                                  )
                            }
                          />
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => openMaterialModal(i)}
                              title="เพิ่มวัสดุใหม่"
                              disabled={isMaterialsLoading}
                              className="shrink-0 rounded p-1.5 text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        {sourceRequestNo != null && <RequestLinkNote line={line} requestLines={requestLines} />}
                        {/* Purchasing's answer to the request line. When the
                          * two sides count the same way the arithmetic still
                          * closes the line on its own and this stays
                          * unticked; when they don't, it's the only thing
                          * that can - so it arrives ticked and explains why. */}
                        {line.purchase_request_item_id && requestLines[line.purchase_request_item_id] && (
                          <label className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-tight text-[#1d1d1f]">
                            <input
                              type="checkbox"
                              checked={line.closes_request_line}
                              onChange={(e) => updateLine(i, { closes_request_line: e.target.checked })}
                              disabled={readOnly}
                              className="mt-px shrink-0"
                            />
                            <span>
                              ใบสั่งซื้อนี้ครบตามรายการที่ขอแล้ว
                              {differsFromRequestUnit(line) && (
                                <span className="mt-0.5 block text-[10px] text-amber-700">
                                  ขอเป็น {requestLines[line.purchase_request_item_id].unit} แต่สั่งเป็น{' '}
                                  {materialUnit(line)} - ระบบจะไม่หักจำนวนข้ามหน่วยให้
                                  ติ๊กช่องนี้เพื่อปิดรายการในคำขอ
                                </span>
                              )}
                            </span>
                          </label>
                        )}
                        <input
                          value={line.description}
                          onChange={(e) => updateLine(i, { description: e.target.value })}
                          className="mt-1.5 w-full text-xs"
                          placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
                          disabled={readOnly}
                        />
                        {discountMode === 'individual' && (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.discountValue}
                            onChange={(e) => updateLine(i, { discountValue: e.target.value })}
                            className="mt-1.5 w-28 text-xs"
                            placeholder="ส่วนลด (บาท)"
                            disabled={readOnly}
                          />
                        )}
                        {/* Per-line scope override: this material is for a
                          * different job (or general stock) than the order's
                          * own project/plot - see 202609220002. Collapsed to
                          * nothing for the common case of every line just
                          * inheriting the order's scope. */}
                        {line.project_id == null ? (
                          !readOnly && (
                            <button
                              type="button"
                              onClick={() => updateLine(i, { project_id: projectId || '' })}
                              className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                            >
                              <MapPin className="h-3 w-3" /> ระบุโครงการ/แปลงอื่น
                            </button>
                          )
                        ) : (
                          <div className="mt-1.5 rounded-[10px] border border-indigo-100 bg-indigo-50/60 p-1.5">
                            {readOnly ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700">
                                <MapPin className="h-3 w-3 shrink-0" /> {overrideSummary(line)}
                              </span>
                            ) : (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1">
                                  <SearchableSelect
                                    className="min-w-0 flex-1"
                                    options={projectOptions}
                                    value={line.project_id}
                                    onChange={(v) => {
                                      void loadAltScope(v)
                                      updateLine(i, { project_id: v, plot_id: null, plot_group_id: null })
                                    }}
                                    placeholder="โครงการ"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => updateLine(i, { project_id: null, plot_id: null, plot_group_id: null })}
                                    title="ยกเลิก - ใช้โครงการ/แปลงของใบสั่งซื้อหลัก"
                                    className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                {loadingAltScopes[line.project_id] ? (
                                  <div className="flex items-center gap-1 text-[10px] text-[#86868b]">
                                    <Loader2 className="h-3 w-3 animate-spin" /> กำลังโหลดแปลง...
                                  </div>
                                ) : (
                                  <SearchableSelect
                                    options={plotOrGroupOptionsFor(line.project_id)}
                                    value={line.plot_id ? `plot:${line.plot_id}` : line.plot_group_id ? `group:${line.plot_group_id}` : ''}
                                    onChange={(v) => {
                                      if (v.startsWith('plot:')) updateLine(i, { plot_id: v.slice(5), plot_group_id: null })
                                      else if (v.startsWith('group:')) updateLine(i, { plot_group_id: v.slice(6), plot_id: null })
                                      else updateLine(i, { plot_id: null, plot_group_id: null })
                                    }}
                                    placeholder="แปลง/กลุ่มแปลง (ไม่ระบุ = สต็อกทั่วไปของโครงการ)"
                                  />
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {/* Order-time guess at where this line unloads - only
                          * pre-fills the goods receipt's destination toggle
                          * later, never read at receiving time. Collapsed to
                          * nothing until picked, same as the scope override
                          * above. */}
                        {!readOnly && (
                          <div className="mt-1.5 flex items-center gap-1">
                            {(['store', 'site'] as const).map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => updateLine(i, { intended_destination: line.intended_destination === d ? null : d })}
                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                                  line.intended_destination === d
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-white text-[#86868b] ring-1 ring-[#e8e8ed] hover:bg-slate-50'
                                }`}
                              >
                                {d === 'store' ? 'เข้าสโตร์' : 'ส่งตรงหน้างาน'}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={line.quantity_received || 0}
                            step="any"
                            value={line.quantity_ordered}
                            onChange={(e) => updateLine(i, { quantity_ordered: e.target.value })}
                            className="w-full text-right"
                            disabled={readOnly}
                          />
                          <span className="shrink-0 text-xs text-[#86868b]">{materialUnit(line) || '-'}</span>
                        </div>
                        {line.quantity_received > 0 && (
                          <div className="mt-1 text-right text-[10px] text-emerald-600">
                            รับแล้ว {line.quantity_received.toLocaleString('th-TH')}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unit_price}
                          onChange={(e) => updateLine(i, { unit_price: e.target.value })}
                          className="w-full text-right"
                          disabled={readOnly}
                        />
                        {(() => {
                          const last = line.material_type_id ? lastPrices[line.material_type_id] : undefined
                          if (!last) return null
                          const current = Number(line.unit_price) || 0
                          const diff = current - last.unitPrice
                          const pct = last.unitPrice > 0 ? (diff / last.unitPrice) * 100 : 0
                          const tone = diff > 0 ? 'text-rose-600' : diff < 0 ? 'text-emerald-600' : 'text-slate-400'
                          return (
                            <div className={`mt-1 text-right text-[10px] ${tone}`}>
                              ครั้งก่อน ฿{formatMoney(last.unitPrice)}
                              {current > 0 && diff !== 0 && (
                                <>
                                  {' '}
                                  ({diff > 0 ? '+' : ''}
                                  {pct.toFixed(1)}%)
                                </>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">฿{formatMoney(netLineTotal)}</td>
                      {!readOnly && (
                        <td className="px-1 py-2 text-center">
                          <button type="button" onClick={() => removeLine(i)} className="rounded p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!readOnly && (
          <button type="button" onClick={addLine} className="mt-3 flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800">
            <Plus className="h-4 w-4" /> เพิ่มรายการสินค้า
          </button>
        )}

        {draftBoqLines.length > 0 && (
          <div className="mt-4">
            <BoqCheckPanel lines={draftBoqLines} scopeLabel="ตรวจสอบก่อนบันทึก" />
          </div>
        )}

        <div className="mt-5 ml-auto w-full max-w-xs space-y-1.5 border-t border-slate-100 pt-4 text-sm">
          <div className="flex justify-between text-slate-500">
            <span>ยอดรวมสินค้า (ก่อนหักส่วนลด)</span>
            <span>฿{formatMoney(grossSubtotal)}</span>
          </div>
          {lineDiscountTotal > 0 && (
            <div className="flex justify-between text-rose-600">
              <span>ส่วนลดรายการสินค้า</span>
              <span>-฿{formatMoney(lineDiscountTotal)}</span>
            </div>
          )}
          {poDiscountAmount > 0 && (
            <div className="flex justify-between text-rose-600">
              <span>ส่วนลด</span>
              <span>-฿{formatMoney(poDiscountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-slate-500">
            <span>
              ภาษีมูลค่าเพิ่ม ({vatPercent || 0}%{vatType === 'inclusive' && vatPercent > 0 ? ', รวมในราคาแล้ว' : ''})
            </span>
            <span>฿{formatMoney(vatAmount)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold text-slate-900">
            <span>ยอดรวมทั้งสิ้น</span>
            <span>฿{formatMoney(total)}</span>
          </div>
        </div>
      </Card>

      {readOnly ? (
        <div className="mt-5 flex items-center justify-end gap-2 text-sm text-slate-500">
          ยอดรวมทั้งสิ้น <span className="text-base font-semibold text-slate-800">฿{formatMoney(total)}</span>
        </div>
      ) : onClose ? null : (
        /* Fixed to the viewport - only reachable on the standalone page.
           Embedded in PurchaseOrderModal (onClose set), the modal renders
           this same total/ยกเลิก/save bar itself, in Modal's `footer` slot,
           driven by this form's ref (submit) and onStateChange (total,
           isPending) - a fixed or sticky bar placed in the normal render
           tree here would either escape the dialog to the browser viewport
           or only pin once scrolled near its own position, neither of
           which is "always visible at the bottom of this dialog". */
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-6 py-3 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-5xl items-center justify-between">
            <div className="text-sm text-slate-500">
              ยอดรวมทั้งสิ้น <span className="font-semibold text-slate-800">฿{formatMoney(total)}</span>
            </div>
            <div className="flex gap-3">
              <Link href={backHref}>
                <Button type="button" variant="secondary">
                  ยกเลิก
                </Button>
              </Link>
              <Button type="button" onClick={handleSubmit} disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'create' ? 'บันทึกใบสั่งซื้อ' : 'บันทึกการแก้ไข'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Modal isOpen={isSupplierModalOpen} onClose={() => setIsSupplierModalOpen(false)} title="เพิ่มผู้จำหน่ายใหม่" panelClassName="max-w-lg">
        <div className="space-y-4">
          <SupplierFormFields value={supplierDraft} onChange={(patch) => setSupplierDraft((prev) => ({ ...prev, ...patch }))} />
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setIsSupplierModalOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={handleCreateSupplier} disabled={isSavingSupplier}>
              {isSavingSupplier ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึกและเลือก'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isCompanyModalOpen} onClose={() => setIsCompanyModalOpen(false)} title="เพิ่มบริษัทใหม่">
        <div className="space-y-4">
          <div>
            <label className={fieldLabel}>ชื่อบริษัท</label>
            <input
              value={companyDraft.name}
              onChange={(e) => setCompanyDraft({ ...companyDraft, name: e.target.value })}
              className="w-full"
              placeholder="เช่น บริษัท เอบีซี ก่อสร้าง จำกัด"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={fieldLabel}>เลขผู้เสียภาษี</label>
              <input value={companyDraft.tax_id} onChange={(e) => setCompanyDraft({ ...companyDraft, tax_id: e.target.value })} className="w-full" />
            </div>
            <div>
              <label className={fieldLabel}>โทรศัพท์</label>
              <input value={companyDraft.phone} onChange={(e) => setCompanyDraft({ ...companyDraft, phone: e.target.value })} className="w-full" />
            </div>
          </div>
          <div>
            <label className={fieldLabel}>ที่อยู่</label>
            <textarea value={companyDraft.address} onChange={(e) => setCompanyDraft({ ...companyDraft, address: e.target.value })} className="w-full" rows={2} />
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setIsCompanyModalOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={handleCreateCompany} disabled={isSavingCompany}>
              {isSavingCompany ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึกและเลือก'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isMaterialModalOpen}
        onClose={() => {
          setIsMaterialModalOpen(false)
          setMaterialModalLineIndex(null)
        }}
        title="เพิ่มวัสดุใหม่"
      >
        <div className="space-y-4">
          <div>
            <label className={fieldLabel}>ชื่อวัสดุ</label>
            <input
              value={materialDraft.name}
              onChange={(e) => setMaterialDraft({ ...materialDraft, name: e.target.value })}
              className="w-full"
              placeholder="เช่น ปูนซีเมนต์ปอร์ตแลนด์"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={fieldLabel}>หน่วยนับ</label>
              <input
                value={materialDraft.unit}
                onChange={(e) => setMaterialDraft({ ...materialDraft, unit: e.target.value })}
                className="w-full"
                placeholder="เช่น ถุง, ลบ.ม., ตัน"
              />
            </div>
            <div>
              <label className={fieldLabel}>ราคา/หน่วย (บาท)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={materialDraft.price}
                onChange={(e) => setMaterialDraft({ ...materialDraft, price: e.target.value })}
                className="w-full"
                placeholder="0.00"
              />
            </div>
          </div>
          <div>
            <label className={fieldLabel}>หมวดหมู่ (ถ้ามี)</label>
            <select
              value={isCustomMaterialCategory ? CUSTOM_MATERIAL_CATEGORY : materialDraft.category}
              onChange={(e) => {
                if (e.target.value === CUSTOM_MATERIAL_CATEGORY) {
                  setIsCustomMaterialCategory(true)
                  setMaterialDraft({ ...materialDraft, category: '' })
                } else {
                  setIsCustomMaterialCategory(false)
                  setMaterialDraft({ ...materialDraft, category: e.target.value })
                }
              }}
              className="w-full"
            >
              <option value="">ไม่ระบุ</option>
              {existingMaterialCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={CUSTOM_MATERIAL_CATEGORY}>{CUSTOM_MATERIAL_CATEGORY}</option>
            </select>
            {isCustomMaterialCategory && (
              <input
                value={materialDraft.category}
                onChange={(e) => setMaterialDraft({ ...materialDraft, category: e.target.value })}
                className="mt-2 w-full"
                placeholder="ระบุชื่อหมวดหมู่ใหม่"
                autoFocus
              />
            )}
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsMaterialModalOpen(false)
                setMaterialModalLineIndex(null)
              }}
            >
              ยกเลิก
            </Button>
            <Button type="button" onClick={handleCreateMaterial} disabled={isSavingMaterial}>
              {isSavingMaterial ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึกและเลือก'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={pendingNavUrl !== null}
        title="ออกจากหน้านี้โดยไม่บันทึก?"
        message="มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้โดยไม่บันทึกหรือไม่?"
        confirmLabel="ออกจากหน้านี้"
        cancelLabel="อยู่ต่อ"
        tone="danger"
        onCancel={() => setPendingNavUrl(null)}
        onConfirm={() => {
          const url = pendingNavUrl
          setPendingNavUrl(null)
          if (url) window.location.href = url
        }}
      />
    </div>
  )
})

export default PurchaseOrderForm
