'use client'

import { useState, useEffect, useMemo, useTransition } from 'react'
import { Plus, Trash2, Loader2, HardHat, Phone, CreditCard, User, Pencil, Wallet, Eye, Search } from 'lucide-react'
import { Card } from '@/components/ui/Card'
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
  contractor_types: { name: string } | null
}

type ContractorType = {
  id: number
  name: string
}

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">ผู้รับเหมา</h1>
          <p className="text-sm text-slate-500">จัดการรายชื่อช่างและทีมงาน</p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition shadow-sm"
        >
          <Plus className="h-4 w-4" /> เพิ่มผู้รับเหมา
        </button>
      </div>

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
                <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                  <div className="flex items-center gap-2 text-emerald-700">
                    <Wallet className="h-4 w-4" />
                    <span>ยอดจ่ายสะสม</span>
                  </div>
                  <span className="font-semibold text-emerald-700">฿{formatCurrency(c.total_paid || 0)}</span>
                </div>

                <button
                  onClick={() => openHistory(c)}
                  className="w-full mt-1 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 px-3 py-2 text-sm font-medium hover:bg-indigo-100 flex items-center justify-center gap-2"
                >
                  <Eye className="h-4 w-4" /> ดูงานที่อนุมัติแล้ว
                </button>

                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-slate-400" />
                  {c.phone || '-'}
                </div>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-slate-400" />
                  {c.bank_account || '-'}
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

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">เลขบัญชีธนาคาร</label>
            <input name="bank_account" className="w-full" placeholder="ธนาคาร - เลขบัญชี" defaultValue={editingContractor?.bank_account} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={closeModal} className="btn-secondary">ยกเลิก</button>
            <button type="submit" disabled={isPending} className="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700">
              {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!historyContractor}
        onClose={closeHistory}
        title={historyContractor ? `ประวัติงานที่อนุมัติแล้ว - ${historyContractor.name}` : 'ประวัติงาน'}
        panelClassName="max-w-[96vw] h-[88vh]"
        bodyClassName="p-0 h-[calc(88vh-72px)]"
      >
        <div className="h-full overflow-auto p-4 bg-slate-50/40">
          {isHistoryLoading ? (
            <div className="h-full flex items-center justify-center text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : historyRows.length === 0 ? (
            <div className="text-center text-slate-400 py-12">ไม่พบงานที่อนุมัติแล้ว</div>
          ) : (
            <div className="space-y-3">
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
                    .map((j: any) => j.job_assignments?.boq_master?.item_name)
                    .filter(Boolean)
                  const adjs = (row.billing_adjustments || [])
                    .map((a: any) => `${a.type === 'deduction' ? 'หัก' : 'เพิ่ม'}: ${a.description}`)
                    .filter(Boolean)
                  const lines = [...mainJobs, ...adjs]

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
                          <div className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${row.type === 'extra_work' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-sky-200 bg-sky-50 text-sky-700'}`}>
                            {typeLabel}
                          </div>
                          <div className="mt-2 text-lg font-bold text-emerald-700">฿{formatCurrency(row.net_amount || 0)}</div>
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