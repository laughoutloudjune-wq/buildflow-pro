'use client'

import { useState, useEffect, useMemo, useTransition } from 'react'
import { Plus, Trash2, Loader2, HardHat, Phone, CreditCard, User, Pencil, Wallet, Search, ShieldCheck } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import { getContractors, createContractor, deleteContractor, updateContractor, getContractorApprovedHistory } from '@/actions/contractor-actions'
import { getContractorTypes } from '@/actions/contractor-type-actions'
import { formatCurrency } from '@/lib/currency'

type Contractor = {
  id: string
  name: string
  type_id: number
  phone: string
  bank_account: string
  tax_id: string
  total_paid: number
  total_retention: number
  contractor_types: { name: string } | null
}

type ContractorType = {
  id: number
  name: string
}

/** Same footprint for paid-out history and retention detail modals */
const contractorLedgerModalPanelClass = 'max-w-[96vw] w-full h-[88vh] max-h-[90dvh]'

export default function ContractorsPage() {
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [types, setTypes] = useState<ContractorType[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingContractor, setEditingContractor] = useState<Contractor | null>(null)
  const [historyContractor, setHistoryContractor] = useState<Contractor | null>(null)
  const [historyRows, setHistoryRows] = useState<any[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [historyProject, setHistoryProject] = useState('')
  const [historyType, setHistoryType] = useState<'all' | 'progress' | 'extra_work'>('all')
  const [historyDateFrom, setHistoryDateFrom] = useState('')
  const [historyDateTo, setHistoryDateTo] = useState('')
  const [retentionContractor, setRetentionContractor] = useState<Contractor | null>(null)
  const [retentionRows, setRetentionRows] = useState<any[]>([])
  const [isRetentionLoading, setIsRetentionLoading] = useState(false)
  const [isPending, startTransition] = useTransition()
  const collator = useMemo(() => new Intl.Collator('th', { numeric: true, sensitivity: 'base' }), [])

  useEffect(() => {
    void Promise.resolve().then(loadData)
  }, [])

  const loadData = async () => {
    const [cData, tData] = await Promise.all([getContractors(), getContractorTypes()])
    if (cData) setContractors(cData)
    if (tData) setTypes(tData)
  }

  const openModal = (contractor: Contractor | null = null) => {
    setEditingContractor(contractor)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setEditingContractor(null)
    setIsModalOpen(false)
  }

  const handleSubmit = async (formData: FormData) => {
    closeModal()
    startTransition(async () => {
      if (editingContractor) {
        await updateContractor(editingContractor.id, formData)
      } else {
        await createContractor(formData)
      }
      await loadData()
    })
  }

  const handleDelete = async (id: string) => {
    if (!confirm('ยืนยันลบผู้รับเหมารายนี้?')) return
    startTransition(async () => {
      await deleteContractor(id)
      await loadData()
    })
  }

  const openHistory = async (contractor: Contractor) => {
    setHistoryContractor(contractor)
    setIsHistoryLoading(true)
    try {
      const rows = await getContractorApprovedHistory(contractor.id)
      setHistoryRows(rows)
    } finally {
      setIsHistoryLoading(false)
    }
  }

  const closeHistory = () => {
    setHistoryContractor(null)
    setHistoryRows([])
    setHistorySearch('')
    setHistoryProject('')
    setHistoryType('all')
    setHistoryDateFrom('')
    setHistoryDateTo('')
  }

  const openRetention = async (contractor: Contractor) => {
    setRetentionContractor(contractor)
    setIsRetentionLoading(true)
    try {
      const rows = await getContractorApprovedHistory(contractor.id)
      // Only bills that were actually paid out with retention applied by accountant.
      // Includes bills with a manually-entered retention_amount (e.g. a DC job that
      // has no work-amount base for the % formula but was still paid with a real
      // retention withholding) as well as the normal %-of-work-amount case.
      setRetentionRows(rows.filter((r: any) => {
        if (!r.paid_out_at || r.retention_applied === false) return false
        if (r.retention_amount != null) return Number(r.retention_amount) > 0
        return Number(r.retention_percent || 0) > 0 && Number(r.total_work_amount || 0) > 0
      }))
    } finally {
      setIsRetentionLoading(false)
    }
  }

  const closeRetention = () => {
    setRetentionContractor(null)
    setRetentionRows([])
  }

  const historyProjectOptions = useMemo(() => {
    return Array.from(new Set((historyRows || []).map((r: any) => r.projects?.name).filter(Boolean))).sort((a, b) => collator.compare(a, b))
  }, [historyRows, collator])

  const filteredHistoryRows = useMemo(() => {
    const q = historySearch.trim().toLowerCase()
    return (historyRows || []).filter((row: any) => {
      const billDate = row.billing_date ? String(row.billing_date) : ''
      if (historyProject && (row.projects?.name || '') !== historyProject) return false
      if (historyType !== 'all' && row.type !== historyType) return false
      if (historyDateFrom && billDate && billDate < historyDateFrom) return false
      if (historyDateTo && billDate && billDate > historyDateTo) return false

      if (!q) return true
      const plot = row.plots?.name || ''
      const doc = String(row.doc_no || '')
      const mainJobs = (row.billing_jobs || []).map((j: any) => j.job_assignments?.boq_master?.item_name || '').join(' ')
      const adjs = (row.billing_adjustments || []).map((a: any) => a.description || '').join(' ')
      const haystack = `${doc} ${row.projects?.name || ''} ${plot} ${mainJobs} ${adjs}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [historyRows, historySearch, historyProject, historyType, historyDateFrom, historyDateTo])

  const historySummary = useMemo(() => {
    return filteredHistoryRows.reduce(
      (acc: { paid: number; pending: number; pendingCount: number }, row: any) => {
        if (row.paid_out_at) {
          acc.paid += Number(row.actual_payout ?? row.net_amount ?? 0)
        } else {
          acc.pending += Number(row.net_amount || 0)
          acc.pendingCount += 1
        }
        return acc
      },
      { paid: 0, pending: 0, pendingCount: 0 }
    )
  }, [filteredHistoryRows])

  return (
    <div className="space-y-6">
      <PageHeader
        title="ผู้รับเหมา"
        subtitle="จัดการรายชื่อช่างและทีมงาน"
        actions={
          <Button onClick={() => openModal()}>
            <Plus className="h-4 w-4" /> เพิ่มผู้รับเหมา
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {contractors.map((c) => (
          <Card key={c.id} className="group relative overflow-hidden hover:border-indigo-300 transition-all p-5 flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
                    <User className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800">{c.name}</h3>
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                      {c.contractor_types?.name || 'ไม่ระบุประเภท'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openModal(c)} className="text-slate-300 hover:text-indigo-500 p-1 rounded hover:bg-indigo-50 transition">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(c.id)} disabled={isPending} className="text-slate-300 hover:text-red-500 p-1 rounded hover:bg-red-50 transition">
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2 text-sm text-slate-500 mt-4 pt-4 border-t border-slate-50">
                <button
                  onClick={() => openHistory(c)}
                  className="w-full flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 hover:bg-emerald-100 transition"
                >
                  <div className="flex items-center gap-2 text-emerald-700">
                    <Wallet className="h-4 w-4" />
                    <div className="text-left">
                      <div>ยอดจ่ายสะสม</div>
                      <div className="text-[10px] font-normal text-emerald-600/80">ยืนยันจ่ายโดยบัญชีแล้วเท่านั้น</div>
                    </div>
                  </div>
                  <span className="font-semibold text-emerald-700">฿{formatCurrency(c.total_paid || 0)}</span>
                </button>

                <button
                  onClick={() => openRetention(c)}
                  className="w-full flex items-center justify-between rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 hover:bg-amber-100 transition"
                >
                  <div className="flex items-center gap-2 text-amber-700">
                    <ShieldCheck className="h-4 w-4" />
                    <span className="text-sm">เงินประกันสะสม</span>
                  </div>
                  <span className="font-semibold text-amber-700">฿{formatCurrency(c.total_retention || 0)}</span>
                </button>

                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-slate-400" />
                  {c.phone || '-'}
                </div>
                <div className="flex items-start gap-2">
                  <CreditCard className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    {c.bank_account ? (
                      c.bank_account.includes(' || ')
                        ? <>
                            <div>{c.bank_account.split(' || ')[0]}</div>
                            <div className="text-xs text-slate-400">{c.bank_account.split(' || ')[1]}</div>
                          </>
                        : <div>{c.bank_account}</div>
                    ) : '-'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <HardHat className="h-4 w-4 text-slate-400" />
                  <span className="truncate">เลขภาษี: {c.tax_id || '-'}</span>
                </div>
              </div>
            </div>
          </Card>
        ))}

        {contractors.length === 0 && (
          <div className="col-span-full py-12 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 text-slate-400">
            ยังไม่มีข้อมูลผู้รับเหมา
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingContractor ? 'แก้ไขข้อมูลผู้รับเหมา' : 'เพิ่มผู้รับเหมาใหม่'}
      >
        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อ-นามสกุล / ชื่อทีม</label>
            <input name="name" required className="w-full" placeholder="เช่น ทีมช่างสมชาย" defaultValue={editingContractor?.name} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ประเภทงาน</label>
            <select name="type_id" required className="w-full" defaultValue={editingContractor?.type_id}>
              <option value="">-- เลือกประเภท --</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">เบอร์โทรศัพท์</label>
              <input name="phone" className="w-full" placeholder="08x-xxxxxxx" defaultValue={editingContractor?.phone} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">เลขผู้เสียภาษี/ปชช.</label>
              <input name="tax_id" className="w-full" placeholder="13 หลัก" defaultValue={editingContractor?.tax_id} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อธนาคาร</label>
              <input name="bank_name" className="w-full" placeholder="เช่น กสิกรไทย" defaultValue={editingContractor?.bank_account?.split(' || ')[0] || ''} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">เลขบัญชี</label>
              <input name="bank_account_number" className="w-full" placeholder="xxx-x-xxxxx-x" defaultValue={editingContractor?.bank_account?.split(' || ')[1] || (editingContractor?.bank_account?.includes(' || ') ? '' : editingContractor?.bank_account || '')} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={closeModal}>ยกเลิก</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Retention detail modal */}
      <Modal
        isOpen={!!retentionContractor}
        onClose={closeRetention}
        title={retentionContractor ? `เงินประกันผลงาน - ${retentionContractor.name}` : 'เงินประกันผลงาน'}
        panelClassName={contractorLedgerModalPanelClass}
      >
        {isRetentionLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : retentionRows.length === 0 ? (
          <div className="text-center text-slate-400 py-10">ไม่พบรายการที่มีเงินประกัน</div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">เงินประกันผลงานที่หักจริงโดยบัญชี (เฉพาะใบเบิกที่จ่ายแล้วและหักประกัน)</p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left">เลขที่ใบเบิก</th>
                    <th className="px-3 py-2 text-left">วันที่จ่าย</th>
                    <th className="px-3 py-2 text-left">โครงการ / แปลง / รายการงาน</th>
                    <th className="px-3 py-2 text-right">ยอดงานหลัก</th>
                    <th className="px-3 py-2 text-right">ประกัน %</th>
                    <th className="px-3 py-2 text-right">เงินประกัน</th>
                  </tr>
                </thead>
                <tbody>
                  {retentionRows.map((row: any) => {
                    const workAmt = Number(row.total_work_amount || 0)
                    const retPct = Number(row.retention_percent || 0)
                    const isManual = row.retention_amount != null
                    const retAmt = isManual ? Number(row.retention_amount) : workAmt * (retPct / 100)
                    const jobNames = (row.billing_jobs || [])
                      .map((j: any) => j.job_assignments?.boq_master?.item_name)
                      .filter(Boolean)
                    return (
                      <tr key={row.id} className="border-b last:border-b-0 hover:bg-slate-50 align-top">
                        <td className="px-3 py-2 font-semibold text-indigo-700">#{String(row.doc_no || '-').padStart(4, '0')}</td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                          {row.paid_out_at ? new Date(row.paid_out_at).toLocaleDateString('th-TH') : '-'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{row.projects?.name || '-'}</div>
                          {row.plots?.name && <div className="text-xs text-slate-400">แปลง {row.plots.name}</div>}
                          {jobNames.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {jobNames.map((name: string, i: number) => (
                                <div key={i} className="text-xs text-slate-500">• {name}</div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">฿{formatCurrency(workAmt)}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{isManual ? 'ระบุเอง' : `${retPct}%`}</td>
                        <td className="px-3 py-2 text-right font-semibold text-amber-700">฿{formatCurrency(retAmt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="border-t bg-amber-50">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-right font-bold text-slate-700">รวมเงินประกันสะสม</td>
                    <td className="px-3 py-2 text-right font-bold text-amber-700">
                      ฿{formatCurrency(retentionRows.reduce((s: number, r: any) => s + (r.retention_amount != null ? Number(r.retention_amount) : Number(r.total_work_amount || 0) * (Number(r.retention_percent || 0) / 100)), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!historyContractor}
        onClose={closeHistory}
        title={historyContractor ? `ประวัติงานที่อนุมัติแล้ว - ${historyContractor.name}` : 'ประวัติงาน'}
        panelClassName={contractorLedgerModalPanelClass}
        bodyClassName="p-0"
      >
        <div className="p-4 bg-slate-50/40">
          {isHistoryLoading ? (
            <div className="flex min-h-[40vh] items-center justify-center text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : historyRows.length === 0 ? (
            <div className="text-center text-slate-400 py-12">ไม่พบงานที่อนุมัติแล้ว</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <div className="text-xs text-emerald-700">จ่ายแล้ว (ยืนยันโดยบัญชี)</div>
                  <div className="text-lg font-bold text-emerald-700">฿{formatCurrency(historySummary.paid)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500">รออนุมัติจ่าย ({historySummary.pendingCount} รายการ)</div>
                  <div className="text-lg font-bold text-slate-500">฿{formatCurrency(historySummary.pending)}</div>
                </div>
              </div>
              <Card className="p-3 border-slate-200">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <div className="md:col-span-2 relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      className="w-full pl-9"
                      placeholder="ค้นหาเลขที่/โครงการ/แปลง/ชื่องาน"
                    />
                  </div>
                  <div>
                    <select value={historyProject} onChange={(e) => setHistoryProject(e.target.value)} className="w-full">
                      <option value="">ทุกโครงการ</option>
                      {historyProjectOptions.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <select value={historyType} onChange={(e) => setHistoryType(e.target.value as any)} className="w-full">
                      <option value="all">ทุกประเภท</option>
                      <option value="progress">Progress</option>
                      <option value="extra_work">DC</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" value={historyDateFrom} onChange={(e) => setHistoryDateFrom(e.target.value)} />
                    <input type="date" value={historyDateTo} onChange={(e) => setHistoryDateTo(e.target.value)} />
                  </div>
                </div>
              </Card>

              {filteredHistoryRows.length === 0 ? (
                <div className="text-center text-slate-400 py-12">ไม่พบข้อมูลตามเงื่อนไข</div>
              ) : (
                filteredHistoryRows.map((row: any) => {
                  const plot = row.plots?.name ? `แปลง ${row.plots.name}` : 'ไม่ระบุแปลง'
                  const typeLabel = row.type === 'extra_work' ? 'DC' : 'Progress'
                  const mainJobs = (row.billing_jobs || [])
                    .map((j: any) => {
                      const name = j.job_assignments?.boq_master?.item_name
                      if (!name) return null
                      if (j.progress_percent == null) return name
                      const from = Number(j.previous_progress_percent ?? 0)
                      const to = Number(j.progress_percent)
                      return `${name} (${from.toFixed(0)}% → ${to.toFixed(0)}%)`
                    })
                    .filter(Boolean)
                  const adjs = (row.billing_adjustments || [])
                    .map((a: any) => `${a.type === 'deduction' ? 'หัก' : 'เพิ่ม'}: ${a.description}`)
                    .filter(Boolean)
                  const lines = [...mainJobs, ...adjs]

                  const isPaid = !!row.paid_out_at
                  const displayAmount = isPaid ? Number(row.actual_payout ?? row.net_amount ?? 0) : Number(row.net_amount || 0)
                  const retentionAmt = row.retention_amount != null
                    ? Number(row.retention_amount)
                    : Number(row.total_work_amount || 0) * (Number(row.retention_percent || 0) / 100)
                  const whtAmt = isPaid && row.wht_applied
                    ? (row.wht_amount != null
                        ? Number(row.wht_amount)
                        : (Number(row.total_work_amount || 0) + Number(row.total_add_amount || 0) - Number(row.total_deduct_amount || 0)) * (Number(row.wht_percent || 0) / 100))
                    : 0
                  const showRetentionBadge = isPaid && row.retention_applied !== false && retentionAmt > 0
                  const showWhtBadge = isPaid && whtAmt > 0
                  const showDeductBadge = isPaid && row.deduct_applied !== false && Number(row.total_deduct_amount || 0) > 0

                  return (
                    <Card key={row.id} className="p-4 border-slate-200">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="inline-flex rounded bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                            #{String(row.doc_no || '-').padStart(4, '0')}
                          </div>
                          <div className="mt-2 text-sm text-slate-600">{row.billing_date ? new Date(row.billing_date).toLocaleDateString('th-TH') : '-'}</div>
                          <div className="text-sm font-medium text-slate-800">{row.projects?.name || '-'} • {plot}</div>
                        </div>
                        <div className="text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <div className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${row.type === 'extra_work' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-sky-200 bg-sky-50 text-sky-700'}`}>
                              {typeLabel}
                            </div>
                            {isPaid ? (
                              <div className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-300">
                                จ่ายแล้ว {new Date(row.paid_out_at).toLocaleDateString('th-TH')}
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
                                รออนุมัติจ่าย
                              </div>
                            )}
                          </div>
                          <div className={`mt-2 text-lg font-bold ${isPaid ? 'text-emerald-700' : 'text-slate-400'}`}>
                            ฿{formatCurrency(displayAmount)}
                          </div>
                          {!isPaid && <div className="text-[11px] text-slate-400">ยอดที่ PM อนุมัติ ยังไม่หัก WHT/ประกัน</div>}
                          {isPaid && (showWhtBadge || showRetentionBadge || showDeductBadge) && (
                            <div className="mt-1 flex items-center justify-end gap-1 flex-wrap">
                              {showWhtBadge && (
                                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
                                  WHT {row.wht_percent}% (−฿{formatCurrency(whtAmt)})
                                </span>
                              )}
                              {showRetentionBadge && (
                                <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 ring-1 ring-orange-200">
                                  ประกัน {row.retention_percent}% (−฿{formatCurrency(retentionAmt)})
                                </span>
                              )}
                              {showDeductBadge && (
                                <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-red-200">
                                  หักงาน (−฿{formatCurrency(Number(row.total_deduct_amount || 0))})
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="space-y-1 text-sm text-slate-700">
                          {lines.length === 0 ? (
                            <div>-</div>
                          ) : (
                            lines.map((line: string, idx: number) => (
                              <div key={`${row.id}-line-${idx}`} className="truncate">{line}</div>
                            ))
                          )}
                        </div>
                      </div>
                    </Card>
                  )
                })
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}