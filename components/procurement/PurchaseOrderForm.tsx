'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import SearchableSelect from '@/components/ui/SearchableSelect'
import SupplierFormFields from '@/components/procurement/SupplierFormFields'
import { appleCard, appleCardLabel, appleDivider } from '@/components/procurement/appleTheme'
import { getProjects } from '@/actions/project-actions'
import { getPlotsByProjectId } from '@/actions/plot-actions'
import { getMaterialPickerOptions, getPlotGroups, createMaterialType } from '@/actions/material-actions'
import {
  getSuppliers,
  getCompanies,
  createSupplier,
  createCompany,
  createPurchaseOrder,
  updatePurchaseOrder,
  getPurchaseRequestById,
} from '@/actions/procurement-actions'
import type { MaterialPickerOption, PlotGroup } from '@/lib/types/materials'
import type { Supplier, Company, SupplierInput, VatType, DiscountType, PurchaseOrder } from '@/lib/types/procurement'

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
  material_type_id: number
  purchase_request_item_id: string | null
  quantity_ordered: string
  unit_price: string
  description: string
  discountValue: string
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

export default function PurchaseOrderForm({
  mode,
  orderId,
  fromRequestId,
  initialOrder,
  readOnly = false,
}: {
  mode: 'create' | 'edit'
  orderId?: string
  fromRequestId?: string | null
  initialOrder?: PurchaseOrder | null
  readOnly?: boolean
}) {
  const router = useRouter()

  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const toast = useToast()

  const [projects, setProjects] = useState<{ id: string; name: string; location: string | null }[]>([])
  const [plots, setPlots] = useState<{ id: string; name: string }[]>([])
  const [plotGroups, setPlotGroups] = useState<PlotGroup[]>([])
  const [isPlotsLoading, setIsPlotsLoading] = useState(false)
  // Fetched separately from bootstrap() and not gating isLoading: the
  // material catalog is 1000+ rows and was blocking the whole form behind a
  // spinner while everything else (projects/suppliers/companies - a handful
  // of rows each) was long since ready. The line-item material picker shows
  // its own loading state instead.
  const [materials, setMaterials] = useState<MaterialPickerOption[]>([])
  const [isMaterialsLoading, setIsMaterialsLoading] = useState(true)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [companies, setCompanies] = useState<Company[]>([])

  const [projectId, setProjectId] = useState('')
  const [plotScope, setPlotScope] = useState<PlotScope>('none')
  const [plotId, setPlotId] = useState('')
  const [plotGroupId, setPlotGroupId] = useState('')
  // Ad-hoc multi-plot selection ('multi' scope) - any combination of the
  // project's plots, not limited to a pre-saved plot_groups batch.
  const [plotIds, setPlotIds] = useState<string[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [vatOption, setVatOption] = useState('vat7_exclusive')
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('')
  // Free-form delivery note, typed per order - not derived from the
  // project's address.
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [status, setStatus] = useState<'draft' | 'sent'>('sent')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [discountMode, setDiscountMode] = useState<DiscountMode>('none')
  const [discountValue, setDiscountValue] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])

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

  async function bootstrap() {
    setIsLoading(true)
    try {
      const [p, s, c] = await Promise.all([getProjects(), getSuppliers(), getCompanies()])
      setProjects(p as any)
      setSuppliers(s)
      setCompanies(c)

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
        setLines(
          items.map((item) => ({
            material_type_id: item.material_type_id,
            purchase_request_item_id: item.purchase_request_item_id,
            quantity_ordered: String(item.quantity_ordered),
            unit_price: String(item.unit_price),
            description: item.description || '',
            discountValue: item.discount_amount ? String(item.discount_amount) : '',
          }))
        )
      } else if (mode === 'create' && fromRequestId) {
        const pr = await getPurchaseRequestById(fromRequestId)
        if (pr) {
          setProjectId(pr.project_id)
          if (pr.plot_id) {
            setPlotScope('plot')
            setPlotId(pr.plot_id)
          }
          setLines(
            (pr.purchase_request_items || []).map((item) => ({
              material_type_id: item.material_type_id,
              purchase_request_item_id: item.id,
              quantity_ordered: String(item.quantity_requested),
              unit_price: String(item.material_types?.current_price ?? 0),
              description: '',
              discountValue: '',
            }))
          )
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setIsLoading(false)
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
        setPlots((p as any) || [])
        setPlotGroups(g)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลแปลงไม่สำเร็จ'))
      .finally(() => setIsPlotsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const selectedSupplier = useMemo(() => suppliers.find((s) => s.id === supplierId) || null, [suppliers, supplierId])
  const selectedCompany = useMemo(() => companies.find((c) => c.id === companyId) || null, [companies, companyId])
  // Picking from what's already in the catalog (instead of free text) keeps
  // it from accumulating near-duplicate spellings of the same category.
  const existingMaterialCategories = useMemo(() => {
    const set = new Set(materials.map((m) => m.category).filter((c): c is string => !!c && c.trim() !== ''))
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'))
  }, [materials])

  function handleSelectSupplier(id: string) {
    setSupplierId(id)
    const supplier = suppliers.find((s) => s.id === id)
    setPaymentTerms(supplier?.payment_terms || '')
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
    try {
      const created = await createSupplier(supplierDraft)
      setSuppliers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'th')))
      setSupplierId(created.id)
      setPaymentTerms(created.payment_terms || '')
      setIsSupplierModalOpen(false)
      setSupplierDraft(emptySupplierDraft)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'เพิ่มผู้จำหน่ายไม่สำเร็จ')
    } finally {
      setIsSavingSupplier(false)
    }
  }

  async function handleCreateCompany() {
    if (!companyDraft.name.trim()) {
      toast.error('กรุณาใส่ชื่อบริษัท')
      return
    }
    setIsSavingCompany(true)
    try {
      const created = await createCompany(companyDraft)
      setCompanies((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'th')))
      setCompanyId(created.id)
      setIsCompanyModalOpen(false)
      setCompanyDraft(emptyCompanyDraft)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'เพิ่มบริษัทไม่สำเร็จ')
    } finally {
      setIsSavingCompany(false)
    }
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

  function addLine() {
    setLines((prev) => [
      ...prev,
      { material_type_id: 0, purchase_request_item_id: null, quantity_ordered: '', unit_price: '', description: '', discountValue: '' },
    ])
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function removeLine(index: number) {
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

    const payload = {
      supplier_id: supplierId,
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
      items: validLines.map((l) => ({
        material_type_id: l.material_type_id,
        purchase_request_item_id: l.purchase_request_item_id,
        quantity_ordered: Number(l.quantity_ordered),
        unit_price: Number(l.unit_price) || 0,
        description: l.description,
        discount_type: (discountMode === 'individual' && Number(l.discountValue) > 0 ? 'amount' : 'none') as DiscountType,
        discount_value: discountMode === 'individual' ? Number(l.discountValue) || 0 : 0,
      })),
    }

    startTransition(async () => {
      try {
        if (mode === 'create') {
          const result = await createPurchaseOrder({ ...payload, status })
          router.push(`/dashboard/procurement/orders/${result.id}`)
        } else if (orderId) {
          await updatePurchaseOrder(orderId, payload)
          router.push(`/dashboard/procurement/orders/${orderId}`)
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'บันทึกใบสั่งซื้อไม่สำเร็จ')
      }
    })
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
    <div className={`mx-auto max-w-5xl ${readOnly ? 'pb-10' : 'pb-24'}`}>
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
            {selectedSupplier ? (
              <div className="space-y-1.5 rounded-[14px] border border-[#f0f0f2] bg-[#f5f5f7] p-3 text-sm">
                <div className={readOnlyRow}>
                  <span className="text-[#86868b]">ที่อยู่</span>
                  <span className="text-right text-[#1d1d1f]">{selectedSupplier.address || '-'}</span>
                </div>
                <div className={readOnlyRow}>
                  <span className="text-[#86868b]">เลขผู้เสียภาษี</span>
                  <span className="text-[#1d1d1f]">{selectedSupplier.tax_id || '-'}</span>
                </div>
                {selectedSupplier.branch_code && (
                  <div className={readOnlyRow}>
                    <span className="text-[#86868b]">สาขาเลขที่</span>
                    <span className="text-[#1d1d1f]">{selectedSupplier.branch_code}</span>
                  </div>
                )}
                <div className={readOnlyRow}>
                  <span className="text-[#86868b]">ผู้ติดต่อ</span>
                  <span className="text-[#1d1d1f]">{[selectedSupplier.contact_name, selectedSupplier.phone].filter(Boolean).join(' • ') || '-'}</span>
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
            <SearchableSelect options={projectOptions} value={projectId} onChange={setProjectId} placeholder="เลือกโครงการ" disabled={readOnly} />
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

        {lines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
            ยังไม่มีรายการ กดเพิ่มรายการสินค้าเพื่อเริ่มต้น
          </p>
        ) : (
          <div className={`overflow-hidden ${appleCard}`}>
            <table className="w-full text-left text-sm">
              <thead style={{ backgroundColor: '#f5f5f7' }}>
                <tr>
                  <th className="w-10 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#86868b]">#</th>
                  <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#86868b]">สินค้า</th>
                  <th className="w-28 px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-[#86868b]">จำนวน</th>
                  <th className="w-32 px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-[#86868b]">ราคาต่อหน่วย</th>
                  <th className="w-32 px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-[#86868b]">ราคารวม</th>
                  {!readOnly && <th className="w-10 px-2 py-2.5" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f2] bg-white">
                {lines.map((line, i) => {
                  const gross = (Number(line.quantity_ordered) || 0) * (Number(line.unit_price) || 0)
                  const netLineTotal = gross - lineDiscountAmount(line, gross, discountMode)
                  return (
                    <tr key={i} className="align-top">
                      <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <SearchableSelect
                            className="flex-1"
                            options={materialOptions}
                            value={line.material_type_id ? String(line.material_type_id) : ''}
                            onChange={(v) => updateLine(i, { material_type_id: Number(v) })}
                            placeholder={isMaterialsLoading ? 'กำลังโหลดรายการวัสดุ...' : 'เลือกวัสดุ'}
                            disabled={readOnly || isMaterialsLoading}
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
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={line.quantity_ordered}
                          onChange={(e) => updateLine(i, { quantity_ordered: e.target.value })}
                          className="w-full text-right"
                          disabled={readOnly}
                        />
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
      ) : (
        /* Sticky bottom action bar */
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
    </div>
  )
}
